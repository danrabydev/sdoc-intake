import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import type { AppConfig } from "../config.js";
import { writeBusinessAudit } from "../audit/business-audit.js";
import { runMigrations } from "../db/migrate.js";
import {
  applyDogfoodSeed,
  countSeedRows,
  type DogfoodSeed,
  type SeedResult,
} from "./load-dogfood.js";

export class SeedResetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedResetRefusedError";
  }
}

export type SeedResetPlan = {
  seedPath: string;
  projectIds: string[];
  wipe: Record<string, number>;
  load: {
    requirement_lines: number;
    requirement_versions: number;
    releases: number;
    release_delivers: number;
  };
  preserved: string[];
};

export type SeedResetResult = SeedResult & {
  plan: SeedResetPlan;
  auditRequestId: string;
};

export type SeedResetOptions = {
  confirm: boolean;
  seedPath: string;
  repoRoot: string;
  /**
   * Unverified operator label (CLI: REQALM_SEED_RESET_ACTOR or $USER). Recorded in the audit
   * detail only, never as identity_id: the CLI does not authenticate a ReqALM identity.
   */
  actor?: string;
  /** Defaults to process.env (CLI); tests pass the same env as loadConfig. */
  env?: NodeJS.ProcessEnv;
};

export type SeedResetAllowlistInput = {
  databaseUrl: string | undefined;
  env: NodeJS.ProcessEnv;
  repoRoot: string;
};

const PRESERVED_TABLES = [
  "identities",
  "project_grants",
  "platform_grants",
  "local_credentials",
  "dev_local_accounts",
  "auth_sessions",
  "web_sessions",
  "mfa_totp_replay",
  "mfa_enrollment_tickets",
  "oauth_refresh_families",
  "oauth_refresh_tokens",
  "audit_events",
  "auth_audit_events",
  "signing_keys",
  "data_encryption_keys",
] as const;

function resolveDevenvEnvPath(env: NodeJS.ProcessEnv, repoRoot: string): string {
  const override = env.REQALM_DEVENV_ENV_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot, ".reqalm/devenv.env");
}

/**
 * Check the host and port node-postgres will actually connect to: `?host=` / `?port=` in the
 * URL override its authority, so parsing the authority alone is not enough.
 */
function checkLocalDevDatabaseUrl(
  databaseUrl: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!databaseUrl?.trim()) {
    return { ok: false, reason: "DATABASE_URL is unset" };
  }
  let host: string;
  let port: number;
  try {
    // Parses the connection string only; a Client does not connect until .connect().
    const target = new pg.Client({ connectionString: databaseUrl });
    host = String(target.host);
    port = Number(target.port);
  } catch {
    return { ok: false, reason: "DATABASE_URL is not a valid postgres URL" };
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    return {
      ok: false,
      reason: `DATABASE_URL must target local dev Postgres at 127.0.0.1 or localhost (got host ${host})`,
    };
  }
  if (port !== 5432) {
    return {
      ok: false,
      reason: `DATABASE_URL must use local dev Postgres port 5432 (got port ${port})`,
    };
  }
  return { ok: true };
}

/** Fail-closed: run only when the environment positively matches local devenv markers. */
export function assertSeedResetAllowed(input: SeedResetAllowlistInput): void {
  const { databaseUrl, env, repoRoot } = input;
  const reasons: string[] = [];

  const mode = env.REQALM_MODE?.trim();
  if (mode !== "development") {
    reasons.push(
      mode
        ? `REQALM_MODE must be exactly "development" (got "${mode}")`
        : 'REQALM_MODE is unset (must be exactly "development" for local devenv)',
    );
  }

  const devenvPath = resolveDevenvEnvPath(env, repoRoot);
  if (!existsSync(devenvPath)) {
    reasons.push(
      `missing devenv marker file ${devenvPath} (run pnpm devenv:init, or set REQALM_DEVENV_ENV_FILE)`,
    );
  }

  const db = checkLocalDevDatabaseUrl(databaseUrl);
  if (!db.ok) reasons.push(db.reason);

  if (env.NODE_ENV?.trim().toLowerCase() === "production") {
    reasons.push('NODE_ENV must not be "production" for seed reset');
  }

  if (reasons.length) {
    throw new SeedResetRefusedError(
      "Refusing dogfood seed reset: not a recognized local devenv:\n- " + reasons.join("\n- "),
    );
  }
}

