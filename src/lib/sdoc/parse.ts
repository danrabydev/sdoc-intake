import { defaultGrammar } from "./grammar.ts";
import type {
  DocOptions,
  FieldType,
  Grammar,
  GrammarElement,
  GrammarField,
  Relation,
  RelationType,
  SDocDocument,
  SDocIssue,
  SDocNode,
} from "./types.ts";

const OPEN_COMPOSITE = /^\[\[([A-Z][A-Z0-9_]*)\]\]\s*$/;
const CLOSE_COMPOSITE = /^\[\[\/([A-Z][A-Z0-9_]*)\]\]\s*$/;
const OPEN_SINGLE = /^\[([A-Z][A-Z0-9_]*)\]\s*$/;
const CLOSE_SINGLE = /^\[\/([A-Z][A-Z0-9_]*)\]\s*$/;
const FIELD_LINE = /^([A-Z][A-Z0-9_]*)\s*:\s?(.*)$/;

const HEADER_SEQUENCE = [
  "MID",
  "TITLE",
  "UID",
  "VERSION",
  "DATE",
  "CLASSIFICATION",
  "PREFIX",
  "ROOT",
  "OPTIONS",
] as const;

const FIELD_TYPES = new Set<FieldType>([
  "String",
  "SingleLineString",
  "MultiLineString",
  "Integer",
  "Boolean",
  "Choice",
  "SingleChoice",
]);

export interface ParseResult {
  document: SDocDocument | null;
  errors: SDocIssue[];
}

class Scanner {
  readonly lines: string[];
  index = 0;

  constructor(text: string) {
    const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    this.lines = normalized.split("\n");
  }

  get lineNo(): number {
    return this.index + 1;
  }

  get current(): string | null {
    return this.index < this.lines.length ? this.lines[this.index]! : null;
  }

  next(): void {
    this.index += 1;
  }
}

function issue(
  line: number,
  col: number,
  path: string,
  message: string,
  severity: "error" | "warning" = "error",
  code?: string,
): SDocIssue {
  return { line, col, path, message, severity, code };
}

export function parse(text: string): ParseResult {
  const scanner = new Scanner(text);
  const errors: SDocIssue[] = [];
  while (scanner.current !== null && scanner.current.trim() === "") scanner.next();
  if (scanner.current === null || scanner.current.trim() !== "[DOCUMENT]") {
    errors.push(
      issue(scanner.lineNo, 1, "document", "Missing [DOCUMENT]. An SDoc file must start with [DOCUMENT]."),
    );
    return { document: null, errors };
  }
  const docLine = scanner.lineNo;
  scanner.next();

  const document: SDocDocument = {
    title: "",
    grammar: defaultGrammar(),
    nodes: [],
  };
  const seen: string[] = [];
  let titleSeen = false;

  const takeOrder = (name: string, line: number, col: number): boolean => {
    const idx = HEADER_SEQUENCE.indexOf(name as (typeof HEADER_SEQUENCE)[number]);
    if (idx < 0) {
      errors.push(issue(line, col, `header.${name}`, `Unknown document field ${name}.`));
      return false;
    }
    if (seen.includes(name)) {
      errors.push(issue(line, col, `header.${name}`, `Duplicate document field ${name}.`));
      return false;
    }
    const last = seen.length === 0 ? -1 : HEADER_SEQUENCE.indexOf(seen[seen.length - 1] as (typeof HEADER_SEQUENCE)[number]);
    if (idx < last) {
      errors.push(
        issue(
          line,
          col,
          `header.${name}`,
          `Document field ${name} is out of order. Expected ${HEADER_SEQUENCE.join(" → ")}.`,
        ),
      );
    }
    seen.push(name);
    return true;
  };

  while (scanner.current !== null) {
    const raw = scanner.current;
    if (raw.trim() === "") break;
    if (raw.trim().startsWith("[")) break;
    const match = FIELD_LINE.exec(raw);
    if (!match) {
      errors.push(issue(scanner.lineNo, 1, "header", `Unrecognized header line: ${raw.trim()}`));
      scanner.next();
      continue;
    }
    const name = match[1] === "REQ_PREFIX" ? "PREFIX" : match[1]!;
    const value = (match[2] ?? "").trimEnd();
    const col = raw.indexOf(match[1]!) + 1;
    if (name === "OPTIONS") {
      takeOrder("OPTIONS", scanner.lineNo, col);
      scanner.next();
      document.options = parseOptions(scanner, errors);
      continue;
    }
    takeOrder(name, scanner.lineNo, col);
    assignHeader(document, name, value.trim(), scanner.lineNo, col, errors);
    if (name === "TITLE") titleSeen = true;
    scanner.next();
  }

  if (!titleSeen) {
    errors.push(issue(docLine, 1, "header.TITLE", "Document TITLE is required and must come before other fields."));
  }

  while (scanner.current !== null && scanner.current.trim() === "") scanner.next();
  if (scanner.current?.trim() === "[GRAMMAR]") {
    scanner.next();
    document.grammar = parseGrammar(scanner, errors);
  }

  while (scanner.current !== null && scanner.current.trim() === "") scanner.next();
  document.nodes = parseNodes(scanner, errors, null);

  return { document, errors };
}

