import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { loadConfig } from "../config.js";
import { writeBusinessAudit } from "../audit/business-audit.js";
import {
  readDogfoodFile,
  loadDogfoodSeed,
  countSeedRows,
  type DogfoodSeed,
} from "./load-dogfood.js";
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

function writeDevenvMarker(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "reqalm-devenv-"));
  const file = path.join(dir, "devenv.env");
  writeFileSync(file, "# test harness devenv marker\nREQALM_DEVENV_MARKER=1\n");
  return file;
}

/** Local dev Postgres URL as the CLI requires it; the PGlite pool under test never dials it. */
const LOCAL_DEV_DATABASE_URL = "postgres://reqalm:harness@127.0.0.1:5432/reqalm";

/** Positive local-devenv markers for the PGlite harness: the real guard runs, nothing is bypassed. */
function seedResetHarnessEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const devenvFile = writeDevenvMarker();
  return {
    ...testConfigEnv(),
    DATABASE_URL: LOCAL_DEV_DATABASE_URL,
    REQALM_MODE: "development",
    REQALM_DEVENV_ENV_FILE: devenvFile,
    ...extra,
  };
}

/** Ordered contents of every table the reset wipes and reloads. */
async function dumpResetTables(pool: pg.Pool) {
  const q = async (sql: string) => (await pool.query(sql)).rows;
  return {
    requirement_lines: await q(`SELECT * FROM requirement_lines ORDER BY project_id, base_uid`),
    requirement_versions: await q(`SELECT * FROM requirement_versions ORDER BY uid`),
    releases: await q(`SELECT * FROM releases ORDER BY id`),
    release_delivers: await q(`SELECT * FROM release_delivers ORDER BY release_id, version_uid`),
  };
}

function harness(extra: Record<string, string> = {}) {
  const env = seedResetHarnessEnv(extra);
  return { env, config: loadConfig(env) };
}

async function assertResetRefusedLeavesData(
  resetEnv: NodeJS.ProcessEnv,
  label: string,
  confirm = true,
): Promise<void> {
  const pg = await createMigratedPglitePool();
  const config = loadConfig({
    ...seedResetHarnessEnv(),
    DATABASE_URL: resetEnv.DATABASE_URL ?? LOCAL_DEV_DATABASE_URL,
  });
  const seed = await readDogfoodFile(dogfoodPath);
  await loadDogfoodSeed(pg.pool, config, seed);
  await pg.pool.query(
    `INSERT INTO requirement_lines (base_uid, project_id, parent, kind, title)
     VALUES ('FIX-GUARD-${label}', 'reqalm', 'SEC-DEVENV', 'requirement', 'guard probe')`,
  );
  const before = await dumpResetTables(pg.pool);
  const auditBefore = await pg.pool.query(`SELECT count(*)::int AS c FROM audit_events`);

  await assert.rejects(
    () =>
      resetDogfoodSeed(pg.pool, config, seed, {
        confirm,
        seedPath: dogfoodPath,
        repoRoot,
        env: resetEnv,
      }),
    SeedResetRefusedError,
  );

  assert.deepEqual(await dumpResetTables(pg.pool), before);
  const auditAfter = await pg.pool.query(`SELECT count(*)::int AS c FROM audit_events`);
  assert.equal(auditAfter.rows[0]?.c, auditBefore.rows[0]?.c);
  const probe = await pg.pool.query(
    `SELECT 1 FROM requirement_lines WHERE base_uid = $1`,
    [`FIX-GUARD-${label}`],
  );
  assert.equal(probe.rowCount, 1);
  await pg.close();
}

