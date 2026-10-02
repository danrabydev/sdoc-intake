import type { Grammar, GrammarElement, RelationType, SDocDocument } from "./types.ts";

export const ORG_ROLES = ["Refines", "Satisfies", "Uses", "ConformsTo"] as const;

export function defaultElements(): GrammarElement[] {
  return [
    {
      tag: "TEXT",
      fields: [{ title: "STATEMENT", type: "String", required: true }],
      relations: [],
    },
    {
      tag: "SECTION",
      composite: true,
      fields: [
        { title: "UID", type: "String", required: false },
        { title: "PREFIX", type: "String", required: false },
        { title: "TITLE", type: "String", required: true },
      ],
      relations: [],
    },
    requirementElement(),
  ];
}

export function requirementElement(): GrammarElement {
  return {
    tag: "REQUIREMENT",
    fields: [
      { title: "UID", type: "String", required: false },
      { title: "TITLE", type: "String", required: false },
      { title: "STATEMENT", type: "String", required: false },
      { title: "RATIONALE", type: "String", required: false },
      { title: "COMMENT", type: "String", required: false },
      { title: "STATUS", type: "SingleChoice", required: false, options: ["Draft", "Active", "Approved"] },
    ],
    relations: orgRelations(),
  };
}

export function elementRoles(elements: GrammarElement[], tag: string): string[] {
  const found = elements.find((element) => element.tag === tag);
  const roles = (found?.relations ?? []).flatMap((relation) => (relation.role ? [relation.role] : []));
  return [...new Set(roles)];
}