function assignHeader(
  document: SDocDocument,
  name: string,
  value: string,
  line: number,
  col: number,
  errors: SDocIssue[],
): void {
  switch (name) {
    case "MID":
      document.mid = value;
      break;
    case "TITLE":
      document.title = value.trim();
      break;
    case "UID":
      document.uid = value.trim();
      break;
    case "VERSION":
      document.version = value.trim();
      break;
    case "DATE":
      document.date = value.trim();
      break;
    case "CLASSIFICATION":
      document.classification = value.trim();
      break;
    case "PREFIX":
      document.prefix = value.trim();
      break;
    case "ROOT":
      if (value.trim() !== "True" && value.trim() !== "False") {
        errors.push(issue(line, col, "header.ROOT", "ROOT must be True or False."));
      } else {
        document.root = value.trim() === "True";
      }
      break;
    default:
      break;
  }
}

function parseOptions(scanner: Scanner, errors: SDocIssue[]): DocOptions {
  const options: DocOptions = { extra: [] };
  const known = new Set(["ENABLE_MID", "AUTO_LEVELS", "VIEW_STYLE", "NODE_IN_TOC", "MARKUP"]);
  while (scanner.current !== null) {
    const raw = scanner.current;
    if (raw.trim() === "") break;
    if (!raw.startsWith("  ") || raw.startsWith("[")) break;
    const match = /^\s+([A-Z][A-Z0-9_]*):\s?(.*)$/.exec(raw);
    if (!match) {
      errors.push(issue(scanner.lineNo, 1, "header.OPTIONS", `Unrecognized option line: ${raw.trim()}`));
      scanner.next();
      continue;
    }
    const key = match[1]!;
    const value = (match[2] ?? "").trim();
    if (key === "ENABLE_MID") options.ENABLE_MID = value;
    else if (key === "AUTO_LEVELS") options.AUTO_LEVELS = value;
    else if (key === "VIEW_STYLE") options.VIEW_STYLE = value;
    else if (key === "NODE_IN_TOC") options.NODE_IN_TOC = value;
    else if (key === "MARKUP") options.MARKUP = value;
    else if (!known.has(key)) options.extra.push({ key, value });
    scanner.next();
  }
  return options;
}

