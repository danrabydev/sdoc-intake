import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { checkDatabase } from "./database.js";

test("checkDatabase surfaces query errors", async () => {
  const pool = {
    query: async () => {
      throw new Error("connection refused");
    },
  } as unknown as pg.Pool;

  const result = await checkDatabase(pool);
  assert.equal(result.ok, false);
  assert.match(result.detail ?? "", /connection refused/);
});