describe("seed reset allowlist", () => {
  it("refuses when REQALM_MODE is unset and leaves data untouched", async () => {
    const base = seedResetHarnessEnv();
    const { REQALM_MODE: _drop, ...unsetMode } = base;
    await assertResetRefusedLeavesData(unsetMode, "unset-mode");
  });

  it("refuses when REQALM_MODE is staging and leaves data untouched", async () => {
    const resetEnv = { ...seedResetHarnessEnv(), REQALM_MODE: "staging" };
    await assertResetRefusedLeavesData(resetEnv, "staging");
  });

  it("refuses when devenv marker file is missing and leaves data untouched", async () => {
    const resetEnv = seedResetHarnessEnv({ REQALM_DEVENV_ENV_FILE: "/nonexistent/devenv.env" });
    await assertResetRefusedLeavesData(resetEnv, "no-devenv");
  });

  it("refuses when REQALM_MODE is production and leaves data untouched", async () => {
    await assertResetRefusedLeavesData(
      seedResetHarnessEnv({ REQALM_MODE: "production" }),
      "prod-mode",
    );
  });

  it("refuses when NODE_ENV is production and leaves data untouched", async () => {
    await assertResetRefusedLeavesData(
      seedResetHarnessEnv({ NODE_ENV: "production" }),
      "node-env-prod",
    );
    for (const NODE_ENV of ["Production", " production "]) {
      assert.throws(
        () =>
          assertSeedResetAllowed({
            databaseUrl: LOCAL_DEV_DATABASE_URL,
            env: seedResetHarnessEnv({ NODE_ENV }),
            repoRoot,
          }),
        SeedResetRefusedError,
      );
    }
  });

  it("refuses a non-local DATABASE_URL host or port and leaves data untouched", async () => {
    await assertResetRefusedLeavesData(
      seedResetHarnessEnv({ DATABASE_URL: "postgres://reqalm:x@db.example.com:5432/reqalm" }),
      "remote-host",
    );
    await assertResetRefusedLeavesData(
      seedResetHarnessEnv({ DATABASE_URL: "postgres://reqalm:x@127.0.0.1:5433/reqalm" }),
      "other-port",
    );
  });

  it("refuses without --confirm and leaves data untouched", async () => {
    await assertResetRefusedLeavesData(seedResetHarnessEnv(), "no-confirm", false);
  });

  it("checks the host and port pg connects to, not just the URL authority", () => {
    const env = seedResetHarnessEnv();
    const refused = (databaseUrl: string | undefined) =>
      assert.throws(
        () => assertSeedResetAllowed({ databaseUrl, env, repoRoot }),
        SeedResetRefusedError,
        String(databaseUrl),
      );
    refused(`${LOCAL_DEV_DATABASE_URL}?host=db.example.com`);
    refused(`${LOCAL_DEV_DATABASE_URL}?port=6543`);
    refused(`${LOCAL_DEV_DATABASE_URL}?host=/var/run/postgresql`);
    refused("postgres://reqalm:x@10.0.0.5:5432/reqalm");
    refused("postgres://reqalm:x@[::1]:5432/reqalm");
    refused("postgres://reqalm:x@localhost.example.com:5432/reqalm");
    refused("postgres://reqalm:x@127.0.0.1.nip.io:5432/reqalm");
    refused(undefined);
    refused("");
    for (const ok of [
      LOCAL_DEV_DATABASE_URL,
      "postgresql://reqalm:x@localhost:5432/reqalm",
      "postgres://reqalm:x@127.0.0.1/reqalm",
    ]) {
      assert.doesNotThrow(() => assertSeedResetAllowed({ databaseUrl: ok, env, repoRoot }), ok);
    }
  });

  it("REQALM_SEED_RESET_TEST_HARNESS does not weaken any check", () => {
    const harnessVar = { REQALM_SEED_RESET_TEST_HARNESS: "pglite" };
    const cases: Array<[Record<string, string>, string]> = [
      [{ ...harnessVar, REQALM_MODE: "production" }, LOCAL_DEV_DATABASE_URL],
      [{ ...harnessVar, NODE_ENV: "production" }, LOCAL_DEV_DATABASE_URL],
      [{ ...harnessVar, REQALM_DEVENV_ENV_FILE: "/nonexistent/devenv.env" }, LOCAL_DEV_DATABASE_URL],
      [harnessVar, "postgres://reqalm:x@db.example.com:5432/reqalm"],
      [harnessVar, "postgres://pglite/test"],
    ];
    for (const [extra, databaseUrl] of cases) {
      assert.throws(
        () => assertSeedResetAllowed({ databaseUrl, env: seedResetHarnessEnv(extra), repoRoot }),
        SeedResetRefusedError,
        JSON.stringify({ extra, databaseUrl }),
      );
    }
  });
});

