import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listMigrationFiles } from "../migrate.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

async function through(db: PGlite, stop: string) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  for (const id of await listMigrationFiles()) {
    if (id > stop) break;
    if ((await db.query("SELECT 1 FROM schema_migrations WHERE id = $1", [id])).rowCount) continue;
    await db.exec(await readFile(path.join(dir, `${id}.sql`), "utf8"));
    await db.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
  }
}

describe("011_trace_edges_inheritable migration", () => {
  it("defaults inheritable to false when the column is omitted on insert", async () => {
    const db = new PGlite();
    try {
      await through(db, "010_catalog_read");
      await db.exec(await readFile(path.join(dir, "011_trace_edges_inheritable.sql"), "utf8"));
      await db.exec(`
        INSERT INTO clients (id, name) VALUES ('c1', 'C1');
        INSERT INTO projects (id, client_id, name) VALUES ('p1', 'c1', 'P1');
        INSERT INTO trace_edges (
          from_project_id, from_uid, to_project_id, to_uid, kind, catalog_imprint_id, trace_suspect
        ) VALUES ('p1', 'CAP-A', NULL, 'AC-3', 'conforms_to', 'imp', false);
      `);
      const row = await db.query<{ inheritable: boolean }>(
        `SELECT inheritable FROM trace_edges WHERE from_uid = 'CAP-A'`,
      );
      assert.equal(row.rows[0]?.inheritable, false);
    } finally {
      await db.close();
    }
  });
});
