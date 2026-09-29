import type { FileResponse, GraphResponse, HealthResponse, IndexResponse, NodeResponse, TreeResponse } from "./api-types.ts";
import { ApiError } from "./api-error.ts";
import {
  browserCreate,
  browserDelete,
  browserFile,
  browserIndex,
  browserPut,
  browserTree,
} from "./browser-fs.ts";
import { activeMode } from "./fs-mode.ts";
import type { SDocDocument, SDocIssue } from "./types.ts";

export { ApiError };
export type { SDocIssue };

function local(): boolean {
  return activeMode() === "browser";
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

export async function probeServer(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as Partial<HealthResponse>;
    return data.ok === true && typeof data.fileCount === "number";
  } catch {
    return false;
  }
}

export function getHealth() {
  return request<HealthResponse>("/api/health");
}

export function getTree() {
  return local() ? browserTree() : request<TreeResponse>("/api/tree");
}

export function getIndex() {
  return local() ? browserIndex() : request<IndexResponse>("/api/index");
}

export function getFile(path: string) {
  return local() ? browserFile(path) : request<FileResponse>(`/api/file?path=${encodeURIComponent(path)}`);
}

export function putFile(
  path: string,
  body: { text?: string; document?: SDocDocument },
  strict: boolean,
  force: boolean,
) {
  if (local()) return browserPut(path, body, strict, force);
  const query = new URLSearchParams({ path });
  if (strict) query.set("strict", "1");
  if (force) query.set("force", "1");
  return request<FileResponse>(`/api/file?${query}`, { method: "PUT", body: JSON.stringify(body) });
}

export function createDoc(body: { path: string; title: string; uid?: string; prefix?: string; root?: boolean }) {
  return local() ? browserCreate(body) : request<FileResponse>("/api/file", { method: "POST", body: JSON.stringify(body) });
}

export function deleteDoc(path: string, force: boolean) {
  if (local()) return browserDelete(path, force);
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
