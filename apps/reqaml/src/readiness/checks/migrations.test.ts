import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { checkMigrationsCurrent } from "./migrations.js";

test("checkMigrationsCurrent fails when pending migrations exist", async () => {
  const pool = {
    connect: async () => ({
      query: async (sql: string) => {
        if (sql.includes("CREATE TABLE")) return { rows: [], rowCount: 0 };
        if (sql.includes("SELECT id FROM schema_migrations")) {
          return { rows: [] };
        }
        throw new Error(sql);
      },
      release: () => {},
    }),
  } as unknown as pg.Pool;

  const result = await checkMigrationsCurrent(pool);
  assert.equal(result.ok, false);
  assert.match(result.detail ?? "", /Pending migrations/);
});
