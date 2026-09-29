import { semanticallyEqual, nodeUid, parentEdges } from "./model.ts";
import { parse } from "./parse.ts";
import { serialize } from "./serialize.ts";
import type {
  GrammarElement,
  Relation,
  SDocDocument,
  SDocIssue,
  SDocNode,
  ValidateOptions,
  ValidateResult,
} from "./types.ts";

const UID_RE = /^[A-Za-z0-9._-]+$/;

export function validate(text: string, options: ValidateOptions = {}): ValidateResult {
  const parsed = parse(text);
  const errors = parsed.errors.map((item) => ({ ...item }));
  const document = parsed.document;
  if (!document) {
    stampFile(errors, options.file);
    return { ok: false, errors, document: null };
  }

  const siblings = new Set(options.siblingUids ?? []);
  checkDocumentUid(document, errors, siblings);
  const localUids = new Set<string>();
  if (document.uid && UID_RE.test(document.uid)) localUids.add(document.uid);

  const walkFields = (nodes: SDocNode[], path: string) => {
    nodes.forEach((node, index) => {
      const here = `${path}[${index}]`;
      checkNode(document, node, here, errors, localUids, siblings);
      walkFields(node.children, `${here}.children`);
    });
  };
  walkFields(document.nodes, "nodes");

  const walkRelations = (nodes: SDocNode[], path: string) => {
    nodes.forEach((node, index) => {
      const here = `${path}[${index}]`;
      const element = document.grammar.elements.find((item) => item.tag === node.tag);
      node.relations.forEach((relation, relIndex) => {
        checkRelation(
          document,
          element,
          node,
          relation,
          `${here}.relations[${relIndex}]`,
          errors,
          localUids,
          siblings,
          options,
        );
      });
      walkRelations(node.children, `${here}.children`);
    });
  };
  walkRelations(document.nodes, "nodes");

  const edges = [
    ...parentEdges(document),
    ...[...(options.siblingEdges ?? [])].filter((edge) => !localUids.has(edge.from)),
  ];
  const cycle = findCycle(edges);
  if (cycle) {
    errors.push({
      line: 1,
      col: 1,
      path: "graph",
      message: `Parent cycle: ${cycle.join(" → ")}.`,
      severity: "error",
      code: "cycle",
      file: options.file,
    });
  }

  const blocking = errors.some((item) => item.severity === "error");
  if (!blocking) {
    const again = parse(serialize(document));
    if (
      again.errors.some((item) => item.severity === "error") ||
      !semanticallyEqual(document, again.document)
    ) {
      errors.push({
        line: 1,
        col: 1,
        path: "roundtrip",
        message: "Serialize(parse(text)) is not semantically equal.",
        severity: "error",
        code: "roundtrip",
        file: options.file,
      });
    }
  }

  stampFile(errors, options.file);
  const strictHit = options.strict === true && errors.some((item) => item.code === "missing-parent");
  const ok = !errors.some((item) => item.severity === "error") && !strictHit;
  return { ok, errors, document };
}

function stampFile(errors: SDocIssue[], file: string | undefined): void {
  if (!file) return;
  for (const item of errors) if (!item.file) item.file = file;
}

function checkDocumentUid(document: SDocDocument, errors: SDocIssue[], siblings: Set<string>): void {
  if (!document.uid) return;
  if (!UID_RE.test(document.uid)) {
    errors.push({
      line: 1,
      col: 1,
      path: "header.UID",
      message: `Document UID ${document.uid} must match [A-Za-z0-9._-]+.`,
      severity: "error",
      code: "uid-charset",
    });
    return;
  }
  if (siblings.has(document.uid)) {
    errors.push({
      line: 1,
      col: 1,
      path: "header.UID",
      message: `UID ${document.uid} is already used.`,
      severity: "error",
      code: "duplicate-uid",
      uid: document.uid,
    });
  }
}

