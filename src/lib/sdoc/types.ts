export type FieldType =
  | "String"
  | "SingleLineString"
  | "MultiLineString"
  | "Integer"
  | "Boolean"
  | "Choice"
  | "SingleChoice";

export type RelationType = "Parent" | "Child" | "File";

export interface GrammarField {
  title: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}

export interface GrammarRelation {
  type: RelationType;
  role?: string;
  reverseRole?: string;
}

export interface GrammarElement {
  tag: string;
  fields: GrammarField[];
  relations: GrammarRelation[];
}

export interface Grammar {
  explicit: boolean;
  elements: GrammarElement[];
}

export interface FieldValue {
  name: string;
  value: string;
  multiline: boolean;
  line: number;
  col: number;
}

export interface Relation {
  type: RelationType;
  role?: string;
  value: string;
  line: number;
}

export interface SDocNode {
  tag: string;
  composite: boolean;
  legacy: boolean;
  line: number;
  fields: FieldValue[];
  relations: Relation[];
  children: SDocNode[];
}

export interface DocOptions {
  ENABLE_MID?: string;
  AUTO_LEVELS?: string;
  VIEW_STYLE?: string;
  NODE_IN_TOC?: string;
  MARKUP?: string;
  extra: { key: string; value: string }[];
}

export interface SDocDocument {
  mid?: string;
  title: string;
  uid?: string;
  version?: string;
  date?: string;
  classification?: string;
  prefix?: string;
  root?: boolean;
  options?: DocOptions;
  grammar: Grammar;
  nodes: SDocNode[];
}

export interface SDocIssue {
  file?: string;
  line: number;
  col: number;
  path: string;
  message: string;
  severity: "error" | "warning";
  /** Stable id so strict mode can promote a specific warning. */
  code?: string;
  uid?: string;
}

export interface ValidateOptions {
  siblingUids?: Iterable<string>;
  /** Parent edges owned by other files: from child UID to parent UID. */
  siblingEdges?: Iterable<{ from: string; to: string }>;
  mode?: "read" | "write";
  strict?: boolean;
  file?: string;
  /** When false, a missing relation target is a warning even on write. */
  indexComplete?: boolean;
}

export interface ValidateResult {
  ok: boolean;
  errors: SDocIssue[];
  document: SDocDocument | null;
}
