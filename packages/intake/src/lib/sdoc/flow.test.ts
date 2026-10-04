import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexNode } from "./api-types.ts";
import { flowDiagram, layoutDiagram, traceDiagram } from "./diagram.ts";
import { buildGraph } from "./graph.ts";

function node(partial: Partial<IndexNode> & Pick<IndexNode, "uid" | "file" | "tag">): IndexNode {
  return {
    title: partial.uid,
    statement: "",
    relations: [],
    ...partial,
  };
}

test("the flow is one box per document and counts parent links", () => {
  const diagram = flowDiagram(
    [
      node({ uid: "DOC-SYS", file: "product/SYS.sdoc", tag: "DOCUMENT", title: "System" }),
      node({
        uid: "SYS-010",
        file: "product/SYS.sdoc",
        tag: "REQUIREMENT",
        title: "Belt",
        relations: [{ type: "Parent", role: "Refines", value: "CAP-1" }],
      }),
      node({ uid: "SYS-SEC-1", file: "product/SYS.sdoc", tag: "SECTION", title: "Occupant" }),
      node({ uid: "SYS-099", file: "product/SYS.sdoc", tag: "REQUIREMENT", title: "Unused" }),
      node({ uid: "DOC-CAP", file: "CAP.sdoc", tag: "DOCUMENT", title: "Capabilities" }),
      node({ uid: "CAP-1", file: "CAP.sdoc", tag: "REQUIREMENT", title: "Capability" }),
    ],
    "SYS-010",
  );
  assert.deepEqual(
    diagram.nodes.map((item) => item.file),
    ["CAP.sdoc", "product/SYS.sdoc"].sort((a, b) => a.localeCompare(b)),
  );
  const sys = diagram.nodes.find((item) => item.file === "product/SYS.sdoc");
  const cap = diagram.nodes.find((item) => item.file === "CAP.sdoc");
  assert.equal(sys?.focus, true);
  assert.ok(sys && cap && sys.column < cap.column);
  assert.equal(diagram.edges.length, 1);
  assert.equal(diagram.edges[0]?.label, "Refines 1");
  assert.equal(diagram.edges[0]?.hot, true);
  assert.equal(diagram.links.get(diagram.edges[0]!.id)?.[0]?.fromUid, "SYS-010");
  const opened = flowDiagram(
    [
      node({ uid: "DOC-SYS", file: "product/SYS.sdoc", tag: "DOCUMENT", title: "System" }),
      node({
        uid: "SYS-010",
        file: "product/SYS.sdoc",
        tag: "REQUIREMENT",
        relations: [{ type: "Parent", role: "Refines", value: "CAP-1" }],
      }),
      node({ uid: "CAP-1", file: "CAP.sdoc", tag: "REQUIREMENT", title: "Capability" }),
    ],
    "",
    "product/SYS.sdoc",
  );
  assert.equal(opened.nodes.find((item) => item.file === "product/SYS.sdoc")?.focus, true);
  assert.equal(opened.edges[0]?.hot, true);
  assert.equal(diagram.nodes.some((item) => item.title === "Occupant" || item.uid === "SYS-099"), false);
  const grouped = flowDiagram(
    [
      node({ uid: "DOC-SYS", file: "product/SYS.sdoc", tag: "DOCUMENT", title: "System" }),
      node({ uid: "SYS-SEC-1", file: "product/SYS.sdoc", tag: "SECTION", title: "Occupant", composite: true }),
      node({
        uid: "SYS-010",
        file: "product/SYS.sdoc",
        tag: "REQUIREMENT",
        title: "Belt",
        parent: "SYS-SEC-1",
        relations: [{ type: "Parent", role: "Refines", value: "CAP-1" }],
      }),
      node({ uid: "SYS-099", file: "product/SYS.sdoc", tag: "REQUIREMENT", title: "Unused" }),
      node({ uid: "CAP-1", file: "CAP.sdoc", tag: "REQUIREMENT", title: "Capability" }),
    ],
    "SYS-010",
    "",
    new Set(["product/SYS.sdoc"]),
  );
  const sysNodes = grouped.nodes.filter((item) => item.file === "product/SYS.sdoc");
  assert.equal(sysNodes[0]?.kind, "bundle");
  assert.equal(sysNodes[0]?.uid, "");
  assert.equal(sysNodes.some((item) => item.uid === "SYS-010"), false);
  assert.equal(sysNodes.find((item) => item.uid === "SYS-SEC-1")?.kind, "bundle");
  assert.equal(grouped.edges[0]?.from, "n:SYS-SEC-1");
  const nested = flowDiagram(
    [
      node({ uid: "SYS-SEC-1", file: "product/SYS.sdoc", tag: "SECTION", title: "Occupant", composite: true }),
      node({
        uid: "SYS-010",
        file: "product/SYS.sdoc",
        tag: "REQUIREMENT",
        title: "Belt",
        parent: "SYS-SEC-1",
        relations: [{ type: "Parent", role: "Refines", value: "CAP-1" }],
      }),
      node({ uid: "CAP-1", file: "CAP.sdoc", tag: "REQUIREMENT", title: "Capability" }),
    ],
    "SYS-010",
    "",
    new Set(["product/SYS.sdoc", "SYS-SEC-1"]),
  );
  assert.equal(nested.nodes.find((item) => item.uid === "")?.kind ?? nested.nodes.find((item) => item.file === "product/SYS.sdoc" && !item.uid)?.kind, "bundle");
  assert.equal(nested.nodes.find((item) => item.uid === "SYS-SEC-1")?.kind, "bundle");
  assert.equal(nested.nodes.find((item) => item.uid === "SYS-010")?.depth, 2);
  assert.equal(nested.nodes.find((item) => item.uid === "SYS-SEC-1")?.depth, 1);
  assert.equal(nested.edges[0]?.from, "n:SYS-010");
});