function parseGrammar(scanner: Scanner, errors: SDocIssue[]): Grammar {
  const grammar: Grammar = { explicit: true, elements: [] };
  while (scanner.current !== null && scanner.current.trim() === "") scanner.next();
  const imported = /^\s*IMPORT_FROM_FILE:\s*(.*?)\s*$/.exec(scanner.current ?? "");
  if (imported) {
    const spec = imported[1]!.trim();
    if (!spec) errors.push(issue(scanner.lineNo, 1, "grammar", "IMPORT_FROM_FILE needs a .sgra path."));
    else grammar.importFrom = spec;
    scanner.next();
    while (scanner.current !== null && scanner.current.trim() === "") scanner.next();
    if (scanner.current !== null && !scanner.current.trim().startsWith("[")) {
      errors.push(issue(scanner.lineNo, 1, "grammar", "IMPORT_FROM_FILE stands alone. Do not also declare ELEMENTS."));
    }
    return grammar;
  }
  if (scanner.current?.trim() !== "ELEMENTS:") {
    errors.push(issue(scanner.lineNo, 1, "grammar", "GRAMMAR must contain ELEMENTS: or IMPORT_FROM_FILE:."));
  } else {
    scanner.next();
  }
  let current: GrammarElement | null = null;
  let field: GrammarField | null = null;
  let relation: Grammar["elements"][number]["relations"][number] | null = null;
  let mode: "none" | "fields" | "relations" | "properties" = "none";
  let optionsOpen = false;

  const finishField = () => {
    if (field?.type === "SingleChoice" && (!field.options || field.options.length === 0)) {
      errors.push(issue(scanner.lineNo, 1, "grammar", `SingleChoice field ${field.title} needs options.`));
    }
    optionsOpen = false;
  };

  while (scanner.current !== null) {
    const raw = scanner.current;
    const trimmed = raw.trim();
    if (trimmed === "") {
      scanner.next();
      continue;
    }
    if (trimmed.startsWith("[")) break;
    const tag = /^\s*-\s+TAG:\s*(\S+)\s*$/.exec(raw);
    if (tag) {
      finishField();
      current = { tag: tag[1]!, fields: [], relations: [] };
      grammar.elements.push(current);
      field = null;
      relation = null;
      mode = "none";
      scanner.next();
      continue;
    }
    if (/^\s*FIELDS:\s*$/.test(raw)) {
      finishField();
      mode = "fields";
      field = null;
      scanner.next();
      continue;
    }
    if (/^\s*RELATIONS:\s*$/.test(raw)) {
      finishField();
      mode = "relations";
      relation = null;
      scanner.next();
      continue;
    }
    if (/^\s*PROPERTIES:\s*$/.test(raw)) {
      mode = "properties";
      scanner.next();
      continue;
    }
    if (mode === "properties") {
      const composite = /^\s*IS_COMPOSITE:\s*(True|False)\s*$/i.exec(raw);
      if (composite && current) current.composite = /^true$/i.test(composite[1]!);
      scanner.next();
      continue;
    }
    if (mode === "fields") {
      const title = /^\s*-\s+TITLE:\s*(.+)\s*$/.exec(raw);
      if (title) {
        finishField();
        if (!current) {
          errors.push(issue(scanner.lineNo, 1, "grammar", "Field declared before TAG."));
        } else {
          field = { title: title[1]!.trim(), type: "String", required: false };
          current.fields.push(field);
        }
        scanner.next();
        continue;
      }
      const type = /^\s*TYPE:\s*([A-Za-z]+)(?:\(([^)]*)\))?\s*$/.exec(raw);
      if (type && field) {
        optionsOpen = false;
        const value = type[1] as FieldType;
        if (!FIELD_TYPES.has(value)) {
          errors.push(issue(scanner.lineNo, 1, "grammar", `Unknown field TYPE ${type[1]}.`));
        } else if (value === "SingleChoice") {
          const options = (type[2] ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
          if (options.length === 0) {
            field.type = "SingleChoice";
            field.options = [];
          } else {
            field.type = "SingleChoice";
            field.options = options;
          }
        } else {
          field.type = value;
        }
        scanner.next();
        continue;
      }
      const required = /^\s*REQUIRED:\s*(True|False)\s*$/.exec(raw);
      if (required && field) {
        optionsOpen = false;
        field.required = required[1] === "True";
        scanner.next();
        continue;
      }
      if (/^\s*OPTIONS:\s*$/.test(raw) && field) {
        optionsOpen = true;
        field.options = field.options ?? [];
        scanner.next();
        continue;
      }
      const option = /^\s+-\s+(.+?)\s*$/.exec(raw);
      if (option && field && optionsOpen && !/^\s*TITLE:/.test(option[1]!)) {
        field.options = [...(field.options ?? []), option[1]!.trim()];
        scanner.next();
        continue;
      }
    }
    if (mode === "relations") {
      const type = /^\s*-\s+TYPE:\s*(Parent|Child|File)\s*$/.exec(raw);
      if (type && current) {
        relation = { type: type[1] as RelationType };
        current.relations.push(relation);
        scanner.next();
        continue;
      }
      const badType = /^\s*-\s+TYPE:\s*(\S+)\s*$/.exec(raw);
      if (badType) {
        errors.push(
          issue(scanner.lineNo, 1, "grammar", `Relation TYPE ${badType[1]} is not Parent, Child, or File.`),
        );
        scanner.next();
        continue;
      }
      const role = /^\s*ROLE:\s*(.+)\s*$/.exec(raw);
      if (role && relation) {
        relation.role = role[1]!.trim();
        scanner.next();
        continue;
      }
      const reverse = /^\s*REVERSE_ROLE:\s*(.+)\s*$/.exec(raw);
      if (reverse && relation) {
        if (!relation.role) {
          errors.push(issue(scanner.lineNo, 1, "grammar", "REVERSE_ROLE requires ROLE."));
        } else {
          relation.reverseRole = reverse[1]!.trim();
        }
        scanner.next();
        continue;
      }
    }
    errors.push(issue(scanner.lineNo, 1, "grammar", `Unrecognized grammar line: ${trimmed}`));
    scanner.next();
  }
  finishField();
  return grammar;
}

