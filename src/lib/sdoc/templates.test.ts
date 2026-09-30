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
