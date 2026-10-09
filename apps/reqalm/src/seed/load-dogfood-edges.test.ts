import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../config.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";
import { DOGFOOD_SEED_PATH, testConfigEnv } from "../test/harness.js";
import { SeedValidationError, loadDogfoodSeed, readDogfoodFile, type DogfoodSeed } from "./load-dogfood.js";

describe("loadDogfoodSeed trace edges", () => {
  it("persists dogfood edges and catalog labels", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    try {
      await loadDogfoodSeed(pg.pool, config, seed, { skipUnchangedCheck: true });
      const edges = await pg.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM trace_edges`);
      assert.equal(edges.rows[0]?.c, 1644);
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
