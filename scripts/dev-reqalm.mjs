#!/usr/bin/env node
/**
 * Hybrid mode launcher (ARCH-DEVENV-MODES.1): peripherals in Compose, app native with hot reload.
 *
 * The dev OpenBao root token is generated on first peripherals start into the `reqaml-secrets`
 * volume (never committed, ARCH-DEVENV-KEYS). If OPENBAO_TOKEN is not set in the environment or
 * in .env, read it from the running peripherals container and pass it to the app process env only
 * (nothing is written to disk). Then run `pnpm --filter @reqalm/app dev` (tsx watch, loads ../../.env).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function envFileToken() {
  if (!existsSync(".env")) return "";
  const line = readFileSync(".env", "utf8")
    .split("\n")
    .find((l) => /^\s*OPENBAO_TOKEN\s*=/.test(l));
  return line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : "";
}

const env = { ...process.env };
if (!env.OPENBAO_TOKEN && !envFileToken()) {
  const r = spawnSync(
    "docker",
    ["compose", "exec", "-T", "peripherals", "cat", "/var/lib/reqalm/secrets/openbao-root.token"],
    { encoding: "utf8" },
  );
  const token = (r.stdout ?? "").trim();
  if (r.status === 0 && token) {
    env.OPENBAO_TOKEN = token;
    console.log("[dev:reqalm] Using dev OpenBao root token from the peripherals container.");
  } else {
    console.warn(
      "[dev:reqalm] Could not read the dev OpenBao token from the peripherals container " +
        "(is `docker compose up peripherals -d` running and healthy?).\n" +
        (r.error ? String(r.error) : (r.stderr ?? "").trim()),
    );
  }
}

const child = spawn("pnpm", ["--filter", "@reqalm/app", "dev"], { stdio: "inherit", env });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
