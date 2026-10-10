#!/usr/bin/env node
/**
 * Cross-platform test runner wrapper (LF-safe; works on Windows via `node scripts/run-tests.mjs`).
 * Adds a per-test timeout so a hung PGlite/pool test fails fast instead of blocking CI/agents.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const timeoutMs = process.env.REQALM_TEST_TIMEOUT_MS ?? "120000";
const patterns = process.argv.slice(2);
const testTargets = patterns.length > 0 ? patterns : ["src/**/*.test.ts"];

const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--import",
    "./src/test/otel-preload.ts",
    "--test",
    `--test-timeout=${timeoutMs}`,
    ...testTargets,
  ],
  { cwd: appRoot, stdio: "inherit", env: process.env },
);

process.exit(result.status ?? 1);
