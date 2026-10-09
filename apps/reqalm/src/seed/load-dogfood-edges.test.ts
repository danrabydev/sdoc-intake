import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";
import { DOGFOOD_SEED_PATH, testConfigEnv } from "../test/harness.js";
import { loadDogfoodSeed, readDogfoodFile } from "./load-dogfood.js";

describe("loadDogfoodSeed trace edges", () => {
  it("persists dogfood edges and catalog labels", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    try {
      await loadDogfoodSeed(pg.pool, config, seed, { skipUnchangedCheck: true });
      const edges = await pg.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM trace_edges`);
      assert.equal(edges.rows[0]?.c, 1560);
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
});
