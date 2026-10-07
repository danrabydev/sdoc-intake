import { statSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

export const CLI_VERSION = "0.1.0";

export const HELP = `sdoc-intake — edit a StrictDoc tree in the browser

Usage
  sdoc-intake [path] [--port 8087] [--host 127.0.0.1]

path is a directory of .sdoc files, or one .sdoc file.
When it is a file, that file opens and its folder is the document root.
When omitted, the current directory is the document root.

Options
  -p, --port <n>   Port to listen on (default 8087)
      --host <h>   Host to bind (default 127.0.0.1)
      --root <dir> Document root. Same as passing a directory.
      --no-watch   Do not reload when files change on disk
  -h, --help       Show this help
  -v, --version    Print the version
`;

export interface CliArgs {
  root: string;
  openFile: string | null;
  port: number;
  host: string;
  watch: boolean;
}

export type ParseResult = { ok: true; help: true } | { ok: true; version: true } | { ok: true; args: CliArgs } | { ok: false; error: string };

function kindOf(path: string): "dir" | "file" | "missing" | "other" {
  try {
    const stat = statSync(path);
    if (stat.isDirectory()) return "dir";
    if (stat.isFile()) return "file";
    return "other";
  } catch {
    return "missing";
  }
}

function takeValue(argv: string[], index: number, flag: string): { value: string; next: number } | { error: string } {
  const inline = argv[index]?.includes("=") ? argv[index]!.slice(argv[index]!.indexOf("=") + 1) : "";
  if (inline) return { value: inline, next: index };
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) return { error: `${flag} needs a value.` };
  return { value, next: index + 1 };
}

export function parseArgs(argv: string[], cwd: string): ParseResult {
  let port = 8087;
  let host = "127.0.0.1";
  let watch = true;
  let rootFlag: string | null = null;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token === "-h" || token === "--help") return { ok: true, help: true };
    if (token === "-v" || token === "--version") return { ok: true, version: true };
    if (token === "--no-watch") {
      watch = false;
      continue;
    }
    if (token === "--port" || token === "-p" || token.startsWith("--port=")) {
      const taken = takeValue(argv, i, "--port");
      if ("error" in taken) return { ok: false, error: taken.error };
      const parsed = Number(taken.value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return { ok: false, error: `Port must be an integer from 1 to 65535.` };
      }
      port = parsed;
      i = taken.next;
      continue;
    }
    if (token === "--host" || token.startsWith("--host=")) {
      const taken = takeValue(argv, i, "--host");
      if ("error" in taken) return { ok: false, error: taken.error };
      if (!taken.value.trim()) return { ok: false, error: "--host needs a value." };
      host = taken.value.trim();
      i = taken.next;
      continue;
    }
    if (token === "--root" || token.startsWith("--root=")) {
      const taken = takeValue(argv, i, "--root");
      if ("error" in taken) return { ok: false, error: taken.error };
      rootFlag = taken.value;
      i = taken.next;
      continue;
    }
    if (token.startsWith("-")) return { ok: false, error: `Unknown option ${token}.` };
    positionals.push(token);
  }

  if (positionals.length > 1) return { ok: false, error: "Pass one path, or none to use the current directory." };
  if (rootFlag && positionals.length > 0) return { ok: false, error: "Use either a path or --root, not both." };

  const requested = rootFlag ?? positionals[0] ?? cwd;
  const absolute = isAbsolute(requested) ? requested : resolve(cwd, requested);
  const kind = kindOf(absolute);
  if (kind === "missing") return { ok: false, error: `Path not found: ${absolute}` };
  if (kind === "other") return { ok: false, error: `Path is not a directory or a .sdoc file: ${absolute}` };

  if (kind === "file") {
    if (!absolute.endsWith(".sdoc")) return { ok: false, error: `File must end in .sdoc: ${absolute}` };
    return {
      ok: true,
      args: { root: resolve(absolute, ".."), openFile: basename(absolute), port, host, watch },
    };
  }

  return { ok: true, args: { root: absolute, openFile: null, port, host, watch } };
}
