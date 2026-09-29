import type { RelationType, SDocDocument, SDocIssue } from "./types.ts";

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
}

export interface TreeFile {
  path: string;
  title: string;
  uid: string;
  nodeCount: number;
  issueCount: number;
}

export interface TreeResponse {
  root: string;
  files: TreeFile[];
}

export interface IndexResponse {
  nodes: IndexNode[];
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
