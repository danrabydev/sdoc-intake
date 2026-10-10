import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { loadConfig } from "../config.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";
import { testConfigEnv } from "../test/harness.js";
import { loadDogfoodSeed, readDogfoodFile, SeedValidationError } from "./load-dogfood.js";
import { SeedValidationError as WorkflowSeedValidationError } from "./load-dogfood-workflow.js";

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

describe("dogfood workflow loader", () => {
  it("persists workflow catalog, profiles, bindings, and approval records from dogfood", async () => {
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(dogfoodPath);
    await withMigratedPool(async (pool) => {
      await loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true });
      assert.equal((await pool.query(`SELECT count(*)::int AS c FROM workflow_gates`)).rows[0]?.c, 12);
      assert.equal((await pool.query(`SELECT count(*)::int AS c FROM workflow_action_hooks`)).rows[0]?.c, 12);
      assert.equal((await pool.query(`SELECT count(*)::int AS c FROM workflow_subject_kinds`)).rows[0]?.c, 7);
      assert.equal((await pool.query(`SELECT count(*)::int AS c FROM workflow_profiles`)).rows[0]?.c, 2);
      assert.equal((await pool.query(`SELECT count(*)::int AS c FROM workflow_role_bindings`)).rows[0]?.c, 9);
      assert.equal(
        (await pool.query(`SELECT count(*)::int AS c FROM workflow_approval_records WHERE project_id = 'reqalm'`)).rows[0]
          ?.c,
        99,
      );
      assert.equal((await pool.query(`SELECT count(*)::int AS c FROM workflow_gate_signoffs`)).rows[0]?.c, 1);
      const proj = await pool.query(`SELECT workflow_profile_id FROM projects WHERE id = 'reqalm'`);
      assert.equal(proj.rows[0]?.workflow_profile_id, "wf-commercial-default");
    });
  });

  it("loader rejects unknown gate id on role_binding", async () => {
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(dogfoodPath);
    const broken = structuredClone(seed) as Record<string, unknown>;
    const bindings = (broken.role_bindings as Record<string, unknown>[]) ?? [];
    bindings.push({
      id: "rb-bad-gate",
      profile_id: "wf-commercial-default",
      gate_id: "gate-does-not-exist",
      slot: "stakeholder",
      roles: ["Reader"],
      identities: [],
    });
    broken.role_bindings = bindings;
    await withMigratedPool(async (pool) => {
      await assert.rejects(
        () => loadDogfoodSeed(pool, config, broken as never, { skipUnchangedCheck: true }),
        (e: unknown) =>
          (e instanceof SeedValidationError || e instanceof WorkflowSeedValidationError) &&
          /unknown gate_id/.test(String(e)),
      );
    });
  });

  it("DELETE workflow_profiles RESTRICTs when role_bindings reference it", async () => {
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(dogfoodPath);
    await withMigratedPool(async (pool) => {
      await loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true });
      await assert.rejects(
        () => pool.query(`DELETE FROM workflow_profiles WHERE id = 'wf-commercial-default'`),
        /foreign key|violates foreign key constraint/i,
      );
    });
  });
});
