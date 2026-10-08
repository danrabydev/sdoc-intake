import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { loadConfig } from "../config.js";
import { writeBusinessAudit } from "../audit/business-audit.js";
import { readDogfoodFile, loadDogfoodSeed, countSeedRows } from "./load-dogfood.js";
import {
  assertSeedResetAllowed,
  countDogfoodYamlEntities,
  resetDogfoodSeed,
  SeedResetRefusedError,
  summarizeSeedReset,
} from "./seed-reset.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";
import { seedAuthUsers, testConfigEnv } from "../test/harness.js";
import { createMemoryKeyProvider } from "../key/memory-provider.js";
import type pg from "pg";

async function countAll(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    return await countSeedRows(client);
  } finally {
    client.release();
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const dogfoodPath = path.join(repoRoot, "docs/design/seed/dogfood.yaml");

function devConfig(extra: Record<string, string> = {}) {
  return loadConfig({ ...testConfigEnv(), ...extra });
}

describe("seed reset", () => {
  it("refuses outside development mode", () => {
    const config = devConfig({ REQALM_MODE: "production" });
    assert.throws(
      () => assertSeedResetAllowed(config),
      (err: unknown) =>
        err instanceof SeedResetRefusedError && /production/.test((err as Error).message),
    );
  });

  it("refuses without confirmation", async () => {
    const pg = await createMigratedPglitePool();
    const config = devConfig();
    const seed = await readDogfoodFile(dogfoodPath);
    await loadDogfoodSeed(pg.pool, config, seed);
    await assert.rejects(
      () =>
        resetDogfoodSeed(pg.pool, config, seed, {
          confirm: false,
          seedPath: dogfoodPath,
        }),
      SeedResetRefusedError,
    );
    await pg.close();
  });

  it("reload matches YAML counts and spot-checks after drift", async () => {
    const pg = await createMigratedPglitePool();
    const keyProvider = createMemoryKeyProvider();
    await seedAuthUsers(pg.pool, keyProvider);
    const config = devConfig();
    const seed = await readDogfoodFile(dogfoodPath);
    await loadDogfoodSeed(pg.pool, config, seed);

    await pg.pool.query(
      `UPDATE requirement_versions SET status = 'active' WHERE uid = 'CAP-DEVENV-SEED-RESET'`,
    );
    await pg.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, parent, kind, title)
       VALUES ('FIX-STALE-ROW', 'reqalm', 'SEC-DEVENV', 'requirement', 'stale row')`,
    );

    const yamlCounts = countDogfoodYamlEntities(seed);
    const result = await resetDogfoodSeed(pg.pool, config, seed, {
      confirm: true,
      seedPath: dogfoodPath,
      actorIdentityId: "test-operator",
    });

    const dbCounts = await countAll(pg.pool);

    assert.equal(dbCounts.requirement_lines, yamlCounts.requirement_lines);
    assert.equal(dbCounts.requirement_versions, yamlCounts.requirement_versions);
    assert.equal(dbCounts.releases, yamlCounts.releases);

    const cap = await pg.pool.query(
      `SELECT status FROM requirement_versions WHERE uid = $1`,
      ["CAP-DEVENV-SEED-RESET"],
    );
    assert.equal(cap.rows[0]?.status, "draft");

    const stale = await pg.pool.query(
      `SELECT 1 FROM requirement_lines WHERE base_uid = 'FIX-STALE-ROW'`,
    );
    assert.equal(stale.rowCount, 0);

    const rel = await pg.pool.query(
      `SELECT status FROM releases WHERE id = 'rel-r1-seed-reset'`,
    );
    assert.equal(rel.rows[0]?.status, "planned");

    assert.ok(result.auditRequestId);
    await pg.close();
  });

  it("is idempotent on a second run", async () => {
    const pg = await createMigratedPglitePool();
    const config = devConfig();
    const seed = await readDogfoodFile(dogfoodPath);
    await resetDogfoodSeed(pg.pool, config, seed, {
      confirm: true,
      seedPath: dogfoodPath,
    });
    const snap1 = await pg.pool.query(
      `SELECT uid, status, statement FROM requirement_versions ORDER BY uid`,
    );
    await resetDogfoodSeed(pg.pool, config, seed, {
      confirm: true,
      seedPath: dogfoodPath,
    });
    const snap2 = await pg.pool.query(
      `SELECT uid, status, statement FROM requirement_versions ORDER BY uid`,
    );
    assert.deepEqual(snap1.rows, snap2.rows);
    await pg.close();
  });

  it("preserves audit rows, identities, grants, and sessions", async () => {
    const pg = await createMigratedPglitePool();
    const keyProvider = createMemoryKeyProvider();
    await seedAuthUsers(pg.pool, keyProvider);
    const config = devConfig();
    const seed = await readDogfoodFile(dogfoodPath);
    await loadDogfoodSeed(pg.pool, config, seed);

    await pg.pool.query(
      `INSERT INTO identities (id, display_name) VALUES ('extra-harness-user', 'Extra') ON CONFLICT DO NOTHING`,
    );
    await pg.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role)
       VALUES ('grant-extra', 'reqalm', 'extra-harness-user', 'Reader') ON CONFLICT DO NOTHING`,
    );
    await writeBusinessAudit(pg.pool, {
      requestId: "pre-reset-audit",
      operation: "test.preserve",
      outcome: "allow",
    });
    const credBefore = await pg.pool.query(
      `SELECT password_hash FROM local_credentials WHERE identity_id = 'casey-reader'`,
    );

    await resetDogfoodSeed(pg.pool, config, seed, {
      confirm: true,
      seedPath: dogfoodPath,
    });

    const audit = await pg.pool.query(`SELECT count(*)::int AS c FROM audit_events`);
    assert.ok((audit.rows[0]?.c as number) >= 2);
    const pre = await pg.pool.query(
      `SELECT 1 FROM audit_events WHERE request_id = 'pre-reset-audit'`,
    );
    assert.equal(pre.rowCount, 1);
    const resetAudit = await pg.pool.query(
      `SELECT 1 FROM audit_events WHERE operation = 'devenv.seed.reset'`,
    );
    assert.equal(resetAudit.rowCount, 1);
    const extra = await pg.pool.query(`SELECT 1 FROM identities WHERE id = 'extra-harness-user'`);
    assert.equal(extra.rowCount, 1);
    const grant = await pg.pool.query(`SELECT 1 FROM project_grants WHERE id = 'grant-extra'`);
    assert.equal(grant.rowCount, 1);
    const credAfter = await pg.pool.query(
      `SELECT password_hash FROM local_credentials WHERE identity_id = 'casey-reader'`,
    );
    assert.equal(credBefore.rows[0]?.password_hash, credAfter.rows[0]?.password_hash);
    await pg.close();
  });

  it("rolls back when reload fails after wipe", async () => {
    const pg = await createMigratedPglitePool();
    const config = devConfig();
    const seed = await readDogfoodFile(dogfoodPath);
    await loadDogfoodSeed(pg.pool, config, seed);
    const before = await countAll(pg.pool);

    await assert.rejects(
      () =>
        resetDogfoodSeed(pg.pool, config, seed, {
          confirm: true,
          seedPath: dogfoodPath,
          testAbortAfterWipe: true,
        }),
      /testAbortAfterWipe/,
    );

    const after = await countAll(pg.pool);
    assert.deepEqual(before, after);
    await pg.close();
  });

  it("loads the full current dogfood.yaml (import-ready)", async () => {
    const pg = await createMigratedPglitePool();
    const config = devConfig();
    const seed = await readDogfoodFile(dogfoodPath);
    const yamlCounts = countDogfoodYamlEntities(seed);
    assert.ok(yamlCounts.requirement_lines > 300);
    assert.ok(yamlCounts.requirement_versions > 300);
    assert.ok(yamlCounts.releases >= 10);

    await resetDogfoodSeed(pg.pool, config, seed, {
      confirm: true,
      seedPath: dogfoodPath,
    });

    const client = await pg.pool.connect();
    try {
      const plan = await summarizeSeedReset(client, seed, dogfoodPath);
      assert.equal(plan.load.requirement_lines, yamlCounts.requirement_lines);
      const db = await countSeedRows(client);
      assert.equal(db.requirement_lines, yamlCounts.requirement_lines);
      assert.equal(db.requirement_versions, yamlCounts.requirement_versions);
      assert.equal(db.releases, yamlCounts.releases);
    } finally {
      client.release();
    }
    await pg.close();
  });
});
