import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { DOGFOOD_SEED_PATH } from "../test/harness.js";
import { readDogfoodFile, type DogfoodTraceEdgeSeedRow } from "./load-dogfood.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixturePath = path.join(
  repoRoot,
  "docs/design/seed/fixtures/dogfood-baseline-outbound-edges.json",
);

type BaselineFixture = {
  baseline_main: string;
  version_uids: string[];
  edge_count: number;
  edges: DogfoodTraceEdgeSeedRow[];
};

function canonicalEdge(edge: DogfoodTraceEdgeSeedRow): DogfoodTraceEdgeSeedRow {
  const out: DogfoodTraceEdgeSeedRow = {};
  for (const k of Object.keys(edge).sort()) {
    out[k] = edge[k];
  }
  return out;
}

function edgeFingerprint(edge: DogfoodTraceEdgeSeedRow): string {
  return JSON.stringify(canonicalEdge(edge));
}

function counter(edges: DogfoodTraceEdgeSeedRow[]): Map<string, number> {
  const c = new Map<string, number>();
  for (const e of edges) {
    const fp = edgeFingerprint(e);
    c.set(fp, (c.get(fp) ?? 0) + 1);
  }
  return c;
}

function subtractRequired(
  required: Map<string, number>,
  present: Map<string, number>,
): Map<string, number> {
  const missing = new Map<string, number>();
  for (const [fp, need] of required) {
    const have = present.get(fp) ?? 0;
    if (have < need) {
      missing.set(fp, need - have);
    }
  }
  return missing;
}

function loadFixture(): BaselineFixture {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as BaselineFixture;
}

describe("dogfood baseline outbound edges @ main 56bfc4d", () => {
  it("preserves every baseline outbound edge record (all fields) in dogfood.yaml", async () => {
    const fixture = loadFixture();
    assert.equal(fixture.baseline_main, "56bfc4d6a9fe04559ccddae636ec4052d84ae907");
    assert.equal(fixture.edges.length, fixture.edge_count);
    const versionUids = new Set(fixture.version_uids);
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    const outbound = (seed.edges ?? []).filter((e) => versionUids.has(String(e.from ?? "")));
    const missing = subtractRequired(counter(fixture.edges), counter(outbound));
    assert.equal(missing.size, 0, `missing/changed baseline edges (sample): ${[...missing.keys()].slice(0, 2).join("; ")}`);
  });

  it("detects removal of ARCH-API-RBAC.1 refines ARCH-API-RBAC", async () => {
    const fixture = loadFixture();
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
    const missing = subtractRequired(counter(fixture.edges), counter(outbound));
    assert.ok(
      [...missing.keys()].some((fp) => fp.includes("ARCH-API-RBAC.1") && fp.includes("refines")),
    );
  });

  it("detects trace_suspect field changes on a baseline outbound edge", () => {
    const fixture = loadFixture();
    const suspect = fixture.edges.find((e) => e.trace_suspect === true);
    assert.ok(suspect, "fixture includes a trace_suspect outbound edge");
    const flipped = { ...canonicalEdge(suspect), trace_suspect: false };
    assert.notEqual(edgeFingerprint(suspect), edgeFingerprint(flipped));
    const present = fixture.edges.map((e) => (e === suspect ? flipped : e));
    const missing = subtractRequired(counter(fixture.edges), counter(present));
    assert.ok(missing.size > 0);
  });
});
