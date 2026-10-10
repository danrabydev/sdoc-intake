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

describe("013_planning_read migration", () => {
  it("work_item_links FK RESTRICTs on requirement_versions delete", async () => {
    const db = new PGlite();
    try {
      await through(db, "012_contracts_read");
      await db.exec(await readFile(path.join(dir, "013_planning_read.sql"), "utf8"));
      await db.exec(`INSERT INTO clients (id, name) VALUES ('c1', 'C1');
        INSERT INTO projects (id, client_id, name) VALUES ('p1', 'c1', 'P1');
        INSERT INTO identities (id, external_sub, email, display_name) VALUES ('i1', 's', 'a@b.c', 'I');
        INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('L1', 'p1', 'requirement', 't');
        INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('L1', 'L1', 'p1', 0, 'active', 's');
        INSERT INTO work_item_links (id, project_id, requirement_version_uid, devops_id) VALUES ('wil1', 'p1', 'L1', 'ADO-1');`);
      await db.query("INSERT INTO schema_migrations (id) VALUES ('013_planning_read') ON CONFLICT DO NOTHING");
      await assert.rejects(() => db.exec(`DELETE FROM requirement_versions WHERE uid = 'L1'`), /restrict/i);
    } finally {
      await db.close();
    }
  });
});
