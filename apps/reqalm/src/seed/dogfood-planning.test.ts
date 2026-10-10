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

const dogfoodPath = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
  "docs/design/seed/dogfood.yaml",
);

async function withPool(run: (pool: Awaited<ReturnType<typeof createMigratedPglitePool>>["pool"]) => Promise<void>) {
  const pg = await createMigratedPglitePool();
  try {
    await run(pg.pool);
  } finally {
    await pg.close();
  }
}

describe("dogfood planning loader", () => {
  it("loads planning tables and enforces id + FK rules", async () => {
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(dogfoodPath);
    const parent = (parseYaml(readFileSync(dogfoodPath, "utf8")) as { change_sets?: { id: string }[] }).change_sets?.find(
      (c) => c.id === "cs-sdlc-r1-security-review",
    )?.id;
    assert.ok(parent);
    await withPool(async (pool) => {
      await loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true });
      const count = async (t: string) => (await pool.query(`SELECT count(*)::int AS c FROM ${t} WHERE project_id = 'reqalm'`)).rows[0]?.c;
      assert.equal(await count("iterations"), 3);
      assert.equal(await count("change_sets"), 5);
      assert.equal(await count("work_item_links"), 2);
      await assert.rejects(() => pool.query(`DELETE FROM change_sets WHERE id = $1`, [parent]), /restrict/i);
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
});
