import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listMigrationFiles } from "../migrate.js";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)));

async function migrateThrough(db: PGlite, throughId: string): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  for (const id of await listMigrationFiles()) {
    if (id > throughId) break;
    const existing = await db.query("SELECT 1 FROM schema_migrations WHERE id = $1", [id]);
    if (existing.rowCount) continue;
    const sql = await readFile(path.join(migrationsDir, `${id}.sql`), "utf8");
    await db.exec(sql);
    await db.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
  }
}

describe("010_catalog_read migration", () => {
  it("nulls orphan private catalog project_id and validates FK (from 009 baseline)", async () => {
    const db = new PGlite();
    try {
      await migrateThrough(db, "009_trace_edges");
      await db.exec(`INSERT INTO clients (id, name) VALUES ('c1', 'C1') ON CONFLICT DO NOTHING`);
      await db.exec(`INSERT INTO projects (id, client_id, name) VALUES ('p1', 'c1', 'P1') ON CONFLICT DO NOTHING`);
      await db.exec(
        `INSERT INTO catalog_defs (id, is_standard, project_id) VALUES ('cat-orphan-mig', false, 'ghost-project')`,
      );
      const sql010 = await readFile(path.join(migrationsDir, "010_catalog_read.sql"), "utf8");
      await db.exec(sql010);
      await db.query("INSERT INTO schema_migrations (id) VALUES ('010_catalog_read') ON CONFLICT DO NOTHING");
      const row = await db.query<{ is_standard: boolean; project_id: string | null }>(
        `SELECT is_standard, project_id FROM catalog_defs WHERE id = 'cat-orphan-mig'`,
      );
      assert.equal(row.rows[0]?.is_standard, false);
      assert.equal(row.rows[0]?.project_id, null);
      await assert.rejects(
        () =>
          db.exec(
            `INSERT INTO catalog_defs (id, is_standard, project_id) VALUES ('cat-bad-fk', false, 'no-project')`,
          ),
        /violates foreign key constraint|catalog_defs_project_id_fkey/i,
      );
    } finally {
      await db.close();
    }
  });
});
