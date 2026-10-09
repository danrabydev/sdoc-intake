import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listMigrationFiles } from "../migrate.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
async function through(db: PGlite, stop: string) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  for (const id of await listMigrationFiles()) {
    if (id > stop) break;
    if ((await db.query("SELECT 1 FROM schema_migrations WHERE id = $1", [id])).rowCount) continue;
    await db.exec(await readFile(path.join(dir, `${id}.sql`), "utf8"));
    await db.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
  }
}

describe("010_catalog_read migration", () => {
  it("nulls orphan private catalog project_id and validates FK (from 009 baseline)", async () => {
    const db = new PGlite();
    try {
      await through(db, "009_trace_edges");
      await db.exec(`INSERT INTO clients (id, name) VALUES ('c1', 'C1'); INSERT INTO projects (id, client_id, name) VALUES ('p1', 'c1', 'P1')`);
      await db.exec(`INSERT INTO catalog_defs (id, is_standard, project_id) VALUES ('cat-orphan-mig', false, 'ghost-project')`);
      await db.exec(await readFile(path.join(dir, "010_catalog_read.sql"), "utf8"));
      await db.query("INSERT INTO schema_migrations (id) VALUES ('010_catalog_read') ON CONFLICT DO NOTHING");
      const row = await db.query<{ is_standard: boolean; project_id: string | null }>(`SELECT is_standard, project_id FROM catalog_defs WHERE id = 'cat-orphan-mig'`);
      assert.equal(row.rows[0]?.is_standard, false);
      assert.equal(row.rows[0]?.project_id, null);
      await assert.rejects(() => db.exec(`INSERT INTO catalog_defs (id, is_standard, project_id) VALUES ('cat-bad-fk', false, 'no-project')`), /catalog_defs_project_id_fkey/i);
    } finally {
      await db.close();
    }
  });
});
