import type { FileResponse, GraphResponse, HealthResponse, IndexResponse, NodeResponse, TreeResponse } from "./api-types.ts";
import type { SDocDocument, SDocIssue } from "./types.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly errors: SDocIssue[];

  constructor(status: number, message: string, errors: SDocIssue[] = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; errors?: SDocIssue[] };
  if (!res.ok) {
    throw new ApiError(res.status, data.message || res.statusText, data.errors ?? []);
  }
  return data as T;
}

export function getHealth() {
  return request<HealthResponse>("/api/health");
}

export function getTree() {
  return request<TreeResponse>("/api/tree");
}

export function getIndex() {
  return request<IndexResponse>("/api/index");
}

export function getFile(path: string) {
  return request<FileResponse>(`/api/file?path=${encodeURIComponent(path)}`);
}

export function putFile(
  path: string,
  body: { text?: string; document?: SDocDocument },
  strict: boolean,
  force: boolean,
) {
  const query = new URLSearchParams({ path });
  if (strict) query.set("strict", "1");
  if (force) query.set("force", "1");
  return request<FileResponse>(`/api/file?${query}`, { method: "PUT", body: JSON.stringify(body) });
}

export function createDoc(body: { path: string; title: string; uid?: string; prefix?: string; root?: boolean }) {
  return request<FileResponse>("/api/file", { method: "POST", body: JSON.stringify(body) });
}

export function deleteDoc(path: string, force: boolean) {
  const query = new URLSearchParams({ path });
  if (force) query.set("force", "1");
  return request<{ ok: boolean }>(`/api/file?${query}`, { method: "DELETE" });
}

export function getNode(uid: string) {
  return request<NodeResponse>(`/api/node/${encodeURIComponent(uid)}`);
}

export function getGraph(from: string, depth: number) {
  const query = new URLSearchParams({ from, depth: String(depth) });
  return request<GraphResponse>(`/api/graph?${query}`);
}
