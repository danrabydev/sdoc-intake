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

describe("015_workflow_read migration", () => {
  it("workflow_role_bindings RESTRICTs when workflow_profiles is the only reference", async () => {
    const db = new PGlite();
    try {
      await through(db, "012_contracts_read");
      await db.exec(await readFile(path.join(dir, "015_workflow_read.sql"), "utf8"));
      await db.exec(`INSERT INTO clients (id, name) VALUES ('c1', 'C1');
        INSERT INTO projects (id, client_id, name) VALUES ('p1', 'c1', 'P1');
        INSERT INTO workflow_gates (id, mode, predicate, on_fail) VALUES ('gate-x', 'required', 'true', 'deny');
        INSERT INTO workflow_profiles (id, scope, client_id, project_id, title) VALUES ('wf-x', 'project', 'c1', 'p1', 't');
        INSERT INTO workflow_role_bindings (id, profile_id, gate_id, slot) VALUES ('rb-x', 'wf-x', 'gate-x', 'stakeholder');`);
      await db.query("INSERT INTO schema_migrations (id) VALUES ('015_workflow_read') ON CONFLICT DO NOTHING");
      await assert.rejects(() => db.exec(`DELETE FROM workflow_profiles WHERE id = 'wf-x'`), /restrict/i);
    } finally {
      await db.close();
    }
  });

  it("workflow_role_bindings RESTRICTs when workflow_gates is the only reference", async () => {
    const db = new PGlite();
    try {
      await through(db, "012_contracts_read");
      await db.exec(await readFile(path.join(dir, "015_workflow_read.sql"), "utf8"));
      await db.exec(`INSERT INTO clients (id, name) VALUES ('c1', 'C1');
        INSERT INTO projects (id, client_id, name) VALUES ('p1', 'c1', 'P1');
        INSERT INTO workflow_gates (id, mode, predicate, on_fail) VALUES ('gate-y', 'required', 'true', 'deny');
        INSERT INTO workflow_profiles (id, scope, client_id, project_id, title) VALUES ('wf-y', 'project', 'c1', 'p1', 't');
        INSERT INTO workflow_role_bindings (id, profile_id, gate_id, slot) VALUES ('rb-y', 'wf-y', 'gate-y', 'stakeholder');`);
      await db.query("INSERT INTO schema_migrations (id) VALUES ('015_workflow_read') ON CONFLICT DO NOTHING");
      await assert.rejects(() => db.exec(`DELETE FROM workflow_gates WHERE id = 'gate-y'`), /restrict/i);
    } finally {
      await db.close();
    }
  });

  it("workflow_approval_records RESTRICTs on requirement_lines delete", async () => {
    const db = new PGlite();
    try {
      await through(db, "012_contracts_read");
      await db.exec(await readFile(path.join(dir, "015_workflow_read.sql"), "utf8"));
      await db.exec(`INSERT INTO clients (id, name) VALUES ('c1', 'C1');
        INSERT INTO projects (id, client_id, name) VALUES ('p1', 'c1', 'P1');
        INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('L1', 'p1', 'requirement', 't');
        INSERT INTO workflow_approval_records (id, project_id, subject_kind, base_uid, status)
          VALUES ('ar-l1', 'p1', 'RequirementLine', 'L1', 'unapproved');`);
      await db.query("INSERT INTO schema_migrations (id) VALUES ('015_workflow_read') ON CONFLICT DO NOTHING");
      await assert.rejects(
        () => db.exec(`DELETE FROM requirement_lines WHERE project_id = 'p1' AND base_uid = 'L1'`),
        /restrict/i,
      );
    } finally {
      await db.close();
    }
  });

  it("workflow_gate_signoffs RESTRICTs on workflow_gates delete", async () => {
    const db = new PGlite();
    try {
      await through(db, "012_contracts_read");
      await db.exec(await readFile(path.join(dir, "015_workflow_read.sql"), "utf8"));
      await db.exec(`INSERT INTO clients (id, name) VALUES ('c1', 'C1');
        INSERT INTO identities (id, external_sub, email, display_name) VALUES ('i1', 's', 'a@b.c', 'I');
        INSERT INTO workflow_gates (id, mode, predicate, on_fail) VALUES ('gate-z', 'required', 'true', 'deny');
        INSERT INTO workflow_gate_signoffs (id, subject_kind, subject_id, gate_id, slot, identity_id, decision, signed_at)
          VALUES ('gso-z', 'Release', 'rel-1', 'gate-z', 'security_signoff', 'i1', 'approve', now());`);
      await db.query("INSERT INTO schema_migrations (id) VALUES ('015_workflow_read') ON CONFLICT DO NOTHING");
      await assert.rejects(() => db.exec(`DELETE FROM workflow_gates WHERE id = 'gate-z'`), /restrict/i);
    } finally {
      await db.close();
    }
  });
});