describe("seed reset", () => {
  it("reload matches YAML counts and spot-checks after drift", async () => {
    const pg = await createMigratedPglitePool();
    const keyProvider = createMemoryKeyProvider();
    await seedAuthUsers(pg.pool, keyProvider);
    const { config, env } = harness();
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
      repoRoot,
      env,
      actor: "test-operator",
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
    const { config, env } = harness();
    const seed = await readDogfoodFile(dogfoodPath);
    await resetDogfoodSeed(pg.pool, config, seed, {
      confirm: true,
      seedPath: dogfoodPath,
      repoRoot,
      env,
    });
    const snap1 = await dumpResetTables(pg.pool);
    await resetDogfoodSeed(pg.pool, config, seed, {
      confirm: true,
      seedPath: dogfoodPath,
      repoRoot,
      env,
    });
    assert.deepEqual(await dumpResetTables(pg.pool), snap1);
    await pg.close();
  });

  it("preserves audit rows, identities, grants, and sessions", async () => {
    const pg = await createMigratedPglitePool();
    const keyProvider = createMemoryKeyProvider();
    await seedAuthUsers(pg.pool, keyProvider);
    const { config, env } = harness();
    const seed = await readDogfoodFile(dogfoodPath);
    await loadDogfoodSeed(pg.pool, config, seed);

    await pg.pool.query(
      `INSERT INTO identities (id, display_name) VALUES ('extra-harness-user', 'Extra') ON CONFLICT DO NOTHING`,
    );
    await pg.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role)
       VALUES ('grant-extra', 'reqalm', 'extra-harness-user', 'Reader') ON CONFLICT DO NOTHING`,
    );
    await pg.pool.query(
      `INSERT INTO platform_grants (id, identity_id, role) VALUES ('pgrant-extra', 'extra-harness-user', 'PlatformAdmin')`,
    );
    // A project the YAML does not list: the wipe is scoped to the YAML projects, so its rows survive.
    await pg.pool.query(
      `INSERT INTO projects (id, client_id, name) SELECT 'foreign-proj', client_id, 'Foreign' FROM projects WHERE id = 'reqalm'`,
    );
    await pg.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('FOREIGN-1', 'foreign-proj', 'requirement', 'foreign line')`,
    );
    await pg.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement)
       VALUES ('FOREIGN-1@1', 'FOREIGN-1', 'foreign-proj', 1, 'draft', 'foreign statement')`,
    );
    await pg.pool.query(
      `INSERT INTO releases (id, project_id, name, status) VALUES ('rel-foreign', 'foreign-proj', 'Foreign', 'planned')`,
    );
    const foreignRows = async () =>
      (
        await pg.pool.query(
          `SELECT 'line' AS t, base_uid AS id FROM requirement_lines WHERE project_id = 'foreign-proj'
           UNION ALL SELECT 'version', uid FROM requirement_versions WHERE project_id = 'foreign-proj'
           UNION ALL SELECT 'release', id FROM releases WHERE project_id = 'foreign-proj' ORDER BY 1, 2`,
        )
      ).rows;
    assert.equal((await foreignRows()).length, 3);
    await writeBusinessAudit(pg.pool, {
      requestId: "pre-reset-audit",
      operation: "test.preserve",
      outcome: "allow",
    });
    // Runtime changes to seeded auth rows (a revoked grant, an edited identity) must survive.
    const seededGrant = String(seed.project_grants.find((g) => !g.revoked_at)?.id);
    await pg.pool.query(
      `UPDATE project_grants SET status = 'revoked', revoked_at = now() WHERE id = $1`,
      [seededGrant],
    );
    await pg.pool.query(
      `UPDATE identities SET display_name = 'Edited at runtime' WHERE id = 'casey-reader'`,
    );
    await pg.pool.query(
      `INSERT INTO web_sessions (id, identity_id, refresh_token_ciphertext, csrf_token, absolute_expires_at, idle_expires_at)
       VALUES ('ws-harness', 'casey-reader', 'ciphertext', 'csrf', now() + interval '1 day', now() + interval '1 hour')`,
    );
    await pg.pool.query(
      `INSERT INTO auth_sessions (id, identity_id, absolute_expires_at, idle_expires_at)
       VALUES ('as-harness', 'casey-reader', now() + interval '1 day', now() + interval '1 hour')`,
    );
    // Every table the reset does not own, row for row (clients/projects are synced from the YAML,
    // seed_meta records the reset, audit_events is checked below).
    const notOwned = async () => {
      const owned = new Set([
        "requirement_lines",
        "requirement_versions",
        "releases",
        "release_delivers",
        "clients",
        "projects",
        "seed_meta",
        "audit_events",
      ]);
      const tables = (
        await pg.pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)
      ).rows
        .map((r) => String(r.tablename))
        .filter((t) => !owned.has(t));
      const rows: Record<string, unknown[]> = {};
      for (const t of tables) rows[t] = (await pg.pool.query(`SELECT * FROM ${t} x ORDER BY x::text`)).rows;
      return rows;
    };
    const auditRows = async () =>
      (await pg.pool.query(`SELECT * FROM audit_events ORDER BY id`)).rows;
    const keptBefore = await notOwned();
    for (const t of ["identities", "project_grants", "platform_grants", "local_credentials", "web_sessions", "auth_sessions"]) {
      assert.ok((keptBefore[t]?.length ?? 0) > 0, `${t} has rows before the reset`);
    }
    const auditBefore = await auditRows();

    await resetDogfoodSeed(pg.pool, config, seed, {
      confirm: true,
      seedPath: dogfoodPath,
      repoRoot,
      env,
      actor: "dan",
    });

    assert.deepEqual(await notOwned(), keptBefore);
    assert.equal((await foreignRows()).length, 3, "rows of a project not in the YAML survive the reset");
    const auditAfter = await auditRows();
    // audit_events: every earlier row unchanged, exactly one row appended.
    assert.deepEqual(auditAfter.slice(0, -1), auditBefore);
    assert.equal(auditAfter.length, auditBefore.length + 1);
    const row = auditAfter.at(-1) as Record<string, unknown>;
    assert.equal(row.operation, "devenv.seed.reset");
    assert.equal(row.outcome, "allow");
    // The CLI authenticates no ReqALM identity: the label never lands in identity_id.
    assert.equal(row.identity_id, null);
    assert.equal(row.target_id, "docs/design/seed/dogfood.yaml");
    const detail = row.detail as Record<string, unknown>;
    assert.deepEqual(detail.actor, { kind: "devenv-cli", label: "dan", verified: false });
    assert.deepEqual(detail.loaded, countDogfoodYamlEntities(seed));
    // Cascade-deleted delivers are counted too (the four reset tables, before the reload).
    assert.deepEqual(Object.keys(detail.wiped as object).sort(), [
      "release_delivers",
      "releases",
      "requirement_lines",
      "requirement_versions",
    ]);
    assert.equal((detail.wiped as Record<string, number>).release_delivers, countDogfoodYamlEntities(seed).release_delivers);
    const detailText = JSON.stringify(row);
    assert.ok(!detailText.includes("harness"), "no DATABASE_URL credentials in the audit row");

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
    await pg.close();
  });

  it("rolls back when the reload fails mid-load (broken record after the wipe)", async () => {
    const pg = await createMigratedPglitePool();
    const { config, env } = harness();
    const seed = await readDogfoodFile(dogfoodPath);
    await loadDogfoodSeed(pg.pool, config, seed);
    await pg.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, parent, kind, title)
       VALUES ('FIX-ROLLBACK-PROBE', 'reqalm', 'SEC-DEVENV', 'requirement', 'rollback probe')`,
    );
    const before = await dumpResetTables(pg.pool);
    const auditBefore = await pg.pool.query(`SELECT count(*)::int AS c FROM audit_events`);

    // Lines and versions load, then the last release delivers an unknown version (FK violation).
    const broken: DogfoodSeed = structuredClone(seed);
    const lastRelease = broken.releases!.at(-1)!;
    lastRelease.delivers = [...((lastRelease.delivers as string[]) ?? []), "CAP-DOES-NOT-EXIST"];
    await assert.rejects(() =>
      resetDogfoodSeed(pg.pool, config, broken, {
        confirm: true,
        seedPath: dogfoodPath,
        repoRoot,
        env,
      }),
    );

    assert.deepEqual(await dumpResetTables(pg.pool), before);
    const auditAfter = await pg.pool.query(`SELECT count(*)::int AS c FROM audit_events`);
    assert.equal(auditAfter.rows[0]?.c, auditBefore.rows[0]?.c);
    await pg.close();
  });

  it("rolls back when the reloaded rows do not match the YAML counts", async () => {
    const pg = await createMigratedPglitePool();
    const { config, env } = harness();
    const seed = await readDogfoodFile(dogfoodPath);
    await loadDogfoodSeed(pg.pool, config, seed);
    // Not in the YAML: a committed wipe would remove it, so it proves the rollback (the failure is a JS throw, not SQL).
    await pg.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, parent, kind, title)
       VALUES ('FIX-COUNT-PROBE', 'reqalm', 'SEC-DEVENV', 'requirement', 'count probe')`,
    );
    const before = await dumpResetTables(pg.pool);
    const auditBefore = await pg.pool.query(`SELECT count(*)::int AS c FROM audit_events`);

    // A duplicated version loads without error (insert-if-absent) but leaves one row fewer than the YAML lists.
    const duplicated: DogfoodSeed = structuredClone(seed);
    duplicated.requirement_versions = [...duplicated.requirement_versions!, duplicated.requirement_versions![0]!];
    await assert.rejects(
      () =>
        resetDogfoodSeed(pg.pool, config, duplicated, {
          confirm: true,
          seedPath: dogfoodPath,
          repoRoot,
          env,
        }),
      /Post-reset row counts mismatch YAML/,
    );

    assert.deepEqual(await dumpResetTables(pg.pool), before);
    const probe = await pg.pool.query(`SELECT count(*)::int AS c FROM requirement_lines WHERE base_uid = 'FIX-COUNT-PROBE'`);
    assert.equal(probe.rows[0]?.c, 1, "the non-seed probe row must survive the rolled-back reset");
    const auditAfter = await pg.pool.query(`SELECT count(*)::int AS c FROM audit_events`);
    assert.equal(auditAfter.rows[0]?.c, auditBefore.rows[0]?.c);
    await pg.close();
  });

  it("loads the full current dogfood.yaml (import-ready)", async () => {
    const pg = await createMigratedPglitePool();
    const { config, env } = harness();
    const seed = await readDogfoodFile(dogfoodPath);
    const yamlCounts = countDogfoodYamlEntities(seed);
    assert.ok(yamlCounts.requirement_lines > 300);
    assert.ok(yamlCounts.requirement_versions > 300);
    assert.ok(yamlCounts.releases >= 10);

    await resetDogfoodSeed(pg.pool, config, seed, {
      confirm: true,
      seedPath: dogfoodPath,
      repoRoot,
      env,
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
