import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DOGFOOD_SEED_PATH } from "../test/harness.js";
import {
  BASELINE_MAIN_SHA,
  assertBaselineOutboundEdgesPreserved,
  canonicalEdge,
  edgeFingerprint,
  loadBaselineOutboundFixture,
  missingBaselineOutboundEdges,
} from "./baseline-outbound-edges.js";
import { readDogfoodFile } from "./load-dogfood.js";

describe("dogfood baseline outbound edges @ main d54c5a6", () => {
  it("preserves every baseline outbound edge record (all fields) in dogfood.yaml", async () => {
    const fixture = loadBaselineOutboundFixture();
    assert.equal(fixture.baseline_main, BASELINE_MAIN_SHA);
    assert.equal(fixture.edges.length, fixture.edge_count);
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    assertBaselineOutboundEdgesPreserved(seed);
  });

  it("detects removal of ARCH-API-RBAC.1 refines ARCH-API-RBAC", async () => {
    const fixture = loadBaselineOutboundFixture();
    const versionUids = new Set(fixture.version_uids);
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    const target = edgeFingerprint({
      from: "ARCH-API-RBAC.1",
      to: "ARCH-API-RBAC",
      kind: "refines",
    });
    assert.ok(fixture.edges.some((e) => edgeFingerprint(e) === target));
    const trimmed = (seed.edges ?? []).filter((e) => edgeFingerprint(e) !== target);
    const outbound = trimmed.filter((e) => versionUids.has(String(e.from ?? "")));
    const missing = missingBaselineOutboundEdges({ ...seed, edges: outbound });
    assert.ok(
      [...missing.keys()].some((fp) => fp.includes("ARCH-API-RBAC.1") && fp.includes("refines")),
    );
  });

  it("detects trace_suspect field changes on a baseline outbound edge", () => {
    const fixture = loadBaselineOutboundFixture();
    const suspect = fixture.edges.find((e) => e.trace_suspect === true);
    assert.ok(suspect, "fixture includes a trace_suspect outbound edge");
    const flipped = { ...canonicalEdge(suspect), trace_suspect: false };
    assert.notEqual(edgeFingerprint(suspect), edgeFingerprint(flipped));
    const present = fixture.edges.map((e) => (e === suspect ? flipped : e));
    const missing = missingBaselineOutboundEdges({ edges: present });
    assert.ok(missing.size > 0);
  });
});
