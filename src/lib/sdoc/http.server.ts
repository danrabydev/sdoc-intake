import type { SDocDocument } from "./types.ts";
import {
  addNode,
  buildIndex,
  buildTree,
  createDir,
  createFile,
  health,
  queryGraph,
  readFileView,
  readNode,
  removeFile,
  removeNode,
  saveFile,
  saveNode,
  SdocError,
  subscribe,
  type WriteFlags,
} from "./store.server.ts";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function requestUrl(request: Request): URL {
  try {
    return new URL(request.url);
  } catch {
    return new URL(request.url, "http://localhost");
  }
}

function flagsOf(url: URL): WriteFlags {
  return {
    strict: url.searchParams.get("strict") === "1",
    force: url.searchParams.get("force") === "1",
  };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 2_000_000) throw new SdocError(413, "Body too large.");
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SdocError(400, "Body must be a JSON object.");
    }
    return value as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SdocError) throw err;
    throw new SdocError(400, "Body must be JSON.");
  }
}

function events(request: Request): Response {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };
      send({ type: "hello" });
      unsubscribe = subscribe((event) => send({ type: "change", paths: event.paths }));
      ping = setInterval(() => send({ type: "ping" }), 25_000);
      const stop = () => {
        if (ping) clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* closed */
        }
      };
      request.signal.addEventListener("abort", stop);
    },
    cancel() {
      if (ping) clearInterval(ping);
      unsubscribe();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

async function fileRoute(method: string, url: URL, request: Request): Promise<Response> {
  if (method === "GET") {
    const path = url.searchParams.get("path") ?? "";
    return json(200, await readFileView(path));
  }
  if (method === "POST") {
    const body = await readJson(request);
    return json(
      201,
      await createFile({
        path: String(body.path ?? ""),
        title: String(body.title ?? ""),
        uid: typeof body.uid === "string" ? body.uid : undefined,
        prefix: typeof body.prefix === "string" ? body.prefix : undefined,
        root: body.root === true,
      }),
    );
  }
  if (method === "PUT") {
    const path = url.searchParams.get("path") ?? "";
    const body = await readJson(request);
    const payload: { text?: string; document?: SDocDocument } = {};
    if (typeof body.text === "string") payload.text = body.text;
    if (body.document && typeof body.document === "object") payload.document = body.document as SDocDocument;
    return json(200, await saveFile(path, payload, flagsOf(url)));
  }
  if (method === "DELETE") {
    const path = url.searchParams.get("path") ?? "";
    return json(200, await removeFile(path, url.searchParams.get("force") === "1"));
  }
  return json(405, { ok: false, message: "Method not allowed.", errors: [] });
}

async function nodeRoute(method: string, uidParts: string[], url: URL, request: Request): Promise<Response> {
  if (method === "POST" && uidParts.length === 0) {
    const body = await readJson(request);
    return json(
      201,
      await addNode(
        {
          file: String(body.file ?? ""),
          afterUid: typeof body.afterUid === "string" ? body.afterUid : undefined,
          title: typeof body.title === "string" ? body.title : undefined,
          statement: typeof body.statement === "string" ? body.statement : undefined,
        },
        flagsOf(url),
      ),
    );
  }
  const uid = decodeURIComponent(uidParts.join("/"));
  if (!uid) return json(404, { ok: false, message: "UID not found.", errors: [] });
  if (method === "GET") return json(200, await readNode(uid));
  if (method === "PUT") {
    const body = await readJson(request);
    const fields =
      body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
        ? (body.fields as Record<string, string>)
        : undefined;
    const relations = Array.isArray(body.relations)
      ? (body.relations as { type: "Parent" | "Child" | "File"; role?: string; value: string }[])
      : undefined;
    return json(200, await saveNode(uid, { fields, relations }, flagsOf(url)));
  }
  if (method === "DELETE") return json(200, await removeNode(uid, url.searchParams.get("force") === "1"));
  return json(405, { ok: false, message: "Method not allowed.", errors: [] });
}

export async function dispatch(request: Request): Promise<Response> {
  const url = requestUrl(request);
  const parts = decodeURIComponent(url.pathname)
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean);
  const head = parts[0] ?? "";
  const method = request.method.toUpperCase();
  try {
    if (method === "GET" && head === "health") return json(200, await health());
    if (method === "GET" && head === "tree") return json(200, await buildTree());
    if (method === "GET" && head === "index") return json(200, await buildIndex());
    if (method === "GET" && head === "events") return events(request);
    if (method === "GET" && head === "graph") {
      return json(200, await queryGraph(url.searchParams.get("from") ?? "", Number(url.searchParams.get("depth") ?? "2")));
    }
    if (head === "dir" && method === "POST") {
      const body = await readJson(request);
      return json(201, await createDir(String(body.path ?? "")));
    }
    if (head === "file") return await fileRoute(method, url, request);
    if (head === "node") return await nodeRoute(method, parts.slice(1), url, request);
    return json(404, { ok: false, message: "Not found.", errors: [] });
  } catch (err) {
    if (err instanceof SdocError) {
      return json(err.status, { ok: false, message: err.message, errors: err.errors });
    }
    console.error(err);
    return json(500, { ok: false, message: "Internal error.", errors: [] });
  }
}
