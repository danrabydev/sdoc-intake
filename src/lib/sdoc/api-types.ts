import type { Grammar, RelationType, SDocDocument, SDocIssue } from "./types.ts";

export interface IndexRelation {
  type: RelationType;
  role?: string;
  value: string;
}

export interface IndexNode {
  uid: string;
  title: string;
  file: string;
  tag: string;
  statement: string;
  relations: IndexRelation[];
  /** UID of the containing section. Empty when the node sits on the document. */
  parent?: string;
  /** A file section, or any other composite, that groups the nodes under it. */
  composite?: boolean;
}

export interface TreeFile {
  path: string;
  title: string;
  uid: string;
  nodeCount: number;
  issueCount: number;
  kind?: "sdoc" | "sgra";
}

export interface TreeResponse {
  root: string;
  files: TreeFile[];
  dirs: string[];
}

export interface IndexResponse {
  nodes: IndexNode[];
}

export interface GrammarResponse {
  ok: boolean;
  path: string;
  text: string;
  grammar: Grammar | null;
  errors: SDocIssue[];
}

export interface HealthResponse {
  ok: boolean;
  root: string;
  fileCount: number;
}

export interface FileResponse {
  ok: boolean;
  path: string;
  text: string;
  document: SDocDocument | null;
  errors: SDocIssue[];
  parseFailed: boolean;
  siblingUids: string[];
  siblingEdges: { from: string; to: string }[];
}

export interface GraphResponse {
  nodes: IndexNode[];
  edges: { from: string; to: string; type: RelationType; role?: string }[];
}

export interface NodeResponse {
  uid: string;
  file: string;
  tag: string;
  title: string;
  statement: string;
  relations: IndexRelation[];
  incoming: { uid: string; file: string; title: string; type: RelationType; role?: string }[];
}
