import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type pg from "pg";
import { listMigrationFiles } from "../db/migrate.js";

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../db/migrations",
);

async function runMigrationsOnPglite(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  for (const id of await listMigrationFiles()) {
    const existing = await db.query(
      "SELECT 1 FROM schema_migrations WHERE id = $1",
      [id],
    );
    if (existing.rowCount) continue;
    const sql = await readFile(path.join(migrationsDir, `${id}.sql`), "utf8");
    await db.exec(sql);
    await db.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
  }
}

function mapResult(r: Awaited<ReturnType<PGlite["query"]>>): pg.QueryResult {
  return {
    rows: r.rows,
    rowCount: r.rowCount ?? r.affectedRows ?? r.rows.length,
    command: r.command ?? "",
    oid: 0,
    fields: [],
  };
}

/** PGlite-backed pool compatible with the app's `pg.Pool` usage in tests. */
export function createPglitePool(db: PGlite): pg.Pool {
  const clientQuery = async (text: string, params?: unknown[]) =>
    mapResult(await db.query(text, params));

  const pool = {
    query: clientQuery,
    connect: async () =>
      ({
        query: clientQuery,
        release: () => {},
      }) as pg.PoolClient,
    end: async () => {
      await db.close();
    },
    on: () => pool,
  };
  return pool as unknown as pg.Pool;
}

export async function createMigratedPglitePool(): Promise<{
  db: PGlite;
  pool: pg.Pool;
}> {
  const db = new PGlite();
  await runMigrationsOnPglite(db);
  const pool = createPglitePool(db);
  return { db, pool };
}
