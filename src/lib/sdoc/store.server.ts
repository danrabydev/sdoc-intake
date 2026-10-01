import { execFile } from "node:child_process";
import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { FileResponse, GrammarResponse, IndexNode, NodeResponse, TreeResponse } from "./api-types.ts";
import { buildGraph } from "./graph.ts";
import { defaultElements, defaultGrammar, resolveGrammarPath } from "./grammar.ts";
import {
  collectUids,
  fieldOf,
  flatten,
  insertAfter,
  indexDocument,
  nextUid,
  nodeUid,
  parentEdges,
  removeUid,
  requirementNode,
  withField,
  withRelations,
  mapAt,
} from "./model.ts";
import { parse, parseGrammarFile } from "./parse.ts";
import { detachGrammar, serializeGrammarFile, textForWrite } from "./serialize.ts";
import type { Grammar, SDocDocument, SDocIssue, SDocNode, ValidateOptions } from "./types.ts";
import { validate } from "./validate.ts";

const execFileAsync = promisify(execFile);
const SKIP_DIR = new Set(["node_modules", "output", ".git", "dist", ".output", "artifacts"]);

export class SdocError extends Error {
  readonly status: number;
  readonly errors: SDocIssue[];

  constructor(status: number, message: string, errors: SDocIssue[] = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export interface WriteFlags {
  strict?: boolean;
  force?: boolean;
}

interface CorpusFile {
  rel: string;
  abs: string;
  text: string;
  parsed: ReturnType<typeof parse>;
}

interface Project {
  docs: CorpusFile[];
  grammars: { rel: string; text: string }[];
  readText: (rel: string) => string | undefined;
}

export function sdocRoot(): string {
  const raw = process.env.SDOC_ROOT?.trim() || "data";
  return resolve(process.cwd(), raw);
}

export function displayRoot(): string {
  const abs = sdocRoot();
  const rel = relative(process.cwd(), abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return abs;
  return rel;
}

export function resolveInside(input: string): { rel: string; abs: string } {
  const cleaned = input.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..") || cleaned.includes("\0") || !cleaned.endsWith(".sdoc")) {
    throw new SdocError(400, "Path must be a .sdoc file inside the data root.");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(cleaned)) {
    throw new SdocError(400, "Path contains unsupported characters.");
  }
  const root = sdocRoot();
  const abs = resolve(root, cleaned);
  const back = relative(root, abs);
  if (back.startsWith("..") || isAbsolute(back)) {
    throw new SdocError(400, "Path escapes the data root.");
  }
  return { rel: cleaned, abs };
}

function resolveGrammarFile(input: string): { rel: string; abs: string } {
  const cleaned = input.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..") || cleaned.includes("\0") || !cleaned.endsWith(".sgra")) {
    throw new SdocError(400, "Path must be a .sgra file inside the data root.");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(cleaned)) {
    throw new SdocError(400, "Path contains unsupported characters.");
  }
  const root = sdocRoot();
  const abs = resolve(root, cleaned);
  const back = relative(root, abs);
  if (back.startsWith("..") || isAbsolute(back)) throw new SdocError(400, "Path escapes the data root.");
  return { rel: cleaned, abs };
}

async function writeGrammarFile(abs: string, text: string): Promise<void> {
  await mkdir(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, text, "utf8");
    await rename(tmp, abs);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
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

async function ensureRoot(): Promise<void> {
  await mkdir(sdocRoot(), { recursive: true });
}

async function walk(
  dir: string,
  root: string,
  out: { rel: string; abs: string }[],
  dirs?: string[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIR.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      dirs?.push(relative(root, abs).split(sep).join("/"));
      await walk(abs, root, out, dirs);
      continue;
    }
    if (!entry.isFile() || entry.name.includes(".tmp-")) continue;
    if (!entry.name.endsWith(".sdoc") && !entry.name.endsWith(".sgra")) continue;
    out.push({ rel: relative(root, abs).split(sep).join("/"), abs });
  }
}

async function corpus(): Promise<Project> {
  await ensureRoot();
  const root = sdocRoot();
  const found: { rel: string; abs: string }[] = [];
  await walk(root, root, found);
  found.sort((a, b) => a.rel.localeCompare(b.rel));
  const texts = new Map<string, string>();
  const docs: CorpusFile[] = [];
  const grammars: { rel: string; text: string }[] = [];
  for (const file of found) {
    try {
      const text = await readFile(file.abs, "utf8");
      texts.set(file.rel, text);
      if (file.rel.endsWith(".sgra")) {
        grammars.push({ rel: file.rel, text });
        continue;
      }
      docs.push({ ...file, text, parsed: parse(text) });
    } catch {
      continue;
    }
  }
  return { docs, grammars, readText: (rel) => texts.get(rel) };
}

function contextFor(project: Project, rel: string, flags: WriteFlags & { mode: "read" | "write" }): ValidateOptions {
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

function indexNodes(all: CorpusFile[]): IndexNode[] {
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

export function resolveDir(input: string): { rel: string; abs: string } {
  const cleaned = input.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/");
  if (
    !cleaned ||
    parts.some((part) => !part || part === "." || part === ".." || part.startsWith(".") || SKIP_DIR.has(part))
  ) {
    throw new SdocError(400, "Folder must stay inside the data root.");
  }
  if (cleaned.endsWith(".sdoc") || !/^[A-Za-z0-9._/-]+$/.test(cleaned)) {
    throw new SdocError(400, "Folder name contains unsupported characters.");
  }
  const root = sdocRoot();
  const abs = resolve(root, cleaned);
  const back = relative(root, abs);
  if (back.startsWith("..") || isAbsolute(back)) throw new SdocError(400, "Path escapes the data root.");
  return { rel: cleaned, abs };
}

export async function createDir(input: string): Promise<{ ok: boolean; path: string }> {
  const { rel, abs } = resolveDir(input);
  await mkdir(abs, { recursive: true });
  return { ok: true, path: rel };
}

export async function health(): Promise<{ ok: boolean; root: string; fileCount: number }> {
  const project = await corpus();
  return { ok: true, root: displayRoot(), fileCount: project.docs.length };
}

export async function buildTree(): Promise<TreeResponse> {
  await ensureRoot();
  const rootPath = sdocRoot();
  const found: { rel: string; abs: string }[] = [];
  const dirs: string[] = [];
  await walk(rootPath, rootPath, found, dirs);
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
    root: displayRoot(),
    dirs: dirs.sort((a, b) => a.localeCompare(b)),
    files: [...documents, ...grammars].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export async function buildIndex(): Promise<{ nodes: IndexNode[] }> {
  return { nodes: indexNodes((await corpus()).docs) };
}

export async function readFileView(rel: string): Promise<FileResponse> {
  const { abs } = resolveInside(rel);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    throw new SdocError(404, "File not found.");
  }
  const project = await corpus();
  return toFileResponse(rel, text, project, "read");
}

function normalizeDocument(input: SDocDocument): SDocDocument {
  if (!input || typeof input.title !== "string" || !Array.isArray(input.nodes)) {
    throw new SdocError(400, "Document JSON must include title and nodes.");
  }
  return {
    ...input,
    title: input.title,
    grammar: input.grammar?.elements ? input.grammar : defaultGrammar(),
    nodes: input.nodes,
  };
}

async function strictDocSecondary(text: string): Promise<SDocIssue | null> {
  const bin = process.env.SDOC_STRICTDOC_BIN?.trim();
  if (!bin) return null;
  const dir = await mkdtemp(join(tmpdir(), "sdoc-check-"));
  try {
    const file = join(dir, "input.sdoc");
    await writeFile(file, text, "utf8");
    try {
      await execFileAsync(bin, ["export", file, "--formats=sdoc"], { timeout: 20000 });
      return null;
    } catch (err) {
      const error = err as NodeJS.ErrnoException & { stderr?: string | Buffer };
      if (error.code === "ENOENT") return null;
      const stderr = String(error.stderr ?? error.message ?? "export failed").slice(0, 500);
      return {
        line: 1,
        col: 1,
        path: "strictdoc",
        message: `strictdoc: ${stderr}`,
        severity: "error",
        code: "strictdoc",
      };
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function referencedRemovals(all: CorpusFile[], rel: string, previous: SDocDocument | null, next: SDocDocument): SDocIssue[] {
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

async function atomicWrite(abs: string, text: string, ctx: ValidateOptions): Promise<void> {
  await mkdir(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, text, "utf8");
    const back = await readFile(tmp, "utf8");
    const again = validate(back, ctx);
    if (!again.ok) throw new SdocError(422, "Read-back validation failed.", again.errors);
    await rename(tmp, abs);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

async function commit(rel: string, text: string, flags: WriteFlags): Promise<FileResponse> {
  const { abs } = resolveInside(rel);
  const project = await corpus();
  const ctx = contextFor(project, rel, { ...flags, mode: "write" });
  const result = validate(text, ctx);
  if (!result.ok || !result.document) {
    throw new SdocError(422, "Invalid SDoc.", result.errors);
  }
  if (!flags.force) {
    const previous = project.docs.find((file) => file.rel === rel)?.parsed.document ?? null;
    const blocked = referencedRemovals(project.docs, rel, previous, result.document);
    if (blocked.length > 0) {
      throw new SdocError(409, "Other nodes parent-point at a UID this save removes.", blocked);
    }
  }
  const secondary = await strictDocSecondary(text);
  if (secondary) throw new SdocError(422, secondary.message, [secondary]);
  await atomicWrite(abs, text, ctx);
  const fresh = await corpus();
  return toFileResponse(rel, text, fresh, "read");
}

export async function saveFile(
  rel: string,
  body: { text?: string; document?: SDocDocument },
  flags: WriteFlags = {},
): Promise<FileResponse> {
  resolveInside(rel);
  let text: string;
  if (body.document) {
    text = textForWrite(normalizeDocument(body.document));
  } else if (typeof body.text === "string") {
    const preview = parse(body.text);
    if (!preview.document || preview.errors.some((issue) => issue.severity === "error")) {
      throw new SdocError(422, "Invalid SDoc.", preview.errors);
    }
    const project = await corpus();
    const checked = validate(body.text, contextFor(project, rel, { ...flags, mode: "write" }));
    if (!checked.ok || !checked.document) throw new SdocError(422, "Invalid SDoc.", checked.errors);
    text = textForWrite(checked.document);
  } else {
    throw new SdocError(400, "Body must be { text } or { document }.");
  }
  try {
    await readFile(resolveInside(rel).abs, "utf8");
  } catch {
    throw new SdocError(404, "File not found.");
  }
  return commit(rel, text, flags);
}

export async function createFile(input: {
  path: string;
  title: string;
  uid?: string;
  prefix?: string;
  root?: boolean;
}): Promise<FileResponse> {
  const { rel, abs } = resolveInside(input.path);
  await ensureRoot();
  try {
    await readFile(abs, "utf8");
    throw new SdocError(409, "File already exists.");
  } catch (err) {
    if (err instanceof SdocError) throw err;
  }
  if (!input.title?.trim()) throw new SdocError(400, "Title is required.");
  const document: SDocDocument = {
    title: input.title.trim(),
    uid: input.uid?.trim() || undefined,
    prefix: input.prefix?.trim() || undefined,
    root: Boolean(input.root),
    grammar: defaultGrammar(),
    nodes: [],
  };
  return commit(rel, textForWrite(document), {});
}

export async function readGrammar(rel: string): Promise<GrammarResponse> {
  const { abs } = resolveGrammarFile(rel);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    throw new SdocError(404, "Grammar file not found.");
  }
  return grammarView(rel, text);
}

export async function saveGrammar(
  rel: string,
  body: { text?: string; grammar?: Grammar },
): Promise<GrammarResponse> {
  const { abs } = resolveGrammarFile(rel);
  try {
    await readFile(abs, "utf8");
  } catch {
    throw new SdocError(404, "Grammar file not found.");
  }
  const text = grammarBody(body);
  await writeGrammarFile(abs, text);
  return grammarView(rel, text);
}

export async function createGrammar(rel: string, text?: string): Promise<GrammarResponse> {
  const { abs } = resolveGrammarFile(rel);
  await ensureRoot();
  try {
    await readFile(abs, "utf8");
    throw new SdocError(409, "Grammar file already exists.");
  } catch (err) {
    if (err instanceof SdocError) throw err;
  }
  const written = text === undefined ? serializeGrammarFile(defaultElements()) : grammarBody({ text });
  await writeGrammarFile(abs, written);
  return grammarView(rel, written);
}

export async function moveDocumentGrammar(documentPath: string, grammarPath: string): Promise<FileResponse> {
  const view = await readFileView(documentPath);
  if (!view.document || view.parseFailed) throw new SdocError(422, "Document does not parse.", view.errors);
  const detached = detachGrammar(view.document, documentPath, grammarPath);
  if ("error" in detached) throw new SdocError(400, detached.error);
  await createGrammar(grammarPath, detached.text);
  try {
    return await saveFile(documentPath, { document: detached.document });
  } catch (err) {
    await rm(resolveGrammarFile(grammarPath).abs, { force: true });
    throw err;
  }
}

function grammarBody(body: { text?: string; grammar?: Grammar }): string {
  if (body.grammar) {
    if (body.grammar.importFrom) throw new SdocError(400, "A grammar file cannot import another grammar file.");
    if (!Array.isArray(body.grammar.elements)) throw new SdocError(400, "Grammar needs elements.");
    const text = serializeGrammarFile(body.grammar.elements);
    const parsed = parseGrammarFile(text);
    if (!parsed.grammar || parsed.errors.some((issue) => issue.severity === "error")) {
      throw new SdocError(422, "Invalid grammar.", parsed.errors);
    }
    return text;
  }
  if (typeof body.text === "string") {
    const parsed = parseGrammarFile(body.text);
    if (!parsed.grammar || parsed.errors.some((issue) => issue.severity === "error")) {
      throw new SdocError(422, "Invalid grammar.", parsed.errors);
    }
    return serializeGrammarFile(parsed.grammar.elements);
  }
  throw new SdocError(400, "Body must be { text } or { grammar }.");
}

export async function removeFile(rel: string, force: boolean): Promise<{ ok: boolean }> {
  if (rel.replace(/\\/g, "/").endsWith(".sgra")) return removeGrammar(rel, force);
  const { abs } = resolveInside(rel);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    throw new SdocError(404, "File not found.");
  }
  const parsed = parse(text);
  if (!parsed.document && !force) {
    throw new SdocError(409, "File does not parse. Pass force=1 to delete it.");
  }
  if ((parsed.document?.nodes.length ?? 0) > 0 && !force) {
    throw new SdocError(409, "File is not empty. Pass force=1 to delete it.");
  }
  await rm(abs);
  return { ok: true };
}

async function removeGrammar(rel: string, force: boolean): Promise<{ ok: boolean }> {
  const { abs } = resolveGrammarFile(rel);
  try {
    await readFile(abs, "utf8");
  } catch {
    throw new SdocError(404, "Grammar file not found.");
  }
  const project = await corpus();
  const used = project.docs.filter((file) => {
    const spec = file.parsed.document?.grammar.importFrom;
    return spec ? resolveGrammarPath(file.rel, spec) === rel : false;
  });
  if (used.length > 0 && !force) {
    throw new SdocError(
      409,
      `Imported by ${used.map((file) => file.rel).join(", ")}.`,
    );
  }
  await rm(abs);
  return { ok: true };
}

function locate(
  all: CorpusFile[],
  uid: string,
): { file: CorpusFile; doc: SDocDocument; node: SDocNode; path: number[] } | null {
  for (const file of all) {
    const doc = file.parsed.document;
    if (!doc) continue;
    const found = findPath(doc.nodes, uid);
    if (found) return { file, doc, node: found.node, path: found.path };
  }
  return null;
}

function findPath(nodes: SDocNode[], uid: string, prefix: number[] = []): { node: SDocNode; path: number[] } | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const path = [...prefix, index];
    if (nodeUid(node) === uid) return { node, path };
    const child = findPath(node.children, uid, path);
    if (child) return child;
  }
  return null;
}

function stripParents(nodes: SDocNode[], uid: string): SDocNode[] {
  return nodes.map((node) => ({
    ...node,
    relations: node.relations.filter((relation) => !(relation.type === "Parent" && relation.value === uid)),
    children: stripParents(node.children, uid),
  }));
}

export async function readNode(uid: string): Promise<NodeResponse> {
  const project = await corpus();
  const found = locate(project.docs, uid);
  if (!found) throw new SdocError(404, "UID not found.");
  const nodes = indexNodes(project.docs);
  const incoming = nodes
    .filter((node) => node.relations.some((relation) => relation.type !== "File" && relation.value === uid))
    .map((node) => {
      const relation = node.relations.find((item) => item.value === uid)!;
      return { uid: node.uid, file: node.file, title: node.title, type: relation.type, role: relation.role };
    });
  return {
    uid,
    file: found.file.rel,
    tag: found.node.tag,
    title: fieldOf(found.node, "TITLE"),
    statement: fieldOf(found.node, "STATEMENT"),
    relations: found.node.relations.map((relation) => ({
      type: relation.type,
      role: relation.role,
      value: relation.value,
    })),
    incoming,
  };
}

export async function saveNode(
  uid: string,
  patch: { fields?: Record<string, string>; relations?: IndexNode["relations"] },
  flags: WriteFlags = {},
): Promise<NodeResponse> {
  const project = await corpus();
  const found = locate(project.docs, uid);
  if (!found) throw new SdocError(404, "UID not found.");
  let node = found.node;
  if (patch.fields) {
    for (const [name, value] of Object.entries(patch.fields)) {
      if (name === "MID") continue;
      node = withField(node, name, value);
    }
  }
  if (patch.relations) {
    node = withRelations(
      node,
      patch.relations.map((relation, index) => ({
        type: relation.type,
        role: relation.role,
        value: relation.value,
        line: index + 1,
      })),
    );
  }
  const nodes = mapAt(found.doc.nodes, found.path, () => node);
  await commit(found.file.rel, textForWrite({ ...found.doc, nodes }), flags);
  return readNode(uid);
}

export async function addNode(
  input: { file: string; afterUid?: string; title?: string; statement?: string },
  flags: WriteFlags = {},
): Promise<NodeResponse> {
  const view = await readFileView(input.file);
  if (!view.document || view.parseFailed) throw new SdocError(422, "File does not parse.", view.errors);
  const uid = nextUid(view.document.prefix || "REQ-", [...view.siblingUids, ...collectUids(view.document)]);
  let created = requirementNode(uid, input.title?.trim() || "New requirement", input.statement ?? "");
  if (!fieldOf(created, "TITLE") && !fieldOf(created, "STATEMENT")) {
    created = withField(created, "TITLE", "New requirement");
  }
  const placed = insertAfter(view.document.nodes, input.afterUid, created);
  if (input.afterUid && !placed.found) throw new SdocError(404, "afterUid was not found in that file.");
  await commit(input.file, textForWrite({ ...view.document, nodes: placed.nodes }), flags);
  return readNode(uid);
}

export async function removeNode(uid: string, force: boolean): Promise<{ ok: boolean }> {
  const project = await corpus();
  const found = locate(project.docs, uid);
  if (!found) throw new SdocError(404, "UID not found.");
  const incoming = (await readNode(uid)).incoming.filter((item) => item.file !== found.file.rel && item.type === "Parent");
  if (incoming.length > 0 && !force) {
    throw new SdocError(
      409,
      "Other nodes parent-point at this UID.",
      incoming.map((item) => ({
        line: 1,
        col: 1,
        path: "graph",
        message: `${item.uid} in ${item.file} parents ${uid}.`,
        severity: "error" as const,
        code: "referenced-uid",
        uid,
        file: item.file,
      })),
    );
  }
  const removed = removeUid(stripParents(found.doc.nodes, uid), uid);
  await commit(found.file.rel, textForWrite({ ...found.doc, nodes: removed.nodes }), { force: true });
  return { ok: true };
}

export async function queryGraph(from: string, depth: number) {
  if (!from.trim()) throw new SdocError(400, "Query from is required.");
  const { nodes } = await buildIndex();
  return buildGraph(nodes, from.trim(), depth);
}

type Listener = (event: { paths: string[] }) => void;

let watcher: FSWatcher | null = null;
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function ensureWatch(): void {
  if (process.env.SDOC_WATCH === "false" || watcher) return;
  const root = sdocRoot();
  mkdirSync(root, { recursive: true });
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      const name = String(filename ?? "");
      if ((!name.endsWith(".sdoc") && !name.endsWith(".sgra")) || name.includes(".tmp-")) return;
      const parts = name.split(/[/\\]/);
      if (parts.some((part) => part === "output" || part === "node_modules" || part === ".git")) return;
      pending.add(parts.join("/"));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const paths = [...pending];
        pending = new Set();
        timer = null;
        for (const listener of listeners) listener({ paths });
      }, 100);
    });
  } catch (err) {
    console.error("sdoc watch failed", err);
  }
}

export function subscribe(listener: Listener): () => void {
  ensureWatch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && watcher) {
      watcher.close();
      watcher = null;
    }
  };
}
