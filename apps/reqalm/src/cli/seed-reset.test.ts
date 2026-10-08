import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(appRoot, "src/cli/seed-reset.ts");
const marker = path.join(mkdtempSync(path.join(tmpdir(), "reqalm-devenv-")), "devenv.env");
writeFileSync(marker, "# test devenv marker\n");

/** TEST-NET-3 (RFC 5737): never routable, so a connection attempt would hang, not succeed. */
const UNROUTABLE_URL = "postgres://reqalm:x@203.0.113.1:5432/reqalm";
const LOCAL_URL = "postgres://reqalm:x@127.0.0.1:5432/reqalm";

function runCli(args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
    cwd: appRoot,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const devenv = { REQALM_MODE: "development", REQALM_DEVENV_ENV_FILE: marker };

describe("devenv:seed:reset CLI refuses before connecting", () => {
  const cases: Array<[string, string[], Record<string, string>, RegExp]> = [
    ["no --confirm or --dry-run", [], { ...devenv, DATABASE_URL: LOCAL_URL }, /pass --dry-run/],
    ["unknown argument", ["--confrim"], { ...devenv, DATABASE_URL: LOCAL_URL }, /unknown argument/],
    ["typo'd REQALM_MODE", ["--confirm"], { ...devenv, REQALM_MODE: "developmnet", DATABASE_URL: LOCAL_URL }, /REQALM_MODE must be exactly/],
    ["--dry-run against a non-local host", ["--dry-run"], { ...devenv, DATABASE_URL: UNROUTABLE_URL }, /got host 203\.0\.113\.1/],
    ["--dry-run with a ?host= override", ["--dry-run"], { ...devenv, DATABASE_URL: `${LOCAL_URL}?host=203.0.113.1` }, /got host 203\.0\.113\.1/],
    [
      "REQALM_SEED_RESET_TEST_HARNESS with a non-local host",
      ["--confirm"],
      { ...devenv, REQALM_SEED_RESET_TEST_HARNESS: "pglite", DATABASE_URL: UNROUTABLE_URL },
      /got host 203\.0\.113\.1/,
    ],
  ];
  for (const [name, args, env, message] of cases) {
    it(name, () => {
      const r = runCli(args, env);
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /^Refusing dogfood seed reset/m);
      assert.match(r.out, message);
    });
  }
});
