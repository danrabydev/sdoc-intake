import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { loadConfig } from "../config.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";
import { testConfigEnv } from "../test/harness.js";
import { loadDogfoodSeed, readDogfoodFile } from "./load-dogfood.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const dogfoodPath = path.join(repoRoot, "docs/design/seed/dogfood.yaml");

async function withMigratedPool(run: (pool: Awaited<ReturnType<typeof createMigratedPglitePool>>["pool"]) => Promise<void>) {
  const pg = await createMigratedPglitePool();
  try {
    await run(pg.pool);
  } finally {
    await pg.close();
  }
}

describe("dogfood artifacts and attachments loader", () => {
  it("persists capability_artifacts and file_attachments from dogfood", async () => {
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(dogfoodPath);
    await withMigratedPool(async (pool) => {
      await loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true });
      const arts = (
        await pool.query(`SELECT count(*)::int AS c FROM capability_artifacts WHERE requirement_version_uid = 'CAP-SSO'`)
      ).rows[0]?.c;
      assert.equal(arts, 2);
      const atts = (
        await pool.query(
          `SELECT count(*)::int AS c FROM file_attachments WHERE parent_uid = 'CAP-ATTACH-READ' AND deleted_at IS NULL`,
        )
      ).rows[0]?.c;
      assert.equal(atts, 1);
    });
  });

  it("DELETE requirement_versions RESTRICTs when file_attachments reference parent", async () => {
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(dogfoodPath);
    await withMigratedPool(async (pool) => {
      await loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true });
      await assert.rejects(
        () => pool.query(`DELETE FROM requirement_versions WHERE uid = 'CAP-ATTACH-READ'`),
        /violates foreign key constraint|RESTRICT/i,
      );
    });
  });
});