/** A `.sgra` file is a `[GRAMMAR]` block and nothing else. */
export function parseGrammarFile(text: string): { grammar: Grammar | null; errors: SDocIssue[] } {
  const errors: SDocIssue[] = [];
  const scanner = new Scanner(text);
  while (scanner.current !== null && scanner.current.trim() === "") scanner.next();
  if (scanner.current?.trim() !== "[GRAMMAR]") {
    errors.push(issue(scanner.lineNo, 1, "grammar", "A grammar file must start with [GRAMMAR]."));
    return { grammar: null, errors };
  }
  scanner.next();
  const grammar = parseGrammar(scanner, errors);
  if (grammar.importFrom) {
    errors.push(issue(1, 1, "grammar", "A grammar file cannot import another grammar file."));
  }
  return { grammar, errors };
}

function parseNodes(scanner: Scanner, errors: SDocIssue[], closer: string | null): SDocNode[] {
  const nodes: SDocNode[] = [];
  while (scanner.current !== null) {
    while (scanner.current !== null && scanner.current.trim() === "") scanner.next();
    const raw = scanner.current;
    if (raw === null) break;
    const trimmed = raw.trim();
    if (closer && trimmed === closer) break;
    const closeComposite = CLOSE_COMPOSITE.exec(trimmed);
    const closeSingle = CLOSE_SINGLE.exec(trimmed);
    if (closeComposite || closeSingle) {
      errors.push(issue(scanner.lineNo, 1, "nodes", `Unexpected closing tag ${trimmed}.`));
      scanner.next();
      continue;
    }
    const composite = OPEN_COMPOSITE.exec(trimmed);
    if (composite) {
      const line = scanner.lineNo;
      scanner.next();
      nodes.push(parseComposite(scanner, errors, composite[1]!, false, line));
      continue;
    }
    const single = OPEN_SINGLE.exec(trimmed);
    if (single) {
      const tag = single[1]!;
      const line = scanner.lineNo;
      scanner.next();
      if (tag === "SECTION") nodes.push(parseComposite(scanner, errors, tag, true, line));
      else if (tag === "DOCUMENT" || tag === "GRAMMAR") {
        errors.push(issue(line, 1, "nodes", `Unexpected block [${tag}].`));
      } else nodes.push(parseLeaf(scanner, errors, tag, line));
      continue;
    }
    errors.push(issue(scanner.lineNo, 1, "nodes", `Unknown block or text: ${trimmed}`));
    scanner.next();
  }
  return nodes;
}