/** Relations the editor can attach. Prefer named roles. Keep the grammar's TYPE. */
export function elementLinks(elements: GrammarElement[], tag: string): { type: RelationType; role?: string }[] {
  const found = elements.find((element) => element.tag === tag);
  const source = found?.relations ?? [];
  const named = source.filter((relation) => relation.role);
  const list = named.length > 0 ? named : source;
  const seen = new Set<string>();
  const links: { type: RelationType; role?: string }[] = [];
  for (const relation of list) {
    const key = `${relation.type}:${relation.role ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ type: relation.type, role: relation.role });
  }
  return links;
}

export function tagLabel(tag: string): string {
  if (/^[A-Z0-9]+$/.test(tag)) return tag.charAt(0) + tag.slice(1).toLowerCase();
  return tag;
}

/** Default element when the user has not picked one. TEXT stays last: it is first in most grammars. */
export function fallbackTag(tags: readonly string[], prefer: readonly string[]): string {
  for (const tag of prefer) if (tags.includes(tag)) return tag;
  return tags.find((tag) => tag !== "TEXT") ?? tags[0] ?? "";
}

function orgRelations(): GrammarElement["relations"] {
  const relations: GrammarElement["relations"] = [
    { type: "Parent" },
    { type: "Child" },
    { type: "File" },
  ];
  for (const role of ORG_ROLES) relations.push({ type: "Parent", role });
  return relations;
}

export function defaultGrammar(): Grammar {
  return { explicit: false, elements: defaultElements() };
}

/** Register this org's Parent roles. Does not mutate the input. An imported grammar is left to its file. */
export function ensureOrgGrammar(doc: SDocDocument): SDocDocument {
  const next = structuredClone(doc);
  if (next.grammar.importFrom || next.grammar.explicit) return next;
  const grammar: Grammar = next.grammar.explicit
    ? next.grammar
    : { explicit: true, elements: defaultElements() };
  grammar.explicit = true;
  let requirement = grammar.elements.find((element) => element.tag === "REQUIREMENT");
  if (!requirement) {
    requirement = requirementElement();
    grammar.elements.push(requirement);
  }
  for (const relation of orgRelations()) {
    const exists = requirement.relations.some(
      (item) => item.type === relation.type && (item.role ?? "") === (relation.role ?? ""),
    );
    if (!exists) requirement.relations.push({ ...relation });
  }
  if (!grammar.elements.some((element) => element.tag === "TEXT")) {
    grammar.elements.unshift(defaultElements()[0]!);
  }
  if (!grammar.elements.some((element) => element.tag === "SECTION")) {
    grammar.elements.splice(1, 0, defaultElements()[1]!);
  }
  const section = grammar.elements.find((element) => element.tag === "SECTION");
  if (section && !section.fields.some((field) => field.title === "PREFIX")) {
    const uidAt = section.fields.findIndex((field) => field.title === "UID");
    section.fields.splice(uidAt + 1, 0, { title: "PREFIX", type: "String", required: false });
  }
  next.grammar = grammar;
  return next;
}

/** Resolve `IMPORT_FROM_FILE`. `@alias` comes from the project config. A path is relative to the document. */
export function resolveGrammarPath(
  fromRel: string,
  spec: string,
  aliases: Readonly<Record<string, string>> = {},
): string | null {
  const cleaned = spec.replace(/\\/g, "/").trim();
  if (cleaned.startsWith("@")) {
    if (!ALIAS_NAME.test(cleaned)) return null;
    const target = aliases[cleaned];
    return target ? grammarFilePath(target) : null;
  }
  if (!cleaned || cleaned.startsWith("/") || cleaned.includes("\0") || !cleaned.endsWith(".sgra")) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(cleaned)) return null;
  const base = fromRel.includes("/") ? fromRel.slice(0, fromRel.lastIndexOf("/")) : "";
  const parts = [...(base ? base.split("/") : []), ...cleaned.split("/")];
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(part)) return null;
    stack.push(part);
  }
  const rel = stack.join("/");
  return rel.endsWith(".sgra") ? rel : null;
}

/** Import path to write in `fromRel` so it resolves to `targetRel`. */
export function relativeImport(fromRel: string, targetRel: string): string | null {
  const target = targetRel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!target.endsWith(".sgra") || target.includes("..") || target.startsWith("/")) return null;
  const fromDir = fromRel.includes("/") ? fromRel.slice(0, fromRel.lastIndexOf("/")) : "";
  const fromParts = fromDir ? fromDir.split("/") : [];
  const toParts = target.split("/");
  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) shared += 1;
  const spec = [...Array.from({ length: fromParts.length - shared }, () => ".."), ...toParts.slice(shared)].join("/");
  return resolveGrammarPath(fromRel, spec) === target ? spec : null;
}

export const STRICTDOC_CONFIG = "strictdoc_config.py";

const ALIAS_NAME = /^@[A-Za-z_][A-Za-z0-9_]*$/;

/** Project-relative `.sgra` path stored on a grammar alias. Rejects `..` and absolute paths. */
export function grammarFilePath(value: string): string | null {
  let path = value.replace(/\\/g, "/").trim();
  if (path.startsWith("./")) path = path.slice(2);
  if (!path.endsWith(".sgra") || path.startsWith("/") || path.includes("..") || path.includes("\0")) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(path)) return null;
  return path;
}

export function grammarAliasName(rel: string): string {
  const stem = rel.split("/").pop()?.replace(/\.sgra$/i, "") ?? "grammar";
  let name = stem.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "");
  if (!name || /^[0-9]/.test(name)) name = `g_${name || "grammar"}`;
  return `@${name}`;
}

/** Reuse an alias that already points at `rel`. Otherwise take the free filename stem. */
export function assignAlias(aliases: Readonly<Record<string, string>>, rel: string): string {
  for (const [alias, path] of Object.entries(aliases)) {
    if (path === rel && ALIAS_NAME.test(alias)) return alias;
  }
  const base = grammarAliasName(rel);
  if (!aliases[base]) return base;
  for (let index = 2; index < 1000; index += 1) {
    const next = `${base}_${index}`;
    if (!aliases[next]) return next;
  }
  return `${base}_${Object.keys(aliases).length + 2}`;
}

function blockEnd(text: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  let quote = "";
  for (let index = open; index < text.length; index += 1) {
    const ch = text[index] ?? "";
    if (quote) {
      if (ch === "\\") {
        index += 1;
        continue;
      }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Read `grammars={ "@name": "path.sgra" }` from a StrictDoc Python config. Does not execute it. */
export function parseGrammarAliases(text: string): Record<string, string> {
  const match = /\bgrammars\s*=\s*\{/.exec(text);
  if (!match) return {};
  const open = text.indexOf("{", match.index);
  const close = blockEnd(text, open, "{", "}");
  if (close < 0) return {};
  const body = text.slice(open + 1, close);
  const out: Record<string, string> = {};
  const pair = /(['"])(@[A-Za-z_][A-Za-z0-9_]*)\1\s*:\s*(['"])([^'"\\]*)\3/g;
  for (const found of body.matchAll(pair)) {
    const path = grammarFilePath(found[4] ?? "");
    if (path) out[found[2] ?? ""] = path;
  }
  return out;
}

function renderConfig(aliases: Record<string, string>): string {
  const lines = Object.entries(aliases)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([alias, path]) => `            "${alias}": "${path}",`);
  return `from strictdoc.core.project_config import ProjectConfig

def create_config() -> ProjectConfig:
    return ProjectConfig(
        project_title="sdoc-intake",
        grammars={
${lines.join("\n")}
        },
    )
`;
}

/** Add or replace one alias. Creates `strictdoc_config.py` when there is no config yet. */
export function upsertGrammarAlias(text: string | null, alias: string, rel: string): string | { error: string } {
  if (!ALIAS_NAME.test(alias)) return { error: `Grammar alias ${alias} must look like @name.` };
  const path = grammarFilePath(rel);
  if (!path) return { error: "Grammar path must be a .sgra file inside the project." };
  if (!text?.trim()) return renderConfig({ [alias]: path });
  const match = /\bgrammars\s*=\s*\{/.exec(text);
  if (match) {
    const open = text.indexOf("{", match.index);
    const close = blockEnd(text, open, "{", "}");
    if (close < 0) return { error: "strictdoc_config.py has an unclosed grammars dict." };
    const body = text.slice(open + 1, close);
    const line = new RegExp(`(['"])${alias}\\1\\s*:\\s*(['"])[^'"\\\\]*\\2`);
    const next = line.test(body) ? body.replace(line, `"${alias}": "${path}"`) : `${body}\n            "${alias}": "${path}",`;
    return text.slice(0, open + 1) + next + text.slice(close);
  }
  const call = /\bProjectConfig\s*\(/.exec(text);
  if (call) {
    const open = text.indexOf("(", call.index);
    const close = blockEnd(text, open, "(", ")");
    if (close < 0) return { error: "strictdoc_config.py has an unclosed ProjectConfig() call." };
    const insertion = `\n        grammars={\n            "${alias}": "${path}",\n        },`;
    return text.slice(0, close) + insertion + text.slice(close);
  }
  if (/\bdef\s+create_config\b/.test(text)) {
    return { error: "strictdoc_config.py has create_config but no ProjectConfig() call to attach grammars." };
  }
  return `${text.trimEnd()}\n\n${renderConfig({ [alias]: path })}`;
}

/** Drop aliases that point at a grammar file which is going away. */
export function removeGrammarPath(text: string, rel: string): string {
  const path = grammarFilePath(rel);
  if (!path) return text;
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(
    new RegExp(`\\n[ \\t]*(['"])@[A-Za-z_][A-Za-z0-9_]*\\1\\s*:\\s*(['"])(?:\\./)?${escaped}\\2,?`, "g"),
    "",
  );
}
