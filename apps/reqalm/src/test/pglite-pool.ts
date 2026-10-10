import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import { listMigrationFiles } from "../db/migrate.js";
import { notePglitePoolClosed, notePglitePoolOpened } from "./pglite-pool-tracker.js";

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../db/migrations",
);

let migrationSqlCache: Promise<Map<string, string>> | null = null;

async function migrationSqlById(): Promise<Map<string, string>> {
  if (!migrationSqlCache) {
    migrationSqlCache = (async () => {
      const ids = await listMigrationFiles();
      const map = new Map<string, string>();
      await Promise.all(
        ids.map(async (id) => {
          map.set(id, await readFile(path.join(migrationsDir, `${id}.sql`), "utf8"));
        }),
      );
      return map;
    })();
  }
  return migrationSqlCache;
}

async function runMigrationsOnPglite(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const sqlById = await migrationSqlById();
  for (const id of await listMigrationFiles()) {
    const existing = await db.query(
      "SELECT 1 FROM schema_migrations WHERE id = $1",
      [id],
    );
    if (existing.rowCount) continue;
    await db.exec(sqlById.get(id)!);
    await db.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
  }
}

export type MigratedPglitePgPool = {
  db: PGlite;
  pool: pg.Pool;
  /** Stops pool, socket server, and PGlite (call once per fixture). */
  close: () => Promise<void>;
};

/**
 * In-process Postgres via PGlite + TCP socket + real `pg` Pool (same driver as production).
 * PGlite serializes queries internally (see @electric-sql/pglite-socket); use `max: 1` on the pool
 * and a modest `maxConnections` on the socket server to avoid connection-queue timeouts in tests.
 */
export async function createMigratedPglitePool(): Promise<MigratedPglitePgPool> {
  const db = new PGlite();
  await runMigrationsOnPglite(db);

  const server = new PGLiteSocketServer({
    db,
    port: 0,
    host: "127.0.0.1",
    maxConnections: 4,
  });
  await server.start();
  const [, portStr] = server.getServerConn().split(":");
  const port = Number(portStr);
  if (!Number.isFinite(port)) {
    throw new Error(`PGLite socket server returned invalid conn: ${server.getServerConn()}`);
  }

  const pool = new pg.Pool({
    host: "127.0.0.1",
    port,
    database: "postgres",
    user: "postgres",
    password: "postgres",
    max: 1,
    connectionTimeoutMillis: 5_000,
  });

  notePglitePoolOpened();
  return {
    db,
    pool,
    close: async () => {
      try {
        await pool.end();
        await server.stop();
        await db.close();
      } finally {
        notePglitePoolClosed();
      }
    },
  };
}