export function countDogfoodYamlEntities(seed: DogfoodSeed) {
  const releaseDelivers = (seed.releases ?? []).reduce(
    (n, r) => n + (((r.delivers as unknown[] | undefined) ?? []).length),
    0,
  );
  return {
    requirement_lines: seed.requirement_lines?.length ?? 0,
    requirement_versions: seed.requirement_versions?.length ?? 0,
    releases: seed.releases?.length ?? 0,
    release_delivers: releaseDelivers,
  };
}

export async function summarizeSeedReset(
  client: pg.PoolClient,
  seed: DogfoodSeed,
  seedPath: string,
): Promise<SeedResetPlan> {
  const projectIds = seed.projects.map((p) => String(p.id));
  const wipe: Record<string, number> = {};
  for (const table of [
    "contract_scope",
    "contract_releases",
    "contracts",
    "release_delivers",
    "releases",
    "requirement_versions",
    "requirement_lines",
  ] as const) {
    if (table === "release_delivers") {
      const r = await client.query(
        `
        SELECT count(*)::int AS c FROM release_delivers d
        JOIN releases rel ON rel.id = d.release_id
        WHERE rel.project_id = ANY($1::text[])
      `,
        [projectIds],
      );
      wipe[table] = r.rows[0].c as number;
    } else {
      const r = await client.query(
        `SELECT count(*)::int AS c FROM ${table} WHERE project_id = ANY($1::text[])`,
        [projectIds],
      );
      wipe[table] = r.rows[0].c as number;
    }
  }
  return {
    seedPath,
    projectIds,
    wipe,
    load: countDogfoodYamlEntities(seed),
    preserved: [...PRESERVED_TABLES],
  };
}

async function wipeProjectSeedData(
  client: pg.PoolClient,
  projectIds: string[],
): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  const { wipeWorkflowTables } = await import("./load-dogfood-workflow.js");
  Object.assign(deleted, await wipeWorkflowTables(client, projectIds));
  for (const table of ["contract_scope", "contract_releases", "contracts"] as const) {
    const r = await client.query(`DELETE FROM ${table} WHERE project_id = ANY($1::text[])`, [projectIds]);
    deleted[table] = r.rowCount ?? 0;
  }
  const rel = await client.query(
    "DELETE FROM releases WHERE project_id = ANY($1::text[])",
    [projectIds],
  );
  deleted.releases = rel.rowCount ?? 0;
  const ver = await client.query(
    "DELETE FROM requirement_versions WHERE project_id = ANY($1::text[])",
    [projectIds],
  );
  deleted.requirement_versions = ver.rowCount ?? 0;
  const lines = await client.query(
    "DELETE FROM requirement_lines WHERE project_id = ANY($1::text[])",
    [projectIds],
  );
  deleted.requirement_lines = lines.rowCount ?? 0;
  return deleted;
}