test("a large catalog stays one box", () => {
  const nodes: IndexNode[] = [
    node({ uid: "APP", file: "apps/identity/SYS.sdoc", tag: "DOCUMENT", title: "Identity" }),
    node({ uid: "NIST", file: "catalog/nist-800-53.sdoc", tag: "DOCUMENT", title: "NIST SP 800-53 Rev 5" }),
  ];
  for (let index = 0; index < 400; index += 1) {
    const control = `AC-${index}`;
    nodes.push(node({ uid: control, file: "catalog/nist-800-53.sdoc", tag: "REQUIREMENT", title: control }));
    nodes.push(
      node({
        uid: `IDN-${index}`,
        file: "apps/identity/SYS.sdoc",
        tag: "REQUIREMENT",
        title: "Rule",
        relations: [{ type: "Parent", role: "ConformsTo", value: control }],
      }),
    );
  }
  const diagram = flowDiagram(nodes, "IDN-1");
  assert.equal(diagram.nodes.length, 2);
  assert.equal(diagram.edges.length, 1);
  assert.equal(diagram.edges[0]?.label, "ConformsTo 400");
  assert.ok(diagram.lanes.includes("Catalog"));
});

test("trace collapses a crowded file until it is opened", () => {
  const nodes: IndexNode[] = [
    node({
      uid: "AC-2",
      file: "catalog/nist-800-53.sdoc",
      tag: "REQUIREMENT",
      title: "Account Management",
    }),
  ];
  for (let index = 0; index < 10; index += 1) {
    nodes.push(
      node({
        uid: `IDN-${index}`,
        file: "apps/identity/SYS.sdoc",
        tag: "REQUIREMENT",
        title: "Sign-in",
        relations: [{ type: "Parent", role: "ConformsTo", value: "AC-2" }],
      }),
    );
  }
  const graph = buildGraph(nodes, "AC-2", 1);
  const collapsed = traceDiagram(graph, "AC-2", new Set());
  assert.equal(collapsed.nodes.filter((item) => item.kind === "bundle").length, 1);
  assert.equal(collapsed.nodes.filter((item) => item.uid.startsWith("IDN-")).length, 0);
  const bundle = collapsed.nodes.find((item) => item.kind === "bundle");
  assert.ok(bundle);
  const opened = traceDiagram(graph, "AC-2", new Set([bundle!.id]));
  assert.equal(opened.nodes.filter((item) => item.uid.startsWith("IDN-")).length, 10);
  assert.equal(opened.nodes.some((item) => item.kind === "bundle"), false);
});

test("an open group keeps its children inside the parent box", () => {
  const boxes = layoutDiagram([
    layoutBox("file", 0, 0),
    layoutBox("sec", 1, 1),
    layoutBox("req", 2, 2),
    layoutBox("other", 0, 3),
  ]).nodes;
  const file = boxes.find((item) => item.id === "file");
  const sec = boxes.find((item) => item.id === "sec");
  const req = boxes.find((item) => item.id === "req");
  const other = boxes.find((item) => item.id === "other");
  assert.ok(file && sec && req && other);
  assert.ok(sec.x > file.x && sec.x + sec.w < file.x + file.w);
  assert.ok(sec.y > file.y && sec.y + sec.h < file.y + file.h);
  assert.ok(req.x > sec.x && req.x + req.w < sec.x + sec.w);
  assert.ok(req.y > sec.y && req.y + req.h < sec.y + sec.h);
  assert.ok(other.y >= file.y + file.h);
});

function layoutBox(id: string, depth: number, order: number) {
  return {
    id,
    column: 0,
    title: id,
    sub: "",
    kind: depth === 2 ? ("item" as const) : ("bundle" as const),
    uid: id,
    file: "a.sdoc",
    focus: false,
    hot: true,
    order,
    depth,
  };
}
