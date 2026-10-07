import { ensureOrgGrammar, grammarAliasName, grammarFilePath } from "./grammar.ts";
import type { DocOptions, Grammar, GrammarElement, SDocDocument, SDocNode } from "./types.ts";

const OPTION_KEYS = ["ENABLE_MID", "AUTO_LEVELS", "VIEW_STYLE", "NODE_IN_TOC", "MARKUP"] as const;

export function serialize(doc: SDocDocument): string {
  const lines: string[] = ["[DOCUMENT]", `TITLE: ${doc.title}`];
  if (doc.mid) lines.splice(1, 0, `MID: ${doc.mid}`);
  if (doc.uid) lines.push(`UID: ${doc.uid}`);
  if (doc.version) lines.push(`VERSION: ${doc.version}`);
  if (doc.date) lines.push(`DATE: ${doc.date}`);
  if (doc.classification) lines.push(`CLASSIFICATION: ${doc.classification}`);
  if (doc.prefix) lines.push(`PREFIX: ${doc.prefix}`);
  if (doc.root !== undefined) lines.push(`ROOT: ${doc.root ? "True" : "False"}`);
  if (doc.options) lines.push(...serializeOptions(doc.options));
  lines.push("");
  if (doc.grammar.explicit) {
    lines.push(...serializeGrammar(doc.grammar));
    lines.push("");
  }
  lines.push(...serializeNodes(doc.nodes));
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  return text.endsWith("\n") ? text : `${text}\n`;
}

/** Pretty-print with org roles registered in the grammar. */
export function textForWrite(doc: SDocDocument): string {
  return serialize(ensureOrgGrammar(doc));
}

function serializeOptions(options: DocOptions): string[] {
  const lines = ["OPTIONS:"];
  for (const key of OPTION_KEYS) {
    const value = options[key];
    if (value !== undefined) lines.push(`  ${key}: ${value}`);
  }
  for (const extra of options.extra) lines.push(`  ${extra.key}: ${extra.value}`);
  return lines;
}

function serializeGrammar(grammar: Grammar): string[] {
  if (grammar.importFrom) return ["[GRAMMAR]", `IMPORT_FROM_FILE: ${grammar.importFrom}`];
  const lines = ["[GRAMMAR]", "ELEMENTS:"];
  for (const element of grammar.elements) lines.push(...serializeElement(element));
  return lines;
}

export function serializeGrammarFile(elements: GrammarElement[]): string {
  const text = serializeGrammar({ explicit: true, elements }).join("\n");
  return text.endsWith("\n") ? text : `${text}\n`;
}

/** Point a document at a grammar file through its project alias. The grammar text is the document's current elements. */
export function detachGrammar(
  document: SDocDocument,
  grammarRel: string,
  alias: string,
): { document: SDocDocument; text: string } | { error: string } {
  if (document.grammar.importFrom) return { error: "This document already imports a grammar file." };
  if (!grammarFilePath(grammarRel)) return { error: "Grammar path must be a .sgra file inside the project." };
  if (!/^@[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) return { error: "Grammar alias must look like @name." };
  const elements = (document.grammar.explicit ? document : ensureOrgGrammar(document)).grammar.elements;
  return {
    text: serializeGrammarFile(elements),
    document: { ...document, grammar: { explicit: true, elements, importFrom: alias || grammarAliasName(grammarRel) } },
  };
}

function serializeElement(element: GrammarElement): string[] {
  const lines = [`- TAG: ${element.tag}`];
  const composite = element.composite ?? (element.tag === "SECTION" ? true : undefined);
  if (composite !== undefined) {
    lines.push("  PROPERTIES:", `    IS_COMPOSITE: ${composite ? "True" : "False"}`);
  }
  lines.push("  FIELDS:");
  for (const field of element.fields) {
    lines.push(`  - TITLE: ${field.title}`);
    const options = field.type === "SingleChoice" && field.options?.length ? `(${field.options.join(", ")})` : "";
    lines.push(`    TYPE: ${field.type}${options}`);
    lines.push(`    REQUIRED: ${field.required ? "True" : "False"}`);
  }
  if (element.relations.length > 0) {
    lines.push("  RELATIONS:");
    for (const relation of element.relations) {
      lines.push(`  - TYPE: ${relation.type}`);
      if (relation.role) lines.push(`    ROLE: ${relation.role}`);
      if (relation.reverseRole) lines.push(`    REVERSE_ROLE: ${relation.reverseRole}`);
    }
  }
  return lines;
}

function serializeNodes(nodes: SDocNode[]): string[] {
  const lines: string[] = [];
  nodes.forEach((node, index) => {
    if (index > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push(...serializeNode(node));
  });
  return lines;
}

function serializeNode(node: SDocNode): string[] {
  const lines: string[] = [];
  if (node.composite && node.legacy) lines.push(`[${node.tag}]`);
  else if (node.composite) lines.push(`[[${node.tag}]]`);
  else lines.push(`[${node.tag}]`);
  for (const field of node.fields) {
    if (field.multiline || field.value.includes("\n")) {
      lines.push(`${field.name}: >>>`);
      lines.push(field.value);
      lines.push("<<<");
    } else {
      lines.push(`${field.name}: ${field.value}`);
    }
  }
  if (node.relations.length > 0) {
    lines.push("RELATIONS:");
    for (const relation of node.relations) {
      lines.push(`- TYPE: ${relation.type}`);
      if (relation.role) lines.push(`  ROLE: ${relation.role}`);
      lines.push(`  VALUE: ${relation.value}`);
    }
  }
  if (node.composite) {
    if (node.children.length > 0) {
      lines.push("");
      lines.push(...serializeNodes(node.children));
    }
    lines.push(node.legacy ? `[/${node.tag}]` : `[[/${node.tag}]]`);
  }
  return lines;
}
