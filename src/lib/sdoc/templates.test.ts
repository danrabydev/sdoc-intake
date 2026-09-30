import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { flatten, nodeUid } from "./model.ts";
import { parse } from "./parse.ts";
import { fieldOf } from "./model.ts";

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
