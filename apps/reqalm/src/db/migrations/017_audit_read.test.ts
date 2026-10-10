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

describe("017_audit_read migration", () => {
  it("adds audit read indexes", async () => {
    const db = new PGlite();
    try {
      await through(db, "012_contracts_read");
      await db.exec(await readFile(path.join(dir, "017_audit_read.sql"), "utf8"));
      const idx = await db.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_audit_events_project_%' OR indexname = 'idx_auth_audit_identity_occurred'`,
      );
      assert.ok(idx.rows.some((r) => r.indexname === "idx_audit_events_project_operation"));
      assert.ok(idx.rows.some((r) => r.indexname === "idx_audit_events_project_target"));
      assert.ok(idx.rows.some((r) => r.indexname === "idx_auth_audit_identity_occurred"));
    } finally {
      await db.close();
    }
  });
});
