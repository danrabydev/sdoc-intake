import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { AppConfig } from "../config.js";
import { isProduction } from "../config.js";
import { writeBusinessAudit } from "../audit/business-audit.js";
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
  actorIdentityId?: string;
  /** @internal test hook — abort after wipe, before reload */
  testAbortAfterWipe?: boolean;
};

const PRESERVED_TABLES = [
  "identities",
  "project_grants",
  "platform_grants",
  "local_credentials",
  "dev_local_accounts",
  "auth_sessions",
  "audit_events",
  "auth_audit_events",
  "signing_keys",
  "data_encryption_keys",
] as const;

export function assertSeedResetAllowed(
  config: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isProduction(config)) {
    throw new SeedResetRefusedError(
      "Refusing dogfood seed reset: REQALM_MODE=production (dev-only command)",
    );
  }
  if (env.NODE_ENV === "production") {
    throw new SeedResetRefusedError(
      "Refusing dogfood seed reset: NODE_ENV=production (dev-only command)",
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
  assertSeedResetAllowed(config);
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

    if (options.testAbortAfterWipe) {
      throw new Error("testAbortAfterWipe");
    }

    const loadResult = await applyDogfoodSeed(client, config, seed, {
      metadataSync: true,
      skipUnchangedCheck: true,
    });

    const counts = await countSeedRows(client);
    const yamlCounts = countDogfoodYamlEntities(seed);
    const delivers = await client.query(
      `
      SELECT count(*)::int AS c FROM release_delivers d
      JOIN releases r ON r.id = d.release_id
      WHERE r.project_id = ANY($1::text[])
    `,
      [projectIds],
    );
    const releaseDeliversDb = delivers.rows[0]?.c as number;
    if (
      counts.requirement_lines !== yamlCounts.requirement_lines ||
      counts.requirement_versions !== yamlCounts.requirement_versions ||
      counts.releases !== yamlCounts.releases ||
      releaseDeliversDb !== yamlCounts.release_delivers
    ) {
      throw new Error(
        `Post-reset row counts mismatch YAML: db=${JSON.stringify({
          requirement_lines: counts.requirement_lines,
          requirement_versions: counts.requirement_versions,
          releases: counts.releases,
          release_delivers: releaseDeliversDb,
        })} yaml=${JSON.stringify(yamlCounts)}`,
      );
    }

    const auditRequestId = `seed-reset-${randomBytes(8).toString("hex")}`;
    await writeBusinessAudit(client, {
      requestId: auditRequestId,
      operation: "devenv.seed.reset",
      outcome: "allow",
      identityId: options.actorIdentityId ?? "devenv-cli",
      projectId: projectIds[0] ?? null,
      targetType: "dogfood_seed",
      targetId: options.seedPath,
      detail: {
        wiped,
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
          actor: options.actorIdentityId ?? "devenv-cli",
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

export function formatSeedResetPlan(plan: SeedResetPlan): string {
  const lines = [
    "Dogfood seed reset plan (dev-only):",
    `  seed: ${plan.seedPath}`,
    `  projects: ${plan.projectIds.join(", ")}`,
    "  will DELETE project fixture rows:",
    ...Object.entries(plan.wipe).map(([k, v]) => `    - ${k}: ${v}`),
    "  will LOAD from YAML:",
    ...Object.entries(plan.load).map(([k, v]) => `    - ${k}: ${v}`),
    "  preserved (not truncated):",
    `    - ${plan.preserved.join(", ")}`,
  ];
  return lines.join("\n");
}
