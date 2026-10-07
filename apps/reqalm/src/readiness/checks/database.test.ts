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

test("checkDatabase times out on a hung database", async () => {
  const pool = {
    query: () => new Promise(() => {}),
  } as unknown as pg.Pool;

  const result = await checkDatabase(pool, 20);
  assert.equal(result.ok, false);
  assert.match(result.detail ?? "", /timed out/);
});