function parseComposite(
  scanner: Scanner,
  errors: SDocIssue[],
  tag: string,
  legacy: boolean,
  line: number,
): SDocNode {
  const node: SDocNode = { tag, composite: true, legacy, line, fields: [], relations: [], children: [] };
  const closer = legacy ? `[/${tag}]` : `[[/${tag}]]`;
  let relationsOpen = false;
  while (scanner.current !== null) {
    const raw = scanner.current;
    const trimmed = raw.trim();
    if (trimmed === closer) {
      scanner.next();
      return node;
    }
    if (trimmed === "") {
      scanner.next();
      continue;
    }
    if (
      OPEN_COMPOSITE.test(trimmed) ||
      OPEN_SINGLE.test(trimmed) ||
      CLOSE_COMPOSITE.test(trimmed) ||
      CLOSE_SINGLE.test(trimmed)
    ) {
      if (CLOSE_COMPOSITE.test(trimmed) || CLOSE_SINGLE.test(trimmed)) {
        errors.push(issue(scanner.lineNo, 1, `nodes.${tag}`, `Expected ${closer} before ${trimmed}.`));
        scanner.next();
        continue;
      }
      node.children.push(...parseOne(scanner, errors));
      continue;
    }
    if (/^RELATIONS:\s*$/.test(trimmed)) {
      relationsOpen = true;
      const relLine = scanner.lineNo;
      scanner.next();
      node.relations.push(...parseRelationItems(scanner, errors, relLine));
      continue;
    }
    if (relationsOpen) {
      errors.push(
        issue(scanner.lineNo, 1, `nodes.${tag}`, "RELATIONS must be the last field on the node.", "error", "relations-last"),
      );
    }
    const field = parseField(scanner, errors, `nodes.${tag}`);
    if (field) node.fields.push(field);
    else scanner.next();
  }
  errors.push(issue(line, 1, `nodes.${tag}`, `Unclosed ${legacy ? `[${tag}]` : `[[${tag}]]`}.`));
  return node;
}

function parseOne(scanner: Scanner, errors: SDocIssue[]): SDocNode[] {
  const raw = scanner.current;
  if (raw === null) return [];
  const trimmed = raw.trim();
  const composite = OPEN_COMPOSITE.exec(trimmed);
  if (composite) {
    const line = scanner.lineNo;
    scanner.next();
    return [parseComposite(scanner, errors, composite[1]!, false, line)];
  }
  const single = OPEN_SINGLE.exec(trimmed);
  if (single) {
    const tag = single[1]!;
    const line = scanner.lineNo;
    scanner.next();
    if (tag === "SECTION") return [parseComposite(scanner, errors, tag, true, line)];
    return [parseLeaf(scanner, errors, tag, line)];
  }
  errors.push(issue(scanner.lineNo, 1, "nodes", `Unknown block or text: ${trimmed}`));
  scanner.next();
  return [];
}

function parseLeaf(scanner: Scanner, errors: SDocIssue[], tag: string, line: number): SDocNode {
  const node: SDocNode = {
    tag,
    composite: false,
    legacy: false,
    line,
    fields: [],
    relations: [],
    children: [],
  };
  let relationsOpen = false;
  while (scanner.current !== null) {
    const raw = scanner.current;
    const trimmed = raw.trim();
    if (trimmed === "") break;
    if (
      OPEN_COMPOSITE.test(trimmed) ||
      OPEN_SINGLE.test(trimmed) ||
      CLOSE_COMPOSITE.test(trimmed) ||
      CLOSE_SINGLE.test(trimmed)
    ) {
      break;
    }
    if (/^RELATIONS:\s*$/.test(trimmed)) {
      relationsOpen = true;
      const relLine = scanner.lineNo;
      scanner.next();
      node.relations.push(...parseRelationItems(scanner, errors, relLine));
      continue;
    }
    if (relationsOpen) {
      errors.push(
        issue(
          scanner.lineNo,
          1,
          `nodes.${tag}`,
          "RELATIONS must be the last field on the node.",
          "error",
          "relations-last",
        ),
      );
    }
    const field = parseField(scanner, errors, `nodes.${tag}`);
    if (field) node.fields.push(field);
    else if (scanner.current !== null) scanner.next();
  }
  return node;
}

