import type { Relation, SDocDocument, SDocNode } from "./types.ts";

export interface FlatRow {
  node: SDocNode;
  depth: number;
  path: number[];
}

export function fieldOf(node: SDocNode, name: string): string {
  return node.fields.find((field) => field.name === name)?.value ?? "";
}

export function nodeUid(node: SDocNode): string {
  return fieldOf(node, "UID");
}

export function flatten(nodes: SDocNode[], depth = 0, prefix: number[] = []): FlatRow[] {
  const rows: FlatRow[] = [];
  nodes.forEach((node, index) => {
    const path = [...prefix, index];
    rows.push({ node, depth, path });
    rows.push(...flatten(node.children, depth + 1, path));
  });
  return rows;
}

export function withField(node: SDocNode, name: string, value: string): SDocNode {
  if (value === "") {
    return { ...node, fields: node.fields.filter((field) => field.name !== name) };
  }
  const fields = node.fields.slice();
  const existing = fields.findIndex((field) => field.name === name);
  const next = {
    name,
    value,
    multiline: value.includes("\n"),
    line: existing >= 0 ? fields[existing]!.line : node.line,
    col: existing >= 0 ? fields[existing]!.col : 1,
  };
  if (existing >= 0) fields[existing] = next;
  else fields.push(next);
  return { ...node, fields };
}

export function withRelations(node: SDocNode, relations: Relation[]): SDocNode {
  return { ...node, relations };
}

export function mapAt(
  nodes: SDocNode[],
  path: number[],
  fn: (node: SDocNode) => SDocNode,
): SDocNode[] {
  if (path.length === 0) return nodes;
  const [index, ...rest] = path;
  return nodes.map((node, i) => {
    if (i !== index) return node;
    if (rest.length === 0) return fn(node);
    return { ...node, children: mapAt(node.children, rest, fn) };
  });
}

export function insertAfter(
  nodes: SDocNode[],
  afterUid: string | undefined,
  created: SDocNode,
): { nodes: SDocNode[]; found: boolean } {
  if (!afterUid) return { nodes: [...nodes, created], found: true };
  let found = false;
  const walk = (list: SDocNode[]): SDocNode[] => {
    const out: SDocNode[] = [];
    for (const node of list) {
      const children = walk(node.children);
      out.push({ ...node, children });
      if (fieldOf(node, "UID") === afterUid) {
        found = true;
        out.push(created);
      }
    }
    return out;
  };
  const next = walk(nodes);
  return { nodes: found ? next : nodes, found };
}

export function removeUid(nodes: SDocNode[], uid: string): { nodes: SDocNode[]; removed: boolean } {
  let removed = false;
  const walk = (list: SDocNode[]): SDocNode[] => {
    const out: SDocNode[] = [];
    for (const node of list) {
      if (fieldOf(node, "UID") === uid) {
        removed = true;
        continue;
      }
      out.push({ ...node, children: walk(node.children) });
    }
    return out;
  };
  return { nodes: walk(nodes), removed };
}

export function collectUids(doc: SDocDocument): string[] {
  const uids: string[] = [];
  if (doc.uid) uids.push(doc.uid);
  for (const row of flatten(doc.nodes)) {
    const uid = nodeUid(row.node);
    if (uid) uids.push(uid);
  }
  return uids;
}

export function parentEdges(doc: SDocDocument): { from: string; to: string }[] {
  const edges: { from: string; to: string }[] = [];
  for (const row of flatten(doc.nodes)) {
    const uid = nodeUid(row.node);
    if (!uid) continue;
    for (const relation of row.node.relations) {
      if (relation.type === "Parent" && relation.value) {
        edges.push({ from: uid, to: relation.value });
      }
    }
  }
  return edges;
}

export function nextUid(prefix: string, uids: Iterable<string>): string {
  const base = prefix.length > 0 ? prefix : "REQ-";
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}(\\d+)$`);
  let max = 0;
  let width = 3;
  for (const uid of uids) {
    const match = re.exec(uid);
    if (!match?.[1]) continue;
    width = Math.max(width, match[1].length);
    max = Math.max(max, Number(match[1]));
  }
  return base + String(max + 1).padStart(width, "0");
}

export function requirementNode(uid: string, title = "", statement = ""): SDocNode {
  const fields = [];
  if (uid) fields.push({ name: "UID", value: uid, multiline: false, line: 1, col: 1 });
  if (title) fields.push({ name: "TITLE", value: title, multiline: false, line: 1, col: 1 });
  if (statement) {
    fields.push({
      name: "STATEMENT",
      value: statement,
      multiline: statement.includes("\n"),
      line: 1,
      col: 1,
    });
  }
  return {
    tag: "REQUIREMENT",
    composite: false,
    legacy: false,
    line: 1,
    fields,
    relations: [],
    children: [],
  };
}

function bag(fields: { name: string; value: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const field of fields) {
    const list = out[field.name] ?? [];
    list.push(field.value);
    out[field.name] = list;
  }
  return out;
}

function relationsEqual(a: Relation[], b: Relation[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (relation, index) =>
      relation.type === b[index]?.type &&
      (relation.role ?? "") === (b[index]?.role ?? "") &&
      relation.value === b[index]?.value,
  );
}

function nodesEqual(a: SDocNode[], b: SDocNode[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((node, index) => {
    const other = b[index];
    if (!other) return false;
    if (node.tag !== other.tag || node.composite !== other.composite || node.legacy !== other.legacy) {
      return false;
    }
    if (JSON.stringify(bag(node.fields)) !== JSON.stringify(bag(other.fields))) return false;
    if (!relationsEqual(node.relations, other.relations)) return false;
    return nodesEqual(node.children, other.children);
  });
}

function optionsEqual(a: SDocDocument["options"], b: SDocDocument["options"]): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const keys = ["ENABLE_MID", "AUTO_LEVELS", "VIEW_STYLE", "NODE_IN_TOC", "MARKUP"] as const;
  for (const key of keys) if ((a[key] ?? "") !== (b[key] ?? "")) return false;
  return JSON.stringify(a.extra) === JSON.stringify(b.extra);
}

export function semanticallyEqual(a: SDocDocument | null, b: SDocDocument | null): boolean {
  if (!a || !b) return a === b;
  if (a.title !== b.title || (a.uid ?? "") !== (b.uid ?? "")) return false;
  if ((a.mid ?? "") !== (b.mid ?? "")) return false;
  if ((a.version ?? "") !== (b.version ?? "")) return false;
  if ((a.date ?? "") !== (b.date ?? "")) return false;
  if ((a.classification ?? "") !== (b.classification ?? "")) return false;
  if ((a.prefix ?? "") !== (b.prefix ?? "")) return false;
  if ((a.root ?? null) !== (b.root ?? null)) return false;
  if (!optionsEqual(a.options, b.options)) return false;
  if (a.grammar.explicit !== b.grammar.explicit) return false;
  if (a.grammar.explicit && JSON.stringify(a.grammar.elements) !== JSON.stringify(b.grammar.elements)) {
    return false;
  }
  return nodesEqual(a.nodes, b.nodes);
}
