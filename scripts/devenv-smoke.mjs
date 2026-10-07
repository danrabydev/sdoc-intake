#!/usr/bin/env node
/**
 * FIX-ALLOW-DEVENV-SMOKE — clone-to-running smoke (Compose full-container mode).
 *
 * Primary check for the ReqAML dev environment; run locally with `pnpm devenv:smoke`
 * (the GitHub workflow is manual-dispatch only to save Actions minutes).
 *
 * Covers: Compose services healthy (ARCH-DEVENV-HEALTH), /health + /ready + seed summary
 * (FIX-ALLOW-DEVENV-SMOKE), migrate/seed idempotency (FIX-ALLOW-DEVENV-SEED-IDEMPOTENT),
 * exactly 2 containers (FIX-ALLOW-DEVENV-MIN-CONTAINERS), and production-mode refusal of the
 * dev seed loader / dev accounts / dev OpenBao (FIX-DENY-DEVENV-PROD-LOGIN.1, FIX-DENY-DEV-KEK-IN-PROD).
 *
 * Every failing command has its stdout/stderr printed, followed by `docker compose ps -a` and
 * recent `docker compose logs`, so CI/local failures are diagnosable from the log alone.
 *
 * Env: REQAML_SMOKE_URL (default http://127.0.0.1:3000), DATABASE_URL (host DSN),
 *      REQAML_SMOKE_DOWN=1 to run `docker compose down -v` at the end.
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";

const baseUrl = process.env.REQAML_SMOKE_URL ?? "http://127.0.0.1:3000";
const hostDsn =
  process.env.DATABASE_URL ?? "postgresql://reqaml:reqaml@127.0.0.1:5432/reqaml";

class CommandError extends Error {
  constructor(label, result) {
    super(`Command failed (exit ${result.code}): ${label}`);
    this.result = result;
  }
}

/** Run a command, streaming output live (unless quiet) and capturing it for failure reports. */
function run(cmd, args, { env, quiet = false, allowFail = false } = {}) {
  const label = [cmd, ...args].join(" ");
  if (!quiet) console.log(`\n$ ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      if (!quiet) process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (!quiet) process.stderr.write(d);
    });
    child.on("error", (err) => {
      const result = { code: -1, stdout, stderr: stderr + String(err) };
      allowFail ? resolve(result) : reject(new CommandError(label, result));
    });
    child.on("close", (code) => {
      const result = { code, stdout, stderr };
      if (code !== 0 && !allowFail) reject(new CommandError(label, result));
      else resolve(result);
    });
  });
}

function fail(message, detail) {
  const err = new Error(message);
  err.detail = detail;
  throw err;
}

async function getJson(path) {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function reportFailure(err) {
  console.error(`\n✗ devenv smoke FAILED: ${err.message}`);
  if (err.detail !== undefined) {
    console.error(typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail, null, 2));
  }
  if (err.result) {
    console.error("----- command stdout -----");
    console.error(err.result.stdout.trimEnd() || "(empty)");
    console.error("----- command stderr -----");
    console.error(err.result.stderr.trimEnd() || "(empty)");
  }
  if (!(err instanceof CommandError) && !err.detail) console.error(err.stack);
  for (const args of [
    ["compose", "ps", "-a"],
    ["compose", "logs", "--no-color", "--tail=150"],
  ]) {
    const r = await run("docker", args, { quiet: true, allowFail: true });
    console.error(`----- docker ${args.join(" ")} (exit ${r.code}) -----`);
    console.error((r.stdout + r.stderr).trimEnd());
  }
}

function lastJsonObject(text) {
  const start = text.lastIndexOf("\n{");
  return JSON.parse(text.slice(start === -1 ? text.indexOf("{") : start + 1));
}

async function main() {
  if (!existsSync(".env")) {
    console.log("No .env found; copying .env.example (README clone-to-running step).");
    copyFileSync(".env.example", ".env");
  }

  console.log("Starting peripherals + app (full-container)…");
  // --wait blocks until every service is healthy and exits non-zero if any becomes unhealthy/exits.
  await run("docker", ["compose", "up", "--build", "-d", "--wait", "--wait-timeout", "300"]);

  const health = await getJson("/health");
  if (health.status !== 200 || health.body.status !== "ok") fail("/health not ok", health);
  const ready = await getJson("/ready");
  if (ready.status !== 200 || ready.body.ready !== true) fail("/ready not ready", ready);

  const summary1 = (await getJson("/api/v1/seed/summary")).body;
  if (
    !summary1.identities ||
    summary1.sample_identity_id !== "taylor-tester" ||
    !summary1.capabilities ||
    !summary1.release_count
  ) {
    fail("Seed summary unexpected", summary1);
  }

  console.log("\nRe-running migrate + seed (idempotency)…");
  const env = { DATABASE_URL: hostDsn };
  for (let i = 0; i < 2; i++) {
    const m = await run("pnpm", ["--silent", "reqaml:migrate"], { env });
    if (!/Migrations up to date/.test(m.stdout)) fail("Migration re-run applied changes", m.stdout);
    const s = await run("pnpm", ["--silent", "reqaml:seed"], { env });
    const seedResult = lastJsonObject(s.stdout);
    const nonZero = Object.entries(seedResult.inserted).filter(([, n]) => n !== 0);
    if (nonZero.length || !seedResult.unchanged) fail("Seed re-run inserted rows", seedResult);
  }

  const summary2 = (await getJson("/api/v1/seed/summary")).body;
  for (const key of [
    "identities",
    "project_grants",
    "requirement_lines",
    "requirement_versions",
    "capabilities",
    "release_count",
    "release_delivers",
  ]) {
    if (summary1[key] !== summary2[key]) {
      fail(`Count drift for ${key}: ${summary1[key]} -> ${summary2[key]}`);
    }
  }

  // FIX-ALLOW-DEVENV-MIN-CONTAINERS: count *all* project containers, not just the expected names.
  const psOut = (await run("docker", ["compose", "ps", "-a", "--format", "json"], { quiet: true })).stdout;
  const containers = psOut
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const parsed = JSON.parse(line);
      return Array.isArray(parsed) ? parsed : [parsed];
    });
  const services = containers.map((c) => c.Service).sort();
  const healthy = containers.every((c) => c.State === "running" && c.Health === "healthy");
  if (containers.length !== 2 || services.join(",") !== "app,peripherals" || !healthy) {
    fail("Expected exactly 2 healthy containers (app + peripherals)", containers);
  }

  console.log("\nProduction mode must refuse dev seed loader, dev accounts and dev OpenBao…");
  const prodSeed = await run("pnpm", ["--silent", "reqaml:seed"], {
    env: { ...env, REQAML_MODE: "production" },
    quiet: true,
    allowFail: true,
  });
  if (prodSeed.code === 0 || !/Refusing to load dogfood seed in production/.test(prodSeed.stderr + prodSeed.stdout)) {
    fail("Seed loader was not refused in production mode", prodSeed);
  }
  const prodApp = await run(
    "docker",
    [
      "compose", "run", "--rm", "--no-deps", "-T",
      "-e", "REQAML_MODE=production",
      "-e", "REQAML_SEED_ON_START=false",
      "-e", "REQAML_DEV_ACCOUNT_PASSWORD=",
      "app",
    ],
    { quiet: true, allowFail: true },
  );
  const prodOut = prodApp.stdout + prodApp.stderr;
  if (
    prodApp.code === 0 ||
    !/Startup self-check failed/.test(prodOut) ||
    !/Seeded dev local accounts exist/.test(prodOut) ||
    !/Dev-marked (OpenBao|Transit)[^\n]*refused in production/.test(prodOut)
  ) {
    fail("App started (or failed for the wrong reason) in production mode with dev accounts/keys", prodApp);
  }

  console.log(
    "\n" +
      JSON.stringify(
        {
          ok: true,
          health: health.body,
          ready_roles: ready.body.roles,
          seed: summary2,
          containers: services,
          production_refused: true,
        },
        null,
        2,
      ),
  );

  if (process.env.REQAML_SMOKE_DOWN === "1") {
    await run("docker", ["compose", "down", "-v"]);
  }
}

main().catch(async (err) => {
  await reportFailure(err);
  process.exit(1);
});
