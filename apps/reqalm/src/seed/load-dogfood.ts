import { randomBytes } from "node:crypto";
import { hashPassword } from "../credential/password.js";
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
  releases?: Record<string, unknown>[];
  platform_grants?: Record<string, unknown>[];
};

export type SeedResult = {
  inserted: Record<string, number>;
  devAccountsCreated: number;
  unchanged: boolean;
};

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
    releases: 0,
    release_delivers: 0,
    dev_local_accounts: 0,
    local_credentials: 0,
    platform_grants: 0,
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
    for (const [position, rel] of (seed.releases ?? []).entries()) {
      await upsertRelease(client, rel, position, inserted);
    }
    for (const g of seed.platform_grants ?? []) {
      await upsertPlatformGrant(client, g, inserted);
    }

    // ARCH-DEVENV-IDENTITY.1: no committed/default dev credential. Use the local .env value, or
    // generate one at first seed and show it locally (only printed when accounts are created).
    const configuredPassword = config.REQALM_DEV_ACCOUNT_PASSWORD;
    const devPassword = configuredPassword ?? randomBytes(18).toString("base64url");
    inserted.dev_local_accounts = await upsertDevLocalAccounts(
      client,
      seed.identities,
      devPassword,
    );
    if (inserted.dev_local_accounts > 0 && !configuredPassword) {
      console.log(
        `[reqalm seed] Created ${inserted.dev_local_accounts} dev local accounts (<identity-id>@dev.local). ` +
          `Generated dev-only password (shown once; set REQALM_DEV_ACCOUNT_PASSWORD in .env to choose your own): ${devPassword}`,
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
    "releases",
    "release_delivers",
    "dev_local_accounts",
    "local_credentials",
    "platform_grants",
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
    "reqalm";
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

/**
 * Releases are seed-owned metadata (status flips planned → shipped as PRs merge), so unlike the
 * insert-if-absent fixtures above they are updated in place and their delivers set is synced to
 * the seed. Only genuinely new rows count as inserted, so a re-run with no seed change is a no-op.
 */
async function upsertRelease(
  client: pg.PoolClient,
  row: Record<string, unknown>,
  position: number,
  inserted: Record<string, number>,
) {
  const r = await client.query(
    `
    INSERT INTO releases (id, project_id, name, status, planned_on, shipped_on, cyber_gate, notes, position)
    VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9)
    ON CONFLICT (id) DO UPDATE SET
      project_id = EXCLUDED.project_id, name = EXCLUDED.name, status = EXCLUDED.status,
      planned_on = EXCLUDED.planned_on, shipped_on = EXCLUDED.shipped_on,
      cyber_gate = EXCLUDED.cyber_gate, notes = EXCLUDED.notes, position = EXCLUDED.position
    RETURNING (xmax = 0) AS inserted
  `,
    [
      row.id,
      row.project_id,
      row.name,
      row.status,
      row.planned_on ?? null,
      row.shipped_on ?? null,
      row.cyber_gate === true,
      row.notes ?? null,
      position,
    ],
  );
  if (r.rows[0]?.inserted) inserted.releases++;

  const delivers = ((row.delivers as unknown[] | undefined) ?? []).map(String);
  await client.query(
    "DELETE FROM release_delivers WHERE release_id = $1 AND NOT (version_uid = ANY($2::text[]))",
    [row.id, delivers],
  );
  for (const [position, uid] of delivers.entries()) {
    const d = await client.query(
      `
      INSERT INTO release_delivers (release_id, version_uid, position)
      VALUES ($1, $2, $3)
      ON CONFLICT (release_id, version_uid) DO UPDATE SET position = EXCLUDED.position
      RETURNING (xmax = 0) AS inserted
    `,
      [row.id, uid, position],
    );
    if (d.rows[0]?.inserted) inserted.release_delivers++;
  }
}

async function upsertPlatformGrant(
  client: pg.PoolClient,
  row: Record<string, unknown>,
  inserted: Record<string, number>,
) {
  const id =
    row.id ??
    `platform-${row.identity_id}-${row.role}`.replace(/\s+/g, "-");
  const r = await client.query(
    `
    INSERT INTO platform_grants (id, identity_id, role, notes)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `,
    [id, row.identity_id, row.role, row.notes ?? null],
  );
  if (r.rowCount) inserted.platform_grants++;
}

async function upsertDevLocalAccounts(
  client: pg.PoolClient,
  identities: Record<string, unknown>[],
  password: string,
): Promise<number> {
  let created = 0;
  const hash = await hashPassword(password);
  for (const id of identities) {
    const identityId = String(id.id);
    const username = `${identityId}@dev.local`;
    const legacy = await client.query(
      `
      INSERT INTO dev_local_accounts (identity_id, username, password_hash, is_dev_seeded)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (identity_id) DO NOTHING
      RETURNING identity_id
    `,
      [identityId, username, hash],
    );
    const cred = await client.query(
      `
      INSERT INTO local_credentials (identity_id, username, password_hash, is_dev_seeded)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (identity_id) DO NOTHING
      RETURNING identity_id
    `,
      [identityId, username, hash],
    );
    if (legacy.rowCount || cred.rowCount) created++;
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
  const caps = await pool.query(
    "SELECT count(*)::int AS c FROM requirement_lines WHERE kind = 'capability'",
  );
  const releases = await pool.query(`
    SELECT r.id, r.name, r.status, r.planned_on::text AS planned_on, r.shipped_on::text AS shipped_on,
           count(d.version_uid)::int AS delivers,
           count(l.base_uid)::int AS capabilities
      FROM releases r
      LEFT JOIN release_delivers d ON d.release_id = r.id
      LEFT JOIN requirement_versions v ON v.uid = d.version_uid
      LEFT JOIN requirement_lines l
        ON l.base_uid = v.base_uid AND l.project_id = v.project_id AND l.kind = 'capability'
     GROUP BY r.id
     ORDER BY r.position, r.id
  `);
  return {
    identities: counts.identities ?? 0,
    project_grants: counts.project_grants ?? 0,
    requirement_lines: counts.requirement_lines ?? 0,
    requirement_versions: counts.requirement_versions ?? 0,
    capabilities: (caps.rows[0]?.c as number | undefined) ?? 0,
    release_count: counts.releases ?? 0,
    release_delivers: counts.release_delivers ?? 0,
    releases: releases.rows,
    sample_identity_id: (sample.rows[0]?.id as string | undefined) ?? null,
  };
}
