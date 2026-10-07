import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function listMigrationFiles(): Promise<string[]> {
  return (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => f.replace(/\.sql$/, ""));
}

export type MigrationStatus = {
  applied: string[];
  pending: string[];
  upToDate: boolean;
};

/** Compare disk migrations to schema_migrations (readiness probe). */
export async function getMigrationStatus(pool: pg.Pool): Promise<MigrationStatus> {
  const files = await listMigrationFiles();
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const result = await client.query<{ id: string }>(
      "SELECT id FROM schema_migrations ORDER BY id",
    );
    const appliedSet = new Set(result.rows.map((r) => r.id));
    const applied = files.filter((id) => appliedSet.has(id));
    const pending = files.filter((id) => !appliedSet.has(id));
    return {
      applied,
      pending,
      upToDate: pending.length === 0,
    };
  } finally {
    client.release();
  }
}

export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("BEGIN");
    await ensureMigrationsTable(client);
    const files = await listMigrationFiles();
    for (const id of files) {
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE id = $1",
        [id],
      );
      if (existing.rowCount) continue;
      const sql = await readFile(path.join(migrationsDir, `${id}.sql`), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
      applied.push(id);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return applied;
}