function parseField(scanner: Scanner, errors: SDocIssue[], path: string): { name: string; value: string; multiline: boolean; line: number; col: number } | null {
  const raw = scanner.current;
  if (raw === null) return null;
  const match = FIELD_LINE.exec(raw.trim());
  if (!match || match[1] === "RELATIONS") return null;
  const name = match[1]!;
  const inline = match[2] ?? "";
  const line = scanner.lineNo;
  const col = Math.max(1, raw.indexOf(name) + 1);
  scanner.next();
  if (inline.trim() === ">>>") {
    const parts: string[] = [];
    let closed = false;
    while (scanner.current !== null) {
      if (scanner.current.trim() === "<<<") {
        scanner.next();
        closed = true;
        break;
      }
      parts.push(scanner.current);
      scanner.next();
    }
    if (!closed) {
      errors.push(
        issue(line, col, `${path}.${name}`, "Unclosed multiline value. Expected <<<.", "error", "unclosed-multiline"),
      );
    }
    return { name, value: parts.join("\n"), multiline: true, line, col };
  }
  return { name, value: inline.trim(), multiline: false, line, col };
}

function parseRelationItems(scanner: Scanner, errors: SDocIssue[], startLine: number): Relation[] {
  const relations: Relation[] = [];
  let current: Relation | null = null;
  while (scanner.current !== null) {
    const raw = scanner.current;
    const trimmed = raw.trim();
    if (trimmed === "") break;
    if (
      OPEN_COMPOSITE.test(trimmed) ||
      OPEN_SINGLE.test(trimmed) ||
      CLOSE_COMPOSITE.test(trimmed) ||
      CLOSE_SINGLE.test(trimmed)
    ) {
      break;
    }
    const typed = /^-\s+TYPE:\s*(\S+)\s*$/.exec(trimmed);
    if (typed) {
      const type = typed[1]!;
      if (type !== "Parent" && type !== "Child" && type !== "File") {
        errors.push(issue(scanner.lineNo, 1, "relations", `Relation TYPE ${type} is not Parent, Child, or File.`));
        current = { type: "Parent", value: "", line: scanner.lineNo };
      } else {
        current = { type, value: "", line: scanner.lineNo };
      }
      relations.push(current);
      scanner.next();
      continue;
    }
    const role = /^ROLE:\s*(.*)$/.exec(trimmed);
    const value = /^VALUE:\s*(.*)$/.exec(trimmed);
    const typeCont = /^TYPE:\s*(\S+)\s*$/.exec(trimmed);
    if (role || value || typeCont) {
      if (!current) {
        errors.push(issue(scanner.lineNo, 1, "relations", "Relation entry must start with - TYPE:."));
        scanner.next();
        continue;
      }
      if (role) current.role = role[1]!.trim();
      else if (value) current.value = value[1]!.trim();
      else if (typeCont && (typeCont[1] === "Parent" || typeCont[1] === "Child" || typeCont[1] === "File")) {
        current.type = typeCont[1];
      } else if (typeCont) {
        errors.push(issue(scanner.lineNo, 1, "relations", `Relation TYPE ${typeCont[1]} is not Parent, Child, or File.`));
      }
      scanner.next();
      continue;
    }
    break;
  }
  if (relations.length === 0) {
    errors.push(issue(startLine, 1, "relations", "RELATIONS: block has no entries."));
  }
  return relations;
}
