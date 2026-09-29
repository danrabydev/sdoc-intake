import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldOf, indentNode, moveNode, outdentNode, outlineNumbers, reorderSibling, requirementNode, sectionNode } from "./model.ts";

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
