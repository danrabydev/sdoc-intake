import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { loadConfig } from "../config.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";
import { DOGFOOD_SEED_PATH, testConfigEnv } from "../test/harness.js";
import { SeedValidationError, loadDogfoodSeed, readDogfoodFile, type DogfoodSeed } from "./load-dogfood.js";

describe("loadDogfoodSeed trace edges", () => {
  it("preserves baseline outbound edges from the committed fixture", () => {
    const patch = "docs/design/seed/scripts/patch_ui_layout_capabilities_release.py";
    const r = spawnSync("python3", [patch, "--validate-baseline-edges"], {
      cwd: new URL("../../../../", import.meta.url).pathname,
      encoding: "utf-8",
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /baseline edge preservation ok/);
  });

  it("persists dogfood edges and catalog labels", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    try {
      await loadDogfoodSeed(pg.pool, config, seed, { skipUnchangedCheck: true });
      const edges = await pg.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM trace_edges`);
      assert.equal(edges.rows[0]?.c, 1934);
      const inheritable = await pg.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM trace_edges WHERE inheritable = true`,
      );
      assert.equal(inheritable.rows[0]?.c, 4);
      const badInh = await pg.pool.query<{ c: number }>(
        `
        SELECT count(*)::int AS c
          FROM trace_edges e
          JOIN requirement_versions v ON v.uid = e.from_uid
          JOIN requirement_lines l ON l.base_uid = v.base_uid AND l.project_id = v.project_id
         WHERE e.inheritable = true
           AND (e.kind <> 'conforms_to' OR l.kind <> 'capability')
        `,
      );
      assert.equal(badInh.rows[0]?.c, 0);
      const ac3 = await pg.pool.query<{ title: string }>(
        `SELECT title FROM catalog_item_labels WHERE catalog_id = 'cat-nist-global' AND item_uid = 'AC-3'`,
      );
      assert.match(ac3.rows[0]?.title ?? "", /Access Enforcement/);
      const reqalmSec = await pg.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM catalog_item_labels WHERE catalog_id = 'cat-reqalm-security'`,
      );
      assert.equal(reqalmSec.rows[0]?.c, 9);
    } finally {
      await pg.close();
    }
  });

  it("dogfood seed has at most one active version per line", async () => {
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    const activeByBase = new Map<string, string[]>();
    for (const ver of seed.requirement_versions ?? []) {
      if (String(ver.status) !== "active") continue;
      const base = String(ver.base_uid);
      const list = activeByBase.get(base) ?? [];
      list.push(String(ver.uid));
      activeByBase.set(base, list);
    }
    for (const [base, uids] of activeByBase) {
      assert.ok(uids.length <= 1, `${base} has active versions: ${uids.join(", ")}`);
    }
  });

  it("persists inheritable false when the seed edge omits inheritable", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    const seed: DogfoodSeed = {
      client: { id: "c1", name: "C1" },
      projects: [{ id: "p1", client_id: "c1", name: "P1" }],
      identities: [],
      project_grants: [],
      requirement_lines: [
        { base_uid: "CAP-X", project_id: "p1", parent: null, kind: "capability", title: "Cap" },
        { base_uid: "CAP-Y", project_id: "p1", parent: null, kind: "capability", title: "Y" },
      ],
      requirement_versions: [
        { uid: "CAP-X", base_uid: "CAP-X", version_n: 0, status: "active", statement: "s", project_id: "p1" },
        { uid: "CAP-Y", base_uid: "CAP-Y", version_n: 0, status: "active", statement: "t", project_id: "p1" },
      ],
      edges: [{ from: "CAP-X", to: "CAP-Y", kind: "uses" }],
    };
    try {
      await loadDogfoodSeed(pg.pool, config, seed, { skipUnchangedCheck: true });
      const row = await pg.pool.query<{ inheritable: boolean }>(
        `SELECT inheritable FROM trace_edges WHERE from_uid = 'CAP-X'`,
      );
      assert.equal(row.rows[0]?.inheritable, false);
    } finally {
      await pg.close();
    }
  });

  it("accepts inheritable conforms_to on a capability version", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    const seed: DogfoodSeed = {
      client: { id: "c1", name: "C1" },
      projects: [{ id: "p1", client_id: "c1", name: "P1" }],
      identities: [],
      project_grants: [],
      requirement_lines: [
        { base_uid: "CAP-X", project_id: "p1", parent: null, kind: "capability", title: "Cap" },
      ],
      requirement_versions: [
        { uid: "CAP-X", base_uid: "CAP-X", version_n: 0, status: "active", statement: "s", project_id: "p1" },
      ],
      catalogs: [
        {
          id: "cat-nist-global",
          is_standard: true,
          current_imprint_id: "imp1",
          entries: [{ id: "AC-3", title: "Access Enforcement" }],
        },
      ],
      catalog_imprints: [{ id: "imp1", catalog_id: "cat-nist-global" }],
      edges: [
        {
          from: "CAP-X",
          to: "AC-3",
          kind: "conforms_to",
          catalog_imprint_id: "imp1",
          inheritable: true,
        },
      ],
    };
    try {
      await loadDogfoodSeed(pg.pool, config, seed, { skipUnchangedCheck: true });
      const row = await pg.pool.query<{ inheritable: boolean }>(
        `SELECT inheritable FROM trace_edges WHERE from_uid = 'CAP-X' AND to_uid = 'AC-3'`,
      );
      assert.equal(row.rows[0]?.inheritable, true);
    } finally {
      await pg.close();
    }
  });

  it("rejects inheritable conforms_to on a requirement line", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    const seed: DogfoodSeed = {
      client: { id: "c1", name: "C1" },
      projects: [{ id: "p1", client_id: "c1", name: "P1" }],
      identities: [],
      project_grants: [],
      requirement_lines: [
        { base_uid: "REQ-X", project_id: "p1", parent: null, kind: "requirement", title: "Req" },
      ],
      requirement_versions: [
        { uid: "REQ-X", base_uid: "REQ-X", version_n: 0, status: "active", statement: "s", project_id: "p1" },
      ],
      edges: [
        {
          from: "REQ-X",
          to: "AC-3",
          kind: "conforms_to",
          catalog_imprint_id: "imp1",
          inheritable: true,
        },
      ],
    };
    try {
      await assert.rejects(
        () => loadDogfoodSeed(pg.pool, config, seed, { skipUnchangedCheck: true }),
        (e) =>
          e instanceof SeedValidationError &&
          /inheritable conforms_to requires a capability source line/.test(String(e)),
      );
    } finally {
      await pg.close();
    }
  });

  it("rejects inheritable on non-conforms_to edges", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    const seed: DogfoodSeed = {
      client: { id: "c1", name: "C1" },
      projects: [{ id: "p1", client_id: "c1", name: "P1" }],
      identities: [],
      project_grants: [],
      requirement_lines: [
        { base_uid: "CAP-A", project_id: "p1", parent: null, kind: "capability", title: "A" },
        { base_uid: "CAP-B", project_id: "p1", parent: null, kind: "capability", title: "B" },
      ],
      requirement_versions: [
        { uid: "CAP-A", base_uid: "CAP-A", version_n: 0, status: "active", statement: "a", project_id: "p1" },
        { uid: "CAP-B", base_uid: "CAP-B", version_n: 0, status: "active", statement: "b", project_id: "p1" },
      ],
      edges: [{ from: "CAP-A", to: "CAP-B", kind: "uses", inheritable: true }],
    };
    try {
      await assert.rejects(
        () => loadDogfoodSeed(pg.pool, config, seed, { skipUnchangedCheck: true }),
        (e) =>
          e instanceof SeedValidationError &&
          /inheritable is only allowed on conforms_to edges/.test(String(e)),
      );
    } finally {
      await pg.close();
    }
  });

  it("rejects version rows without resolvable project_id", async () => {
    const pg = await createMigratedPglitePool();
    const orphan: DogfoodSeed = { client: { id: "c1", name: "C1" }, projects: [{ id: "p1", client_id: "c1", name: "P1" }], identities: [], project_grants: [], requirement_lines: [], requirement_versions: [{ uid: "V1", base_uid: "B1", version_n: 0, status: "active", statement: "s" }], edges: [] };
    try {
      await assert.rejects(() => loadDogfoodSeed(pg.pool, loadConfig(testConfigEnv()), orphan, { skipUnchangedCheck: true }), (e) => e instanceof SeedValidationError && /no project_id/.test(String(e)));
    } finally {
      await pg.close();
    }
  });
});
