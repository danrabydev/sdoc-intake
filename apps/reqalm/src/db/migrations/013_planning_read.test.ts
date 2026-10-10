import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listMigrationFiles } from "../migrate.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const migrationSql = path.join(dir, "013_planning_read.sql");

async function through(db: PGlite, stop: string) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  for (const id of await listMigrationFiles()) {
    if (id > stop) break;
    if ((await db.query("SELECT 1 FROM schema_migrations WHERE id = $1", [id])).rowCount) continue;
    await db.exec(await readFile(path.join(dir, `${id}.sql`), "utf8"));
    await db.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
  }
}

async function basePlanningFixture(db: PGlite) {
  await through(db, "012_contracts_read");
  await db.exec(await readFile(migrationSql, "utf8"));
  await db.exec(`INSERT INTO clients (id, name) VALUES ('c1', 'C1');
    INSERT INTO projects (id, client_id, name) VALUES ('p1', 'c1', 'P1');
    INSERT INTO identities (id, external_sub, email, display_name) VALUES ('i1', 's', 'a@b.c', 'I');
    INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('L1', 'p1', 'requirement', 't');
    INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('L1', 'L1', 'p1', 0, 'active', 's');`);
  await db.query("INSERT INTO schema_migrations (id) VALUES ('013_planning_read') ON CONFLICT DO NOTHING");
}

describe("013_planning_read migration", () => {
  it("pins ON DELETE RESTRICT on project_id and opened_by FKs", async () => {
    const sql = await readFile(migrationSql, "utf8");
    assert.match(sql, /iterations[\s\S]*project_id TEXT NOT NULL REFERENCES projects\(id\) ON DELETE RESTRICT/);
    assert.match(sql, /change_sets[\s\S]*project_id TEXT NOT NULL REFERENCES projects\(id\) ON DELETE RESTRICT/);
    assert.match(sql, /change_sets[\s\S]*opened_by TEXT NOT NULL REFERENCES identities\(id\) ON DELETE RESTRICT/);
    assert.match(sql, /work_item_links[\s\S]*project_id TEXT NOT NULL REFERENCES projects\(id\) ON DELETE RESTRICT/);
  });

  it("iterations.project_id RESTRICTs when it is the only row referencing the project", async () => {
    const db = new PGlite();
    try {
      await basePlanningFixture(db);
      await db.exec(`INSERT INTO projects (id, client_id, name) VALUES ('p-iter-only', 'c1', 'Iter only');
        INSERT INTO iterations (id, project_id, name) VALUES ('it1', 'p-iter-only', 'I');`);
      await assert.rejects(
        () => db.exec(`DELETE FROM projects WHERE id = 'p-iter-only'`),
        /iterations_project_id_fkey|restrict/i,
      );
    } finally {
      await db.close();
    }
  });

  it("change_sets.project_id RESTRICTs when it is the only row referencing the project", async () => {
    const db = new PGlite();
    try {
      await basePlanningFixture(db);
      await db.exec(`INSERT INTO projects (id, client_id, name) VALUES ('p-cs-only', 'c1', 'CS only');
        INSERT INTO change_sets (id, project_id, kind, scope, status, opened_by, opened_at)
         VALUES ('cs1', 'p-cs-only', 'leaf', 'project', 'open', 'i1', '2026-01-01T00:00:00Z');`);
      await assert.rejects(
        () => db.exec(`DELETE FROM projects WHERE id = 'p-cs-only'`),
        /change_sets_project_id_fkey|restrict/i,
      );
    } finally {
      await db.close();
    }
  });

  it("change_sets.opened_by RESTRICTs when it is the only reference to the identity", async () => {
    const db = new PGlite();
    try {
      await basePlanningFixture(db);
      await db.exec(
        `INSERT INTO change_sets (id, project_id, kind, scope, status, opened_by, opened_at)
         VALUES ('cs1', 'p1', 'leaf', 'project', 'open', 'i1', '2026-01-01T00:00:00Z');`,
      );
      await assert.rejects(() => db.exec(`DELETE FROM identities WHERE id = 'i1'`), /restrict/i);
    } finally {
      await db.close();
    }
  });

  it("work_item_links.project_id RESTRICTs when it is the only row referencing the project", async () => {
    const db = new PGlite();
    try {
      await basePlanningFixture(db);
      await db.exec(`INSERT INTO projects (id, client_id, name) VALUES ('p-wil-only', 'c1', 'WIL shell');
        INSERT INTO work_item_links (id, project_id, requirement_version_uid, devops_id)
         VALUES ('wil1', 'p-wil-only', 'L1', 'ADO-1');`);
      await assert.rejects(
        () => db.exec(`DELETE FROM projects WHERE id = 'p-wil-only'`),
        /work_item_links_project_id_fkey|restrict/i,
      );
    } finally {
      await db.close();
    }
  });

  it("work_item_links FK RESTRICTs on requirement_versions delete", async () => {
    const db = new PGlite();
    try {
      await basePlanningFixture(db);
      await db.exec(
        `INSERT INTO work_item_links (id, project_id, requirement_version_uid, devops_id) VALUES ('wil1', 'p1', 'L1', 'ADO-1');`,
      );
      await assert.rejects(() => db.exec(`DELETE FROM requirement_versions WHERE uid = 'L1'`), /restrict/i);
    } finally {
      await db.close();
    }
  });
});
