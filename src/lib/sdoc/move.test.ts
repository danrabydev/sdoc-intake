import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyUidRenames,
  fieldOf,
  indentNode,
  moveNode,
  nextUid,
  outdentNode,
  outlineNumbers,
  prefixExpectations,
  prefixRenames,
  reorderSibling,
  requirementNode,
  sectionNode,
  withField,
} from "./model.ts";
import type { SDocDocument } from "./types.ts";
import { defaultGrammar } from "./grammar.ts";

test("section prefix marks a requirement and a click-rename keeps the serial", () => {
  const section = withField(sectionNode("SYS-SEC-1", "Occupant", true), "PREFIX", "PROT");
  section.children = [
    requirementNode("SYS-010", "Belt", ""),
    requirementNode("SYS-PROT-10", "Same tail", ""),
    requirementNode("SYS-PROT-10-2", "Longer", ""),
  ];
  const doc: SDocDocument = {
    title: "Sys",
    prefix: "SYS-",
    grammar: defaultGrammar(),
    nodes: [section, requirementNode("SYS-020", "Root", "")],
  };
  const issues = prefixExpectations(doc);
  assert.equal(issues.get("SYS-010"), "SYS-PROT-10");
  assert.equal(issues.has("SYS-SEC-1"), false);
  assert.equal(issues.has("SYS-020"), false);
  assert.equal(issues.has("SYS-PROT-10-2"), false);
  const renames = prefixRenames(doc, []);
  assert.equal(renames.get("SYS-010"), "SYS-PROT-11");
  assert.equal(renames.has("SYS-020"), false);
  const next = applyUidRenames(doc.nodes, renames);
  assert.equal(fieldOf(next[0]!.children[0]!, "UID"), "SYS-PROT-11");
});

test("new ids do not pad zeros", () => {
  assert.equal(nextUid("SYS-", ["SYS-001", "SYS-9"]), "SYS-10");
  assert.equal(nextUid("REQ-", []), "REQ-1");
});

test("every outline item is numbered, and a section opens the next level", () => {
  const inner = sectionNode("SEC-2", "Inner", true);
  inner.children = [requirementNode("REQ-002", "Deep", "")];
  const outer = sectionNode("SEC-1", "Outer", true);
  outer.children = [requirementNode("REQ-001", "One", ""), inner];
  const second = sectionNode("SEC-3", "Next", true);
  const labels = outlineNumbers([outer, requirementNode("REQ-009", "Loose", ""), second]);
  assert.equal(labels.get("0"), "1");
  assert.equal(labels.get("0.0"), "1.1");
  assert.equal(labels.get("0.1"), "1.2");
  assert.equal(labels.get("0.1.0"), "1.2.1");
  assert.equal(labels.get("1"), "2");
  assert.equal(labels.get("2"), "3");
});

test("a section moves to the root with its children", () => {
  const inner = sectionNode("SEC-2", "Inner", true);
  inner.children = [requirementNode("REQ-001", "Kept", "")];
  const outer = sectionNode("SEC-1", "Outer", true);
  outer.children = [inner];
  const root = [outer, requirementNode("REQ-009", "Stay", "")];
  const moved = moveNode(root, "SEC-2", { where: "root" });
  assert.equal(moved.ok, true);
  assert.equal(fieldOf(moved.nodes[0]!, "UID"), "SEC-1");
  assert.equal(moved.nodes[0]!.children.length, 0);
  assert.equal(fieldOf(moved.nodes[2]!, "UID"), "SEC-2");
  assert.equal(fieldOf(moved.nodes[2]!.children[0]!, "UID"), "REQ-001");
  const trapped = moveNode(root, "SEC-1", { where: "inside", uid: "SEC-2" });
  assert.equal(trapped.ok, false);
  assert.equal(trapped.nodes, root);
});

test("indent, outdent, and reorder keep the subtree together", () => {
  const section = sectionNode("SEC-1", "Outer", true);
  const req = requirementNode("REQ-001", "One", "");
  let nodes = [section, req];
  const indented = indentNode(nodes, "REQ-001");
  assert.equal(indented.ok, true);
  assert.equal(indented.nodes[0]!.children[0] && fieldOf(indented.nodes[0]!.children[0]!, "UID"), "REQ-001");
  const out = outdentNode(indented.nodes, "REQ-001");
  assert.equal(out.ok, true);
  assert.deepEqual(out.nodes.map((node) => fieldOf(node, "UID")), ["SEC-1", "REQ-001"]);
  nodes = [requirementNode("REQ-001", "One", ""), requirementNode("REQ-002", "Two", "")];
  const swapped = reorderSibling(nodes, "REQ-002", -1);
  assert.deepEqual(swapped.map((node) => fieldOf(node, "UID")), ["REQ-002", "REQ-001"]);
});