export async function resetDogfoodSeed(
  pool: pg.Pool,
  config: AppConfig,
  seed: DogfoodSeed,
  options: SeedResetOptions,
): Promise<SeedResetResult> {
  const env = options.env ?? process.env;
  assertSeedResetAllowed({
    databaseUrl: config.DATABASE_URL,
    env,
    repoRoot: options.repoRoot,
  });
  if (!options.confirm) {
    throw new SeedResetRefusedError(
      "Refusing dogfood seed reset without explicit confirmation (pass --confirm)",
    );
  }

  const client = await pool.connect();
  const projectIds = seed.projects.map((p) => String(p.id));
  const plan = await summarizeSeedReset(client, seed, options.seedPath);

  try {
    await client.query("BEGIN");

    const wiped = await wipeProjectSeedData(client, projectIds);
    plan.wipe = {
      release_delivers: plan.wipe.release_delivers,
      releases: wiped.releases ?? 0,
      requirement_versions: wiped.requirement_versions ?? 0,
      requirement_lines: wiped.requirement_lines ?? 0,
    };

    const loadResult = await applyDogfoodSeed(client, config, seed, {
      metadataSync: true,
      skipUnchangedCheck: true,
    });

    const counts = await countSeedRows(client);
    const yamlCounts = countDogfoodYamlEntities(seed);
    // Scoped to the YAML projects like the wipe: rows of other projects are neither wiped nor counted.
    const scoped = await client.query(
      `
      SELECT
        (SELECT count(*)::int FROM requirement_lines WHERE project_id = ANY($1::text[])) AS requirement_lines,
        (SELECT count(*)::int FROM requirement_versions WHERE project_id = ANY($1::text[])) AS requirement_versions,
        (SELECT count(*)::int FROM releases WHERE project_id = ANY($1::text[])) AS releases,
        (SELECT count(*)::int FROM release_delivers d JOIN releases r ON r.id = d.release_id
          WHERE r.project_id = ANY($1::text[])) AS release_delivers
    `,
      [projectIds],
    );
    const db = scoped.rows[0] as Record<keyof typeof yamlCounts, number>;
    if (
      db.requirement_lines !== yamlCounts.requirement_lines ||
      db.requirement_versions !== yamlCounts.requirement_versions ||
      db.releases !== yamlCounts.releases ||
      db.release_delivers !== yamlCounts.release_delivers
    ) {
      throw new Error(
        `Post-reset row counts mismatch YAML: db=${JSON.stringify(db)} yaml=${JSON.stringify(yamlCounts)}`,
      );
    }

    const auditRequestId = `seed-reset-${randomBytes(8).toString("hex")}`;
    const actor = { kind: "devenv-cli", label: options.actor ?? null, verified: false };
    await writeBusinessAudit(client, {
      requestId: auditRequestId,
      operation: "devenv.seed.reset",
      outcome: "allow",
      // No authenticated ReqALM identity runs this CLI; never attribute it to one.
      identityId: null,
      projectId: projectIds[0] ?? null,
      targetType: "dogfood_seed",
      targetId: seedPathForAudit(options.seedPath, options.repoRoot),
      detail: {
        actor,
        wiped: plan.wipe,
        loaded: yamlCounts,
        schema_version: seed.schema_version,
      },
    });

    await client.query(
      `
      INSERT INTO seed_meta (key, value)
      VALUES ('dogfood_reset', $1::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
      [
        JSON.stringify({
          at: new Date().toISOString(),
          actor,
          request_id: auditRequestId,
          counts,
        }),
      ],
    );

    await client.query("COMMIT");

    return {
      ...loadResult,
      unchanged: false,
      plan,
      auditRequestId,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export type SeedResetCommandOptions = Omit<SeedResetOptions, "confirm"> & {
  /** --dry-run: print the plan only; no migration, no writes. Otherwise migrate, print, reset. */
  dryRun: boolean;
  log?: (text: string) => void;
};

/** The CLI body after its guard: --dry-run stays read-only; --confirm migrates, then resets. */
export async function runSeedResetCommand(
  pool: pg.Pool,
  config: AppConfig,
  seed: DogfoodSeed,
  options: SeedResetCommandOptions,
): Promise<SeedResetResult | undefined> {
  const { dryRun, log = console.log, ...resetOptions } = options;
  // The schema is migrated only for a confirmed reset.
  if (!dryRun) await runMigrations(pool);
  const client = await pool.connect();
  let plan: SeedResetPlan;
  try {
    plan = await summarizeSeedReset(client, seed, options.seedPath);
  } finally {
    client.release();
  }
  log(formatSeedResetPlan(plan));
  if (dryRun) return undefined;
  const result = await resetDogfoodSeed(pool, config, seed, { ...resetOptions, confirm: true });
  log(JSON.stringify({ seedPath: options.seedPath, ...result }, null, 2));
  return result;
}

/** Repo-relative seed path for the audit row (no host home directory in the trail). */
function seedPathForAudit(seedPath: string, repoRoot: string): string {
  const rel = path.relative(repoRoot, path.resolve(seedPath));
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : path.basename(seedPath);
}

export function formatSeedResetPlan(plan: SeedResetPlan): string {
  const lines = [
    "Dogfood seed reset plan (dev-only):",
    `  seed: ${plan.seedPath}`,
    `  projects: ${plan.projectIds.join(", ")}`,
    "  will DELETE project fixture rows:",
    ...Object.entries(plan.wipe).map(([k, v]) => `    - ${k}: ${v}`),
    "  will LOAD from YAML:",
    ...Object.entries(plan.load).map(([k, v]) => `    - ${k}: ${v}`),
    "  updated in place from YAML: clients, projects (identities and grants only inserted when missing)",
    "  preserved (not deleted or rewritten):",
    `    - ${plan.preserved.join(", ")}`,
  ];
  return lines.join("\n");
}
