#!/usr/bin/env node
/**
 * Dev MFA enrollment for a seeded identity. Runs the enroll CLI *inside* the app container, which
 * already has the database DSN and the dev OpenBao token; the host needs neither (works with the
 * default `docker compose up`, no hostports overlay).
 *
 * Usage:
 *   pnpm devenv:mfa <identity-id>                      # enroll with REQALM_MFA_DEV_SECRET (.reqalm/devenv.env)
 *   pnpm devenv:mfa <identity-id> --interactive        # print a fresh otpauth URI + ticket
 *   pnpm devenv:mfa <identity-id> --ticket=<id> --confirm=<6-digit-code>
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (!args[0] || args[0].startsWith("-")) {
  console.error("Usage: pnpm devenv:mfa <identity-id> [--interactive | --ticket=<id> --confirm=<code>] [--quiet]");
  process.exit(1);
}

const secretsFile = path.join(root, ".reqalm/devenv.env");
let devSecret = process.env.REQALM_MFA_DEV_SECRET;
if (!devSecret && existsSync(secretsFile)) {
  devSecret = /^REQALM_MFA_DEV_SECRET=(.*)$/m.exec(readFileSync(secretsFile, "utf8"))?.[1]?.trim();
}
const interactive = args.includes("--interactive") || args.some((a) => a.startsWith("--confirm="));
const passArgs = args.filter((a) => a !== "--interactive");

const execEnv = interactive || !devSecret ? [] : ["-e", "REQALM_MFA_DEV_SECRET"];
const r = spawnSync(
  "docker",
  ["compose", "exec", "-T", ...execEnv, "app", "node", "dist/cli/enroll-mfa.js", ...passArgs],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, REQALM_MFA_DEV_SECRET: devSecret ?? "" },
  },
);
process.exit(r.status ?? 1);
