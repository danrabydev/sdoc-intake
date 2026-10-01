import type { FileResponse, GrammarResponse, IndexNode, TreeResponse } from "./api-types.ts";
import { ApiError } from "./api-error.ts";
import { defaultElements, defaultGrammar, resolveGrammarPath } from "./grammar.ts";
import { collectUids, flatten, indexDocument, nodeUid, parentEdges } from "./model.ts";
import { parse, parseGrammarFile } from "./parse.ts";
import { detachGrammar, serializeGrammarFile, textForWrite } from "./serialize.ts";
import type { Grammar, SDocDocument, SDocIssue, ValidateOptions } from "./types.ts";
import { validate } from "./validate.ts";

const SKIP_DIR = new Set(["node_modules", "output", ".git", "dist", ".output", "artifacts"]);
const IDB_NAME = "sdoc-intake";
const IDB_STORE = "handles";

interface Writable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface FileHandle {
  kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<Writable>;
}

interface DirHandle {
  name: string;
  kind: "directory";
  queryPermission(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  entries(): AsyncIterable<[string, DirHandle | FileHandle]>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
}

interface HeldFile {
  rel: string;
  text: string;
  parsed: ReturnType<typeof parse>;
}

interface Project {
  docs: HeldFile[];
  grammars: { rel: string; text: string }[];
  readText: (rel: string) => string | undefined;
}

let root: DirHandle | null = null;

function showPicker(): ((options: { mode: "readwrite"; id: string }) => Promise<DirHandle>) | undefined {
  return (
    window as unknown as {
      showDirectoryPicker?: (options: { mode: "readwrite"; id: string }) => Promise<DirHandle>;
    }
  ).showDirectoryPicker;
}

export function browserFolderName(): string {
  return root?.name ?? "";
}

export function assertDirRel(input: string): string {
  const cleaned = input.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/");
  if (!cleaned || parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new ApiError(400, "Folder must stay inside the picked folder.");
  }
  if (parts.some((part) => SKIP_DIR.has(part)) || cleaned.endsWith(".sdoc") || !/^[A-Za-z0-9._/-]+$/.test(cleaned)) {
    throw new ApiError(400, "Folder name contains unsupported characters.");
  }
  return cleaned;
}

export function assertSdocRel(input: string): string {
  return assertRel(input, ".sdoc");
}

function assertRel(input: string, ext: ".sdoc" | ".sgra"): string {
  const cleaned = input.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..") || cleaned.includes("\0") || !cleaned.endsWith(ext)) {
    throw new ApiError(400, `Path must be a ${ext} file inside the folder.`);
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(cleaned)) {
    throw new ApiError(400, "Path contains unsupported characters.");
  }
  return cleaned;
}

function requireRoot(): DirHandle {
  if (!root) throw new ApiError(400, "Open a folder on this computer first.");
  return root;
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open folder storage."));
  });
}

async function saveHandle(handle: DirHandle): Promise<void> {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, "root");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not remember the folder."));
  });
  db.close();
}

async function loadHandle(): Promise<DirHandle | null> {
  const db = await idb();
  const handle = await new Promise<DirHandle | null>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const request = tx.objectStore(IDB_STORE).get("root");
    request.onsuccess = () => resolve((request.result as DirHandle | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not read the saved folder."));
  });
  db.close();
  return handle;
}

export async function restoreBrowserFolder(): Promise<boolean> {
  try {
    const handle = await loadHandle();
    if (!handle) return false;
    const permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") return false;
    root = handle;
    return true;
  } catch {
    return false;
  }
}

export async function openBrowserFolder(): Promise<boolean> {
  const picker = showPicker();
  if (typeof picker !== "function") {
    throw new ApiError(400, "This browser cannot open a local folder. Use Chrome or Edge.");
  }
  try {
    const handle = await picker({ mode: "readwrite", id: "sdoc-intake" });
    root = handle;
    await saveHandle(handle);
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return false;
    throw err;
  }
}

async function walk(
  dir: DirHandle,
  prefix: string,
  out: { rel: string; handle: FileHandle }[],
  dirs?: string[],
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith(".") || SKIP_DIR.has(name)) continue;
    if (handle.kind === "directory") {
      const rel = `${prefix}${name}`;
      dirs?.push(rel);
      await walk(handle, `${rel}/`, out, dirs);
      continue;
    }
    if (
      handle.kind === "file" &&
      (name.endsWith(".sdoc") || name.endsWith(".sgra")) &&
      !name.includes(".tmp-")
    ) {
      out.push({ rel: `${prefix}${name}`, handle });
    }
  }
}

