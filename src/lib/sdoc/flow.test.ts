import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexNode } from "./api-types.ts";
import { flowSource } from "./flow.ts";

function node(partial: Partial<IndexNode> & Pick<IndexNode, "uid" | "file" | "tag">): IndexNode {
  return {
    title: partial.uid,
    statement: "",
    relations: [],
    ...partial,
  };
}

test("the flow groups documents and draws parent links", () => {
  const { source, hits } = flowSource(
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
      node({ uid: "CAP-1", file: "CAP.sdoc", tag: "REQUIREMENT", title: "Capability" }),
    ],
    "SYS-010",
  );
  assert.match(source, /flowchart LR/);
  assert.match(source, /subgraph/);
  assert.match(source, /System · SYS/);
  assert.match(source, /Refines/);
  assert.match(source, /CAP-1/);
  assert.doesNotMatch(source, /SYS-SEC-1/);
  assert.doesNotMatch(source, /SYS-099/);
  assert.match(source, /class .* focus/);
  assert.equal([...hits.values()].some((hit) => hit.uid === "SYS-010" && hit.file === "product/SYS.sdoc"), true);
});
