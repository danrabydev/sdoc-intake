import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DOGFOOD_SEED_PATH } from "../test/harness.js";
import { readDogfoodFile, type DogfoodContractSeedRow } from "./load-dogfood.js";

const TRACE_MERGE = "56bfc4d6a9fe04559ccddae636ec4052d84ae907";
const KEY_SCOPE = "ARCH-KEY-SCOPE";
const KEY_SCOPE_DRAFT = "ARCH-KEY-SCOPE.1";
const NIST = "nist-800-53@rev5-dogfood-20261006";
const STIG = "asd-stig@v6r4";

const DRAFT_SUCCESSORS = [
  KEY_SCOPE_DRAFT,
  "ARCH-ATTACH-PIN-VERSION.1",
  "ARCH-ATTACH-SCOPE.1",
  "ARCH-ATTACH-ENCRYPT.1",
] as const;

const V0_OUTBOUND: Array<{ to: string; kind: string; catalog_imprint_id?: string }> = [
  { to: "ARCH-KEY", kind: "refines" },
  { to: "M03", kind: "uses" },
  { to: "SC-28.1", kind: "conforms_to", catalog_imprint_id: NIST },
  { to: "V-222588", kind: "conforms_to", catalog_imprint_id: STIG },
  { to: "V-222589", kind: "conforms_to", catalog_imprint_id: STIG },
  { to: "V-222642", kind: "conforms_to", catalog_imprint_id: STIG },
];

function hasEdge(
  edges: Array<{ from?: string; to?: string; kind?: string; catalog_imprint_id?: string }>,
  from: string,
  spec: (typeof V0_OUTBOUND)[number],
) {
  return edges.some(
    (e) =>
      e.from === from &&
      e.to === spec.to &&
      e.kind === spec.kind &&
      (spec.catalog_imprint_id ?? "") === (e.catalog_imprint_id ?? ""),
  );
}

describe("attach-figma seed (ARCH-KEY-SCOPE)", () => {
  it("keeps shipped v0 outbound edges and copies them onto draft .1", async () => {
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    const edges = seed.edges ?? [];
    const v0 = seed.requirement_versions?.find((v) => v.uid === KEY_SCOPE);
    assert.ok(v0, KEY_SCOPE);
    assert.equal(v0.status, "active");
    assert.ok(seed.requirement_versions?.some((v) => v.uid === KEY_SCOPE_DRAFT));

    for (const spec of V0_OUTBOUND) {
      assert.ok(hasEdge(edges, KEY_SCOPE, spec), `missing v0 ${spec.kind} → ${spec.to}`);
      assert.ok(hasEdge(edges, KEY_SCOPE_DRAFT, spec), `missing .1 copy ${spec.kind} → ${spec.to}`);
    }
  });

  it("product contract omits draft .1 successors and includes ARCH-ATTACH-VERSIONS v0", async () => {
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    const prod = seed.contracts?.find(
      (row: DogfoodContractSeedRow) => row.id === "ctr-reqalm-product",
    );
    assert.ok(prod?.in_scope_of?.length);
    const scope = prod.in_scope_of;
    assert.ok(scope.includes(KEY_SCOPE));
    assert.ok(scope.includes("ARCH-ATTACH-VERSIONS"));
    for (const uid of DRAFT_SUCCESSORS) {
      assert.ok(!scope.includes(uid), `draft successor in scope: ${uid}`);
    }
    assert.ok(scope.includes("ARCH-ATTACH-PIN-VERSION"));
    assert.ok(scope.includes("ARCH-ATTACH-SCOPE"));
    assert.ok(scope.includes("ARCH-ATTACH-ENCRYPT"));
  });

  it("product contract pins at most one version per requirement line (#38)", async () => {
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    const prod = seed.contracts?.find(
      (row: DogfoodContractSeedRow) => row.id === "ctr-reqalm-product",
    );
    assert.ok(prod?.in_scope_of?.length);
    const scope = prod.in_scope_of;
    const baseByUid = new Map(
      (seed.requirement_versions ?? []).map((v) => [String(v.uid), String(v.base_uid)]),
    );
    const byLine = new Map<string, string[]>();
    for (const uid of scope) {
      const base = baseByUid.get(uid);
      assert.ok(base, uid);
      const list = byLine.get(base) ?? [];
      list.push(uid);
      byLine.set(base, list);
    }
    for (const [base, uids] of byLine) {
      assert.equal(uids.length, 1, `${base} has ${uids.length} pins: ${uids.join(", ")}`);
    }
  });

  it("delta v3 keeps attachment v0 outbound edges alongside .1 mints", async () => {
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    const edges = seed.edges ?? [];
    assert.ok(edges.some((e) => e.from === "ARCH-ATTACH-PIN-VERSION"));
    assert.ok(edges.some((e) => e.from === "ARCH-ATTACH-PIN-VERSION.1"));
    assert.ok(edges.some((e) => e.from === "ARCH-ATTACH-SCOPE"));
    assert.ok(edges.some((e) => e.from === "ARCH-ATTACH-SCOPE.1"));
    assert.ok(seed.requirement_lines?.some((l) => l.base_uid === "ARCH-ATTACH-VERSIONS"));
  });

  it("ships parallel PR #39 trace-inherit release at full main merge SHA (rule 3)", async () => {
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    const rel = seed.releases?.find((r) => r.id === "rel-r1-trace-inherit-uses");
    assert.ok(rel);
    assert.equal(rel.status, "shipped");
    assert.equal(rel.shipped_on, "2026-10-09");
    assert.match(String(rel.notes ?? ""), new RegExp(TRACE_MERGE));
    const cap = seed.requirement_versions?.find((v) => v.uid === "CAP-TRACE-INHERIT-USES");
    assert.ok(cap);
    assert.equal(cap.status, "active");
    assert.equal(cap.verification_outcome, "pass");
    const sec = cap.security as { verification_note?: string } | undefined;
    assert.match(String(sec?.verification_note ?? ""), new RegExp(TRACE_MERGE));
  });

  it("ARCH-ATTACH-SCOPE and UPLOAD v0 use ARCH-API-RBAC.1 (accepted deviation)", async () => {
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    const edges = seed.edges ?? [];
    const usesRbac = (from: string) =>
      edges.some((e) => e.from === from && e.to === "ARCH-API-RBAC.1" && e.kind === "uses");
    assert.ok(usesRbac("ARCH-ATTACH-SCOPE"));
    assert.ok(usesRbac("ARCH-ATTACH-UPLOAD"));
    assert.ok(!edges.some((e) => e.from === "ARCH-ATTACH-SCOPE" && e.to === "ARCH-API-RBAC"));
    assert.ok(!edges.some((e) => e.from === "ARCH-ATTACH-UPLOAD" && e.to === "ARCH-API-RBAC"));
  });
});