async function corpus(): Promise<Project> {
  const found: { rel: string; handle: FileHandle }[] = [];
  await walk(requireRoot(), "", found);
  found.sort((a, b) => a.rel.localeCompare(b.rel));
  const texts = new Map<string, string>();
  const docs: HeldFile[] = [];
  const grammars: { rel: string; text: string }[] = [];
  for (const file of found) {
    try {
      const text = await (await file.handle.getFile()).text();
      texts.set(file.rel, text);
      if (file.rel.endsWith(".sgra")) {
        grammars.push({ rel: file.rel, text });
        continue;
      }
      if (!file.rel.endsWith(".sdoc")) continue;
      docs.push({ rel: file.rel, text, parsed: parse(text) });
    } catch {
      continue;
    }
  }
  return { docs, grammars, readText: (rel) => texts.get(rel) };
}

function contextFor(project: Project, rel: string, flags: { mode: "read" | "write"; strict?: boolean }): ValidateOptions {
  const siblingUids: string[] = [];
  const siblingEdges: { from: string; to: string }[] = [];
  for (const file of project.docs) {
    if (file.rel === rel || !file.parsed.document) continue;
    siblingUids.push(...collectUids(file.parsed.document));
    siblingEdges.push(...parentEdges(file.parsed.document));
  }
  return {
    siblingUids,
    siblingEdges,
    mode: flags.mode,
    strict: flags.strict === true,
    indexComplete: true,
    file: rel,
    readText: project.readText,
  };
}

function indexNodes(all: HeldFile[]): IndexNode[] {
  const nodes: IndexNode[] = [];
  for (const file of all) {
    if (!file.parsed.document) continue;
    nodes.push(...indexDocument(file.rel, file.parsed.document));
  }
  return nodes;
}

function toFileResponse(rel: string, text: string, project: Project, mode: "read" | "write"): FileResponse {
  const ctx = contextFor(project, rel, { mode });
  const result = validate(text, ctx);
  const parsed = parse(text);
  return {
    ok: result.ok,
    path: rel,
    text,
    document: result.document,
    errors: result.errors,
    parseFailed: parsed.errors.some((issue) => issue.severity === "error"),
    siblingUids: [...(ctx.siblingUids ?? [])],
    siblingEdges: [...(ctx.siblingEdges ?? [])],
  };
}

async function fileHandle(rel: string, create: boolean, ext: ".sdoc" | ".sgra" = ".sdoc"): Promise<FileHandle> {
  const cleaned = assertRel(rel, ext);
  let dir = requireRoot();
  const parts = cleaned.split("/");
  for (let index = 0; index < parts.length - 1; index += 1) {
    try {
      dir = await dir.getDirectoryHandle(parts[index]!, { create });
    } catch {
      throw new ApiError(404, "File not found.");
    }
  }
  try {
    return await dir.getFileHandle(parts[parts.length - 1]!, { create });
  } catch {
    throw new ApiError(404, "File not found.");
  }
}

async function readText(rel: string): Promise<string> {
  return (await (await fileHandle(rel, false)).getFile()).text();
}

