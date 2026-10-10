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
  edge_count: number;
  edges: [string, string, string, string][];
};

function edgeKey(e: DogfoodTraceEdgeSeedRow): string {
  return [e.from ?? "", e.to ?? "", e.kind ?? "", e.catalog_imprint_id ?? ""].join("\0");
}

function loadFixture(): BaselineFixture {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as BaselineFixture;
}

describe("dogfood baseline outbound edges @ main 56bfc4d", () => {
  it("preserves every baseline version outbound edge in dogfood.yaml", async () => {
    const fixture = loadFixture();
    assert.equal(fixture.baseline_main, "56bfc4d6a9fe04559ccddae636ec4052d84ae907");
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    const present = new Set((seed.edges ?? []).map(edgeKey));
    const missing: string[] = [];
    for (const row of fixture.edges) {
      const key = edgeKey({ from: row[0], to: row[1], kind: row[2], catalog_imprint_id: row[3] });
      if (!present.has(key)) {
        missing.push(`${row[0]} → ${row[2]} → ${row[1]}`);
      }
    }
    assert.equal(missing.length, 0, `missing baseline edges (sample): ${missing.slice(0, 5).join("; ")}`);
  });

  it("detects removal of ARCH-API-RBAC.1 refines ARCH-API-RBAC", async () => {
    const fixture = loadFixture();
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    const target = edgeKey({ from: "ARCH-API-RBAC.1", to: "ARCH-API-RBAC", kind: "refines" });
    assert.ok(fixture.edges.some((r) => edgeKey({ from: r[0], to: r[1], kind: r[2], catalog_imprint_id: r[3] }) === target));
    const trimmed = (seed.edges ?? []).filter((e) => edgeKey(e) !== target);
    const present = new Set(trimmed.map(edgeKey));
    const missing = fixture.edges.filter(
      (r) => !present.has(edgeKey({ from: r[0], to: r[1], kind: r[2], catalog_imprint_id: r[3] })),
    );
    assert.ok(missing.some((r) => r[0] === "ARCH-API-RBAC.1" && r[1] === "ARCH-API-RBAC" && r[2] === "refines"));
  });
});
