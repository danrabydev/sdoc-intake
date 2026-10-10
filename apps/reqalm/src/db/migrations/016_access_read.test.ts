import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { loadConfig } from "../../config.js";
import { createMigratedPglitePool } from "../../test/pglite-pool.js";
import { testConfigEnv } from "../../test/harness.js";
import { loadDogfoodSeed, readDogfoodFile } from "../../seed/load-dogfood.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const dogfoodPath = path.join(repoRoot, "docs/design/seed/dogfood.yaml");

describe("016 access read schema", () => {
  it("RESTRICT FKs on client_grants and loader round-trip", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(dogfoodPath);
    try {
      await loadDogfoodSeed(pg.pool, config, seed, { skipUnchangedCheck: true });
      const pool = pg.pool;
      const row = await pool.query<{ id: string }>(
        `SELECT id FROM client_grants WHERE client_id = 'raby-family' AND identity_id = 'pat-client-admin'`,
      );
      assert.equal(row.rows[0]?.id, "grant-pat-raby-client-admin");

      const reject = /violates foreign key constraint|RESTRICT/i;
      await assert.rejects(() => pool.query(`DELETE FROM clients WHERE id = 'raby-family'`), reject);
      await assert.rejects(
        () => pool.query(`DELETE FROM identities WHERE id = 'pat-client-admin'`),
        reject,
      );
    } finally {
      await pg.close();
    }
  });
});