async function writeText(rel: string, text: string, create: boolean, ext: ".sdoc" | ".sgra" = ".sdoc"): Promise<void> {
  const handle = await fileHandle(rel, create, ext);
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

function referencedRemovals(all: HeldFile[], rel: string, previous: SDocDocument | null, next: SDocDocument): SDocIssue[] {
  if (!previous) return [];
  const kept = new Set(collectUids(next));
  const removed = collectUids(previous).filter((uid) => !kept.has(uid));
  if (removed.length === 0) return [];
  const removedSet = new Set(removed);
  const issues: SDocIssue[] = [];
  for (const file of all) {
    if (file.rel === rel || !file.parsed.document) continue;
    for (const row of flatten(file.parsed.document.nodes)) {
      const from = nodeUid(row.node);
      for (const relation of row.node.relations) {
        if (relation.type === "Parent" && removedSet.has(relation.value)) {
          issues.push({
            line: relation.line,
            col: 1,
            path: "graph",
            message: `${from || file.rel} in ${file.rel} parents ${relation.value}.`,
            severity: "error",
            code: "referenced-uid",
            uid: relation.value,
            file: file.rel,
          });
        }
      }
    }
  }
  return issues;
}

async function commit(rel: string, text: string, flags: { strict?: boolean; force?: boolean }, create: boolean): Promise<FileResponse> {
  const project = await corpus();
  const ctx = contextFor(project, rel, { ...flags, mode: "write" });
  const result = validate(text, ctx);
  if (!result.ok || !result.document) throw new ApiError(422, "Invalid SDoc.", result.errors);
  if (!flags.force) {
    const previous = project.docs.find((file) => file.rel === rel)?.parsed.document ?? null;
    const blocked = referencedRemovals(project.docs, rel, previous, result.document);
    if (blocked.length > 0) {
      throw new ApiError(409, "Other nodes parent-point at a UID this save removes.", blocked);
    }
  }
  const previousText = create ? null : await readText(rel).catch(() => null);
  await writeText(rel, text, create);
  const back = await readText(rel);
  const again = validate(back, ctx);
  if (!again.ok) {
    if (previousText !== null) await writeText(rel, previousText, false);
    throw new ApiError(422, "Read-back validation failed.", again.errors);
  }
  const fresh = await corpus();
  return toFileResponse(rel, text, fresh, "read");
}

export async function browserCreateDir(rel: string): Promise<{ ok: boolean; path: string }> {
  const cleaned = assertDirRel(rel);
  let dir = requireRoot();
  for (const part of cleaned.split("/")) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return { ok: true, path: cleaned };
}

export async function browserTree(): Promise<TreeResponse> {
  const found: { rel: string; handle: FileHandle }[] = [];
  const dirs: string[] = [];
  await walk(requireRoot(), "", found, dirs);
  const project = await corpus();
  const documents = project.docs.map((file) => {
    const doc = file.parsed.document;
    return {
      path: file.rel,
      title: doc?.title || file.rel,
      uid: doc?.uid ?? "",
      nodeCount: doc ? flatten(doc.nodes).length : 0,
      issueCount: file.parsed.errors.filter((issue) => issue.severity === "error").length,
      kind: "sdoc" as const,
    };
  });
  const grammars = project.grammars.map((file) => {
    const parsed = parseGrammarFile(file.text);
    return {
      path: file.rel,
      title: "Grammar",
      uid: "",
      nodeCount: parsed.grammar?.elements.length ?? 0,
      issueCount: parsed.errors.filter((issue) => issue.severity === "error").length,
      kind: "sgra" as const,
    };
  });
  return {
    root: browserFolderName(),
    dirs: dirs.sort((a, b) => a.localeCompare(b)),
    files: [...documents, ...grammars].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export async function browserIndex(): Promise<{ nodes: IndexNode[] }> {
  return { nodes: indexNodes((await corpus()).docs) };
}

export async function browserFile(rel: string): Promise<FileResponse> {
  const text = await readText(rel);
  return toFileResponse(rel, text, await corpus(), "read");
}

export async function browserPut(
  rel: string,
  body: { text?: string; document?: SDocDocument },
  strict: boolean,
  force: boolean,
): Promise<FileResponse> {
  assertSdocRel(rel);
  let text: string;
  if (body.document) {
    if (typeof body.document.title !== "string" || !Array.isArray(body.document.nodes)) {
      throw new ApiError(400, "Document JSON must include title and nodes.");
    }
    text = textForWrite({
      ...body.document,
      grammar: body.document.grammar?.elements ? body.document.grammar : defaultGrammar(),
    });
  } else if (typeof body.text === "string") {
    const preview = parse(body.text);
    if (!preview.document || preview.errors.some((issue) => issue.severity === "error")) {
      throw new ApiError(422, "Invalid SDoc.", preview.errors);
    }
    const project = await corpus();
    const checked = validate(body.text, contextFor(project, rel, { mode: "write", strict }));
    if (!checked.ok || !checked.document) throw new ApiError(422, "Invalid SDoc.", checked.errors);
    text = textForWrite(checked.document);
  } else {
    throw new ApiError(400, "Body must be { text } or { document }.");
  }
  try {
    await readText(rel);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw err;
    throw new ApiError(404, "File not found.");
  }
  return commit(rel, text, { strict, force }, false);
}

export async function browserCreate(input: {
  path: string;
  title: string;
  uid?: string;
  prefix?: string;
  root?: boolean;
}): Promise<FileResponse> {
  const rel = assertSdocRel(input.path);
  try {
    await readText(rel);
    throw new ApiError(409, "File already exists.");
  } catch (err) {
    if (err instanceof ApiError && err.status !== 404) throw err;
  }
  if (!input.title?.trim()) throw new ApiError(400, "Title is required.");
  const document: SDocDocument = {
    title: input.title.trim(),
    uid: input.uid?.trim() || undefined,
    prefix: input.prefix?.trim() || undefined,
    root: Boolean(input.root),
    grammar: defaultGrammar(),
    nodes: [],
  };
  return commit(rel, textForWrite(document), {}, true);
}

export async function browserDelete(rel: string, force: boolean): Promise<{ ok: boolean }> {
  if (rel.endsWith(".sgra")) return browserDeleteGrammar(rel, force);
  const text = await readText(rel);
  const parsed = parse(text);
  if (!parsed.document && !force) throw new ApiError(409, "File does not parse. Pass force=1 to delete it.");
  if ((parsed.document?.nodes.length ?? 0) > 0 && !force) {
    throw new ApiError(409, "File is not empty. Pass force=1 to delete it.");
  }
  const cleaned = assertSdocRel(rel);
  const parts = cleaned.split("/");
  let dir = requireRoot();
  for (let index = 0; index < parts.length - 1; index += 1) {
    dir = await dir.getDirectoryHandle(parts[index]!);
  }
  await dir.removeEntry(parts[parts.length - 1]!);
  return { ok: true };
}

function grammarView(rel: string, text: string): GrammarResponse {
  const parsed = parseGrammarFile(text);
  return {
    ok: parsed.grammar !== null && !parsed.errors.some((issue) => issue.severity === "error"),
    path: rel,
    text,
    grammar: parsed.grammar,
    errors: parsed.errors,
  };
}

async function readGrammarText(rel: string): Promise<string> {
  return (await (await fileHandle(rel, false, ".sgra")).getFile()).text();
}

export async function browserReadGrammar(rel: string): Promise<GrammarResponse> {
  return grammarView(rel, await readGrammarText(rel));
}

export async function browserSaveGrammar(rel: string, body: { text?: string; grammar?: Grammar }): Promise<GrammarResponse> {
  await readGrammarText(rel);
  const text = grammarBody(body);
  await writeText(assertRel(rel, ".sgra"), text, false, ".sgra");
  return grammarView(rel, text);
}

export async function browserCreateGrammar(rel: string, text?: string): Promise<GrammarResponse> {
  const cleaned = assertRel(rel, ".sgra");
  try {
    await readGrammarText(cleaned);
    throw new ApiError(409, "Grammar file already exists.");
  } catch (err) {
    if (err instanceof ApiError && err.status !== 404) throw err;
  }
  const written = text === undefined ? serializeGrammarFile(defaultElements()) : grammarBody({ text });
  await writeText(cleaned, written, true, ".sgra");
  return grammarView(cleaned, written);
}

export async function browserMoveGrammar(documentPath: string, grammarPath: string): Promise<FileResponse> {
  const current = await browserFile(documentPath);
  if (!current.document || current.parseFailed) throw new ApiError(422, "Document does not parse.", current.errors);
  const detached = detachGrammar(current.document, documentPath, grammarPath);
  if ("error" in detached) throw new ApiError(400, detached.error);
  await browserCreateGrammar(grammarPath, detached.text);
  try {
    return await browserPut(documentPath, { document: detached.document }, false, false);
  } catch (err) {
    await browserDeleteGrammar(grammarPath, true);
    throw err;
  }
}

function grammarBody(body: { text?: string; grammar?: Grammar }): string {
  if (body.grammar) {
    if (body.grammar.importFrom) throw new ApiError(400, "A grammar file cannot import another grammar file.");
    const text = serializeGrammarFile(body.grammar.elements);
    const parsed = parseGrammarFile(text);
    if (!parsed.grammar || parsed.errors.some((issue) => issue.severity === "error")) {
      throw new ApiError(422, "Invalid grammar.", parsed.errors);
    }
    return text;
  }
  if (typeof body.text === "string") {
    const parsed = parseGrammarFile(body.text);
    if (!parsed.grammar || parsed.errors.some((issue) => issue.severity === "error")) {
      throw new ApiError(422, "Invalid grammar.", parsed.errors);
    }
    return serializeGrammarFile(parsed.grammar.elements);
  }
  throw new ApiError(400, "Body must be { text } or { grammar }.");
}

async function browserDeleteGrammar(rel: string, force: boolean): Promise<{ ok: boolean }> {
  const cleaned = assertRel(rel, ".sgra");
  await readGrammarText(cleaned);
  const project = await corpus();
  const used = project.docs.filter((file) => {
    const spec = file.parsed.document?.grammar.importFrom;
    return spec ? resolveGrammarPath(file.rel, spec) === cleaned : false;
  });
  if (used.length > 0 && !force) throw new ApiError(409, `Imported by ${used.map((file) => file.rel).join(", ")}.`);
  const parts = cleaned.split("/");
  let dir = requireRoot();
  for (let index = 0; index < parts.length - 1; index += 1) dir = await dir.getDirectoryHandle(parts[index]!);
  await dir.removeEntry(parts[parts.length - 1]!);
  return { ok: true };
}

export function subscribeBrowser(onChange: () => void): () => void {
  const handle = root;
  const Observer = (
    globalThis as {
      FileSystemObserver?: new (cb: () => void) => {
        observe: (target: DirHandle, opts?: { recursive?: boolean }) => Promise<void>;
        disconnect: () => void;
      };
    }
  ).FileSystemObserver;
  if (!handle || typeof Observer !== "function") return () => undefined;
  const observer = new Observer(() => onChange());
  void observer.observe(handle, { recursive: true }).catch(() => undefined);
  return () => observer.disconnect();
}
