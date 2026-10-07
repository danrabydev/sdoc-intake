import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type pg from "pg";
import type { AppConfig } from "../config.js";
import { isProduction } from "../config.js";

export type DogfoodSeed = {
  schema_version?: string;
  client: Record<string, unknown>;
  clients?: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  identities: Record<string, unknown>[];
  project_grants: Record<string, unknown>[];
  requirement_lines?: Record<string, unknown>[];
  requirement_versions?: Record<string, unknown>[];
};

export type SeedResult = {
  inserted: Record<string, number>;
  devAccountsCreated: number;
  unchanged: boolean;
};

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = createHash("sha256")
    .update(`${salt}:${password}`)
    .digest("hex");
  return `sha256:${salt}:${digest}`;
}

export async function readDogfoodFile(seedPath: string): Promise<DogfoodSeed> {
  const abs = path.resolve(seedPath);
  const raw = await readFile(abs, "utf8");
  return parse(raw) as DogfoodSeed;
}

export async function loadDogfoodSeed(
  pool: pg.Pool,
  config: AppConfig,
  seed: DogfoodSeed,
): Promise<SeedResult> {
  if (isProduction(config)) {
    throw new Error(
      "Refusing to load dogfood seed in production mode (ARCH-DEVENV-IDENTITY.1 / FIX-DENY-DEVENV-PROD-LOGIN.1)",
    );
  }

  const client = await pool.connect();
  const inserted: Record<string, number> = {
    clients: 0,
    projects: 0,
    identities: 0,
    project_grants: 0,
    requirement_lines: 0,
    requirement_versions: 0,
    dev_local_accounts: 0,
  };

  try {
    await client.query("BEGIN");

    const countBefore = await countSeedRows(client);

    await upsertClient(client, seed.client, inserted);
    for (const c of seed.clients ?? []) {
      await upsertClient(client, c, inserted);
    }

    for (const p of seed.projects) {
      await upsertProject(client, p, inserted);
    }
    for (const id of seed.identities) {
      await upsertIdentity(client, id, inserted);
    }
    for (const g of seed.project_grants) {
      await upsertGrant(client, g, inserted);
    }
    const lineProject = new Map<string, string>();
    for (const line of seed.requirement_lines ?? []) {
      lineProject.set(String(line.base_uid), String(line.project_id));
      await upsertLine(client, line, inserted);
    }
    for (const ver of seed.requirement_versions ?? []) {
      await upsertVersion(client, ver, lineProject, inserted);
    }

    // ARCH-DEVENV-IDENTITY.1: no committed/default dev credential. Use the local .env value, or
    // generate one at first seed and show it locally (only printed when accounts are created).
    const configuredPassword = config.REQAML_DEV_ACCOUNT_PASSWORD;
    const devPassword = configuredPassword ?? randomBytes(18).toString("base64url");
    inserted.dev_local_accounts = await upsertDevLocalAccounts(
      client,
      seed.identities,
      devPassword,
    );
    if (inserted.dev_local_accounts > 0 && !configuredPassword) {
      console.log(
        `[reqaml seed] Created ${inserted.dev_local_accounts} dev local accounts (<identity-id>@dev.local). ` +
          `Generated dev-only password (shown once; set REQAML_DEV_ACCOUNT_PASSWORD in .env to choose your own): ${devPassword}`,
      );
    }

    await client.query(
      `
      INSERT INTO seed_meta (key, value)
      VALUES ('dogfood', $1::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
      [
        JSON.stringify({
          schema_version: seed.schema_version,
          loaded_at: new Date().toISOString(),
          counts: await countSeedRows(client),
        }),
      ],
    );

    await client.query("COMMIT");

    const countAfter = await countSeedRows(client);
    const unchanged =
      JSON.stringify(countBefore) === JSON.stringify(countAfter) &&
      Object.values(inserted).every((n) => n === 0);

    return {
      inserted,
      devAccountsCreated: inserted.dev_local_accounts,
      unchanged,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function countSeedRows(client: pg.PoolClient) {
  const tables = [
    "clients",
    "projects",
    "identities",
    "project_grants",
    "requirement_lines",
    "requirement_versions",
    "dev_local_accounts",
  ] as const;
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const r = await client.query(`SELECT count(*)::int AS c FROM ${t}`);
    counts[t] = r.rows[0].c as number;
  }
  return counts;
}

async function upsertClient(
  client: pg.PoolClient,
  row: Record<string, unknown>,
  inserted: Record<string, number>,
) {
  const r = await client.query(
    `
    INSERT INTO clients (id, name, created_at, notes)
    VALUES ($1, $2, $3::timestamptz, $4)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `,
    [row.id, row.name, row.created_at ?? null, row.notes ?? null],
  );
  if (r.rowCount) inserted.clients++;
}

async function upsertProject(
  client: pg.PoolClient,
  row: Record<string, unknown>,
  inserted: Record<string, number>,
) {
  const r = await client.query(
    `
    INSERT INTO projects (id, client_id, name, status, notes, workflow_profile_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `,
    [
      row.id,
      row.client_id,
      row.name,
      row.status ?? null,
      row.notes ?? null,
      row.workflow_profile_id ?? null,
    ],
  );
  if (r.rowCount) inserted.projects++;
}

async function upsertIdentity(
  client: pg.PoolClient,
  row: Record<string, unknown>,
  inserted: Record<string, number>,
) {
  const r = await client.query(
    `
    INSERT INTO identities (id, external_sub, email, display_name, notes)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `,
    [
      row.id,
      row.external_sub ?? null,
      row.email ?? null,
      row.display_name ?? null,
      row.notes ?? null,
    ],
  );
  if (r.rowCount) inserted.identities++;
}

async function upsertGrant(
  client: pg.PoolClient,
  row: Record<string, unknown>,
  inserted: Record<string, number>,
) {
  const grantId =
    row.id ??
    `grant-${row.project_id}-${row.identity_id}-${row.role}`.replace(/\s+/g, "-");
  const r = await client.query(
    `
    INSERT INTO project_grants (id, project_id, identity_id, role, status, revoked_at, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `,
    [
      grantId,
      row.project_id,
      row.identity_id,
      row.role,
      row.status ?? "active",
      row.revoked_at ?? null,
      row.notes ?? null,
    ],
  );
  if (r.rowCount) inserted.project_grants++;
}

async function upsertLine(
  client: pg.PoolClient,
  row: Record<string, unknown>,
  inserted: Record<string, number>,
) {
  const r = await client.query(
    `
    INSERT INTO requirement_lines (base_uid, project_id, parent, kind, title)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (project_id, base_uid) DO NOTHING
    RETURNING base_uid
  `,
    [row.base_uid, row.project_id, row.parent ?? null, row.kind, row.title],
  );
  if (r.rowCount) inserted.requirement_lines++;
}

async function upsertVersion(
  client: pg.PoolClient,
  row: Record<string, unknown>,
  lineProject: Map<string, string>,
  inserted: Record<string, number>,
) {
  const baseUid = String(row.base_uid);
  const projectId =
    (row.project_id as string | undefined) ??
    lineProject.get(baseUid) ??
    "reqaml";
  const r = await client.query(
    `
    INSERT INTO requirement_versions (
      uid, base_uid, project_id, version_n, status, statement, title,
      priority, iteration, rbac_op, grooming_state, mint_kind
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (uid) DO NOTHING
    RETURNING uid
  `,
    [
      row.uid,
      row.base_uid,
      projectId,
      row.version_n ?? 0,
      row.status,
      row.statement,
      row.title ?? null,
      row.priority ?? null,
      row.iteration ?? null,
      row.rbac_op ?? null,
      row.grooming_state ?? null,
      row.mint_kind ?? null,
    ],
  );
  if (r.rowCount) inserted.requirement_versions++;
}

async function upsertDevLocalAccounts(
  client: pg.PoolClient,
  identities: Record<string, unknown>[],
  password: string,
): Promise<number> {
  let created = 0;
  const hash = hashPassword(password);
  for (const id of identities) {
    const identityId = String(id.id);
    const username = `${identityId}@dev.local`;
    const r = await client.query(
      `
      INSERT INTO dev_local_accounts (identity_id, username, password_hash, is_dev_seeded)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (identity_id) DO NOTHING
      RETURNING identity_id
    `,
      [identityId, username, hash],
    );
    if (r.rowCount) created++;
  }
  return created;
}

export async function getSeedSummary(pool: pg.Pool) {
  const client = await pool.connect();
  let counts: Record<string, number>;
  try {
    counts = await countSeedRows(client);
  } finally {
    client.release();
  }
  const sample = await pool.query(
    "SELECT id FROM identities WHERE id = $1 LIMIT 1",
    ["taylor-tester"],
  );
  return {
    identities: counts.identities ?? 0,
    project_grants: counts.project_grants ?? 0,
    requirement_lines: counts.requirement_lines ?? 0,
    requirement_versions: counts.requirement_versions ?? 0,
    sample_identity_id: (sample.rows[0]?.id as string | undefined) ?? null,
  };
}
