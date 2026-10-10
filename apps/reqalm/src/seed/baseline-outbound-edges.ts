import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DogfoodSeed, DogfoodTraceEdgeSeedRow } from "./load-dogfood.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export type BaselineOutboundFixture = {
  baseline_main: string;
  version_uids: string[];
  edge_count: number;
  edges: DogfoodTraceEdgeSeedRow[];
};

export const BASELINE_MAIN_SHA = "d54c5a67235fd56e49bdbc2a939dce89ff5a4f36";

export function baselineOutboundFixturePath(): string {
  return path.join(repoRoot, "docs/design/seed/fixtures/dogfood-baseline-outbound-edges.json");
}

export function canonicalEdge(edge: DogfoodTraceEdgeSeedRow): DogfoodTraceEdgeSeedRow {
  const out: DogfoodTraceEdgeSeedRow = {};
  for (const k of Object.keys(edge).sort()) {
    out[k] = edge[k];
  }
  return out;
}

export function edgeFingerprint(edge: DogfoodTraceEdgeSeedRow): string {
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

export function loadBaselineOutboundFixture(): BaselineOutboundFixture {
  return JSON.parse(readFileSync(baselineOutboundFixturePath(), "utf8")) as BaselineOutboundFixture;
}

/** Seed input for outbound-edge checks (only `edges` is read). */
export type BaselineOutboundSeedInput = Pick<DogfoodSeed, "edges">;

export function assertBaselineFixtureMain(fixture: BaselineOutboundFixture): void {
  if (fixture.baseline_main !== BASELINE_MAIN_SHA) {
    throw new Error(
      `baseline fixture main mismatch: ${fixture.baseline_main} != ${BASELINE_MAIN_SHA}`,
    );
  }
}

/** Same check as `seed_baseline_edges.validate_baseline_edges_preserved` on parsed dogfood seed. */
export function missingBaselineOutboundEdges(
  seed: BaselineOutboundSeedInput,
  fixture: BaselineOutboundFixture = loadBaselineOutboundFixture(),
): Map<string, number> {
  assertBaselineFixtureMain(fixture);
  const versionUids = new Set(fixture.version_uids);
  const outbound = (seed.edges ?? []).filter((e) => versionUids.has(String(e.from ?? "")));
  return subtractRequired(counter(fixture.edges), counter(outbound));
}

export function assertBaselineOutboundEdgesPreserved(seed: BaselineOutboundSeedInput): void {
  const missing = missingBaselineOutboundEdges(seed);
  if (missing.size > 0) {
    const sample = [...missing.keys()].slice(0, 2).join("; ");
    throw new Error(`baseline edge preservation failed (sample): ${sample}`);
  }
}