function checkNode(
  document: SDocDocument,
  node: SDocNode,
  path: string,
  errors: SDocIssue[],
  localUids: Set<string>,
  siblings: Set<string>,
): void {
  const element = document.grammar.elements.find((item) => item.tag === node.tag);
  const uid = nodeUid(node);
  if (!element) {
    errors.push({
      line: node.line,
      col: 1,
      path,
      message: `Element [${node.tag}] is not in the grammar.`,
      severity: "error",
      code: "unknown-element",
      uid: uid || undefined,
    });
  }

  const seen = new Set<string>();
  for (const field of node.fields) {
    if (field.name === "MID") continue;
    if (seen.has(field.name) && field.name !== "COMMENT") {
      errors.push({
        line: field.line,
        col: field.col,
        path: `${path}.${field.name}`,
        message: `Duplicate field ${field.name}.`,
        severity: "error",
        uid: uid || undefined,
      });
    }
    seen.add(field.name);
    if (element && !element.fields.some((spec) => spec.title === field.name)) {
      errors.push({
        line: field.line,
        col: field.col,
        path: `${path}.${field.name}`,
        message: `Field ${field.name} is not declared on ${node.tag}.`,
        severity: "error",
        code: "undeclared-field",
        uid: uid || undefined,
      });
    }
    const spec = element?.fields.find((item) => item.title === field.name);
    if (spec?.type === "SingleLineString" && field.value.includes("\n")) {
      errors.push({
        line: field.line,
        col: field.col,
        path: `${path}.${field.name}`,
        message: `${field.name} must be a single line.`,
        severity: "error",
        uid: uid || undefined,
      });
    }
    if (spec?.type === "Integer" && !/^-?\d+$/.test(field.value)) {
      errors.push({
        line: field.line,
        col: field.col,
        path: `${path}.${field.name}`,
        message: `${field.name} must be an integer.`,
        severity: "error",
        uid: uid || undefined,
      });
    }
    if (spec?.type === "Boolean" && field.value !== "True" && field.value !== "False") {
      errors.push({
        line: field.line,
        col: field.col,
        path: `${path}.${field.name}`,
        message: `${field.name} must be True or False.`,
        severity: "error",
        uid: uid || undefined,
      });
    }
    if (field.name === "UID") {
      if (!UID_RE.test(field.value)) {
        errors.push({
          line: field.line,
          col: field.col,
          path: `${path}.UID`,
          message: `UID ${field.value || "(empty)"} must match [A-Za-z0-9._-]+.`,
          severity: "error",
          code: "uid-charset",
          uid: field.value || undefined,
        });
      } else if (localUids.has(field.value) || siblings.has(field.value)) {
        errors.push({
          line: field.line,
          col: field.col,
          path: `${path}.UID`,
          message: `UID ${field.value} is already used.`,
          severity: "error",
          code: "duplicate-uid",
          uid: field.value,
        });
      } else {
        localUids.add(field.value);
      }
    }
  }

  if (element) {
    for (const spec of element.fields) {
      if (!spec.required) continue;
      const value = node.fields.find((field) => field.name === spec.title)?.value ?? "";
      if (value.trim() === "") {
        errors.push({
          line: node.line,
          col: 1,
          path: `${path}.${spec.title}`,
          message: `${node.tag} is missing required ${spec.title}.`,
          severity: "error",
          code: "required",
          uid: uid || undefined,
        });
      }
    }
  }

  if (node.tag === "REQUIREMENT") {
    const titleReq = element?.fields.find((field) => field.title === "TITLE")?.required ?? false;
    const statementReq = element?.fields.find((field) => field.title === "STATEMENT")?.required ?? false;
    const title = node.fields.find((field) => field.name === "TITLE")?.value ?? "";
    const statement = node.fields.find((field) => field.name === "STATEMENT")?.value ?? "";
    if (!titleReq && !statementReq && title.trim() === "" && statement.trim() === "") {
      errors.push({
        line: node.line,
        col: 1,
        path,
        message: "REQUIREMENT needs a TITLE or a STATEMENT.",
        severity: "error",
        code: "title-or-statement",
        uid: uid || undefined,
      });
    }
    if (document.root === false && !node.relations.some((relation) => relation.type === "Parent" && relation.value)) {
      errors.push({
        line: node.line,
        col: 1,
        path,
        message: `ROOT: False document — ${uid || "requirement"} has no Parent relation.`,
        severity: "warning",
        code: "missing-parent",
        uid: uid || undefined,
      });
    }
  }
}

function checkRelation(
  document: SDocDocument,
  element: GrammarElement | undefined,
  node: SDocNode,
  relation: Relation,
  path: string,
  errors: SDocIssue[],
  localUids: Set<string>,
  siblings: Set<string>,
  options: ValidateOptions,
): void {
  const uid = nodeUid(node);
  if (relation.type !== "Parent" && relation.type !== "Child" && relation.type !== "File") {
    errors.push({
      line: relation.line,
      col: 1,
      path,
      message: `Relation TYPE ${relation.type} is not Parent, Child, or File.`,
      severity: "error",
      uid: uid || undefined,
    });
    return;
  }
  if (!relation.value.trim()) {
    errors.push({
      line: relation.line,
      col: 1,
      path: `${path}.value`,
      message: "Relation VALUE is empty.",
      severity: "error",
      code: "empty-relation",
      uid: uid || undefined,
    });
    return;
  }
  if (element && document.grammar.explicit && element.relations.length > 0) {
    const registered = element.relations.some(
      (item) => item.type === relation.type && (item.role ?? "") === (relation.role ?? ""),
    );
    if (!registered) {
      errors.push({
        line: relation.line,
        col: 1,
        path,
        message: relation.role
          ? `Role ${relation.role} is not registered for ${relation.type} on ${node.tag}.`
          : `${relation.type} is not registered on ${node.tag}.`,
        severity: "error",
        code: "unregistered-role",
        uid: uid || undefined,
      });
    }
  }
  if (relation.type === "File") return;
  if (!UID_RE.test(relation.value)) {
    errors.push({
      line: relation.line,
      col: 1,
      path: `${path}.value`,
      message: `Relation VALUE ${relation.value} is not a UID.`,
      severity: "error",
      uid: uid || undefined,
    });
    return;
  }
  const known = localUids.has(relation.value) || siblings.has(relation.value);
  if (known) return;
  const write = options.mode === "write" && options.indexComplete !== false;
  errors.push({
    line: relation.line,
    col: 1,
    path: `${path}.value`,
    message: write
      ? `Parent/Child target ${relation.value} is not in the tree.`
      : `Target ${relation.value} is not in the loaded UID index.`,
    severity: write ? "error" : "warning",
    code: "unresolved-uid",
    uid: uid || undefined,
  });
}

function findCycle(edges: { from: string; to: string }[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adj.get(edge.from) ?? [];
    list.push(edge.to);
    adj.set(edge.from, list);
    if (!adj.has(edge.to)) adj.set(edge.to, []);
  }
  const color = new Map<string, number>();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    color.set(node, 1);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const state = color.get(next) ?? 0;
      if (state === 1) {
        const at = stack.indexOf(next);
        return [...stack.slice(at), next];
      }
      if (state === 0) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, 2);
    return null;
  };
  for (const node of adj.keys()) {
    if ((color.get(node) ?? 0) === 0) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}
