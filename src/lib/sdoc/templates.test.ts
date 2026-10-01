import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveGrammarPath } from "./grammar.ts";
import { flatten, nodeUid } from "./model.ts";
import { parse } from "./parse.ts";
import { fieldOf } from "./model.ts";
import { serialize } from "./serialize.ts";
import { validate } from "./validate.ts";

test("the ASD STIG V6R4 template parses as 286 rules", () => {
  const text = readFileSync(new URL("../../../templates/stig/asd-v6r4.sdoc", import.meta.url), "utf8");
  const parsed = parse(text);
  assert.equal(parsed.errors.length, 0, JSON.stringify(parsed.errors.slice(0, 5)));
  assert.ok(parsed.document);
  const rules = flatten(parsed.document.nodes).filter((row) => row.node.tag === "REQUIREMENT");
  assert.equal(rules.length, 286);
  const known = rules.find((row) => nodeUid(row.node) === "V-222387");
  assert.ok(known);
  assert.match(fieldOf(known.node, "TITLE"), /logon sessions/);
  assert.equal(fieldOf(known.node, "SEVERITY"), "Medium");
  const severity = { High: 0, Medium: 0, Low: 0 };
  for (const row of rules) {
    const value = fieldOf(row.node, "SEVERITY") as keyof typeof severity;
    severity[value] += 1;
  }
  assert.deepEqual(severity, { High: 34, Medium: 230, Low: 22 });
});

test("the NIST 800-53 template parses the Rev 5 catalog", () => {
  const text = readFileSync(new URL("../../../templates/nist/sp-800-53-rev5.sdoc", import.meta.url), "utf8");
  const parsed = parse(text);
  assert.equal(parsed.errors.length, 0, JSON.stringify(parsed.errors.slice(0, 5)));
  assert.ok(parsed.document);
  const rows = flatten(parsed.document.nodes);
  const rules = rows.filter((row) => row.node.tag === "REQUIREMENT");
  const families = rows.filter((row) => row.node.tag === "SECTION");
  assert.equal(families.length, 20);
  assert.equal(rules.length, 1196);
  const ac1 = rules.find((row) => nodeUid(row.node) === "AC-1");
  assert.ok(ac1);
  assert.match(fieldOf(ac1.node, "STATEMENT"), /Develop, document, and disseminate/);
  assert.equal(fieldOf(ac1.node, "BASELINE"), "Low");
  const enhancement = rules.find((row) => nodeUid(row.node) === "AC-2.1");
  assert.ok(enhancement);
  assert.match(fieldOf(enhancement.node, "TITLE"), /AC-2\(1\)/);
  const withdrawn = rules.filter((row) => fieldOf(row.node, "COMMENT").startsWith("Withdrawn"));
  assert.equal(withdrawn.length, 182);
});

test("the release template imports its grammar file", () => {
  const text = readFileSync(new URL("../../../templates/releases/product.sdoc", import.meta.url), "utf8");
  const grammar = readFileSync(new URL("../../../templates/grammar/release.sgra", import.meta.url), "utf8");
  const org = readFileSync(new URL("../../../templates/grammar/org.sgra", import.meta.url), "utf8");
  const result = validate(text, {
    file: "releases/product.sdoc",
    readText: (rel) => (rel === "grammar/release.sgra" ? grammar : undefined),
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.document);
  assert.equal(result.document.grammar.importFrom, "../grammar/release.sgra");
  assert.ok(result.document.grammar.elements.some((element) => element.tag === "RELEASE"));
  const release = flatten(result.document.nodes).find((row) => row.node.tag === "RELEASE");
  assert.ok(release);
  assert.equal(nodeUid(release.node), "REL-12.1");
  assert.equal(fieldOf(release.node, "CHANNEL"), "upkeep");
  assert.equal(fieldOf(release.node, "STATUS"), "planned");
  const written = serialize(result.document);
  assert.match(written, /IMPORT_FROM_FILE: \.\.\/grammar\/release\.sgra/);
  assert.doesNotMatch(written, /TAG: RELEASE/);
  const orgParsed = validate("[DOCUMENT]\nTITLE: Org\n\n[GRAMMAR]\nIMPORT_FROM_FILE: grammar/org.sgra\n", {
    file: "SYS.sdoc",
    readText: (rel) => (rel === "grammar/org.sgra" ? org : undefined),
  });
  assert.equal(orgParsed.ok, true, JSON.stringify(orgParsed.errors));
  const requirement = orgParsed.document?.grammar.elements.find((element) => element.tag === "REQUIREMENT");
  assert.ok(requirement?.relations.some((relation) => relation.role === "ConformsTo"));
});

test("a grammar import cannot leave the project", () => {
  assert.equal(resolveGrammarPath("releases/product.sdoc", "../grammar/release.sgra"), "grammar/release.sgra");
  assert.equal(resolveGrammarPath("releases/product.sdoc", "../../secret.sgra"), null);
  assert.equal(resolveGrammarPath("product.sdoc", "/etc/grammar.sgra"), null);
  const text = "[DOCUMENT]\nTITLE: Releases\n\n[GRAMMAR]\nIMPORT_FROM_FILE: ../../secret.sgra\n";
  const result = validate(text, { file: "releases/product.sdoc", readText: () => "[GRAMMAR]\nELEMENTS:\n" });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0]?.code, "grammar-import");
});
