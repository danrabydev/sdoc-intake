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

/** Resolve `IMPORT_FROM_FILE` against the importing document. Rejects paths that leave the project. */
export function resolveGrammarPath(fromRel: string, spec: string): string | null {
  const cleaned = spec.replace(/\\/g, "/").trim();
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
