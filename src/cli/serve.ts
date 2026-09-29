import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import type { CliArgs } from "./args.ts";
import { dispatch } from "../lib/sdoc/http.server.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

function clientDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "client");
}

function shellFile(): string {
  const dir = clientDir();
  const named = join(dir, "cli.html");
  if (existsSync(named)) return named;
  return join(dir, "index.html");
}

function insideClient(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const rel = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = resolve(clientDir(), `.${rel.startsWith("/") ? rel : `/${rel}`}`);
  const root = resolve(clientDir());
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

async function sendFile(res: ServerResponse, file: string, headOnly: boolean): Promise<void> {
  const type = MIME[extname(file)] ?? "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("content-type", type);
  res.setHeader("cache-control", extname(file) === ".html" ? "no-cache" : "public, max-age=31536000, immutable");
  if (headOnly) {
    res.end();
    return;
  }
  await pipeline(createReadStream(file), res);
}

async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), res);
}

function toRequest(req: IncomingMessage, host: string): Request {
  const method = (req.method ?? "GET").toUpperCase();
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req) as unknown as BodyInit;
    init.duplex = "half";
  }
  return new Request(`http://${host}${req.url ?? "/"}`, init);
}

export function start(args: CliArgs): Promise<void> {
  process.env.SDOC_ROOT = args.root;
  process.env.SDOC_WATCH = args.watch ? "true" : "false";
  const shell = shellFile();

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const host = req.headers.host ?? `${args.host}:${args.port}`;
        const url = new URL(req.url ?? "/", `http://${host}`);
        if (args.openFile && (url.pathname === "/" || url.pathname === "/cli.html") && !url.searchParams.get("file")) {
          url.searchParams.set("file", args.openFile);
          res.statusCode = 302;
          res.setHeader("location", `/?${url.searchParams.toString()}`);
          res.end();
          return;
        }
        if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
          await sendResponse(res, await dispatch(toRequest(req, host)));
          return;
        }
        const method = (req.method ?? "GET").toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const file = insideClient(url.pathname);
        if (file && existsSync(file) && statSync(file).isFile()) {
          await sendFile(res, file, method === "HEAD");
          return;
        }
        if (url.pathname.startsWith("/assets/")) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        if (!existsSync(shell)) {
          res.statusCode = 500;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end("CLI client was not built. Run pnpm build:cli.");
          return;
        }
        await sendFile(res, shell, method === "HEAD");
      } catch (err) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "text/plain; charset=utf-8");
        }
        res.end(err instanceof Error ? err.message : "Internal error");
      }
    })();
  });

  return new Promise((resolveListen, reject) => {
    server.on("error", reject);
    server.listen(args.port, args.host, () => {
      const where = args.host === "0.0.0.0" ? "127.0.0.1" : args.host;
      console.log(`SDoc Intake`);
      console.log(`Documents  ${args.root}`);
      if (args.openFile) console.log(`Opened     ${args.openFile}`);
      console.log(`Listening  http://${where}:${args.port}`);
      resolveListen();
    });
  });
}
