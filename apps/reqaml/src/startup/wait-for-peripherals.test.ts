import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { loadConfig } from "../config.js";

test("waitForPeripherals times out when database never ready", async () => {
  const { waitForPeripherals } = await import("./wait-for-peripherals.js");
  const config = loadConfig({
    DATABASE_URL: "postgresql://u:p@localhost/db",
    REQAML_STARTUP_MAX_WAIT_MS: "50",
    REQAML_STARTUP_INITIAL_DELAY_MS: "1",
  });
  const pool = {
    query: async () => {
      throw new Error("down");
    },
  } as unknown as pg.Pool;

  await assert.rejects(
    () => waitForPeripherals(config, pool),
    /Timed out.*database/i,
  );
});

test("waitForPeripherals does not wait on a dev-marked OpenBao in production", async () => {
  const { waitForPeripherals } = await import("./wait-for-peripherals.js");
  const config = loadConfig({
    DATABASE_URL: "postgresql://u:p@localhost/db",
    REQAML_MODE: "production",
    OPENBAO_ADDR: "http://peripherals:8200",
    OPENBAO_TOKEN: "dev-root",
    REQAML_STARTUP_MAX_WAIT_MS: "60000",
    REQAML_STARTUP_INITIAL_DELAY_MS: "1",
  });
  const pool = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
  const started = Date.now();
  await waitForPeripherals(config, pool);
  assert.ok(Date.now() - started < 1000, "policy refusal must be left to the startup self-check");
});
