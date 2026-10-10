import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";
import { loadConfig } from "../config.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";
import { testConfigEnv } from "../test/harness.js";
import { SeedValidationError, loadDogfoodSeed, readDogfoodFile } from "./load-dogfood.js";

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

describe("dogfood planning loader", () => {
  it("persists iterations, change_sets, and work_item_links from dogfood", async () => {
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(dogfoodPath);
    await withMigratedPool(async (pool) => {
      await loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true });
      assert.equal((await pool.query(`SELECT count(*)::int AS c FROM iterations WHERE project_id = 'reqalm'`)).rows[0]?.c, 3);
      assert.equal((await pool.query(`SELECT count(*)::int AS c FROM change_sets WHERE project_id = 'reqalm'`)).rows[0]?.c, 5);
      assert.equal((await pool.query(`SELECT count(*)::int AS c FROM work_item_links WHERE project_id = 'reqalm'`)).rows[0]?.c, 2);
    });
  });

  it("rejects invalid planning ids at load", async () => {
    const config = loadConfig(testConfigEnv());
    await withMigratedPool(async (pool) => {
      await assert.rejects(
        () =>
          loadDogfoodSeed(pool, config, {
            client: { id: "c", name: "C", created_at: "2026-01-01T00:00:00Z" },
            projects: [{ id: "p", client_id: "c", name: "P" }],
            identities: [],
            project_grants: [],
            iterations: [{ id: "Bad_ID", project_id: "p", name: "x" }],
          }),
        SeedValidationError,
      );
    });
  });

  it("DELETE change_sets RESTRICTs when child rows exist", async () => {
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(dogfoodPath);
    const raw = parseYaml(readFileSync(dogfoodPath, "utf8")) as { change_sets?: { id: string }[] };
    const parent = raw.change_sets?.find((c) => c.id === "cs-sdlc-r1-security-review")?.id;
    assert.ok(parent);
    await withMigratedPool(async (pool) => {
      await loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true });
      await assert.rejects(() => pool.query(`DELETE FROM change_sets WHERE id = $1`, [parent]), /restrict/i);
    });
  });
});
