#!/usr/bin/env node
/**
 * FIX-ALLOW-DEVENV-SMOKE — clone-to-running smoke (Compose full-container mode).
 *
 * Primary check for the ReqAML dev environment; run locally with `pnpm devenv:smoke`
 * (the GitHub workflow is manual-dispatch only to save Actions minutes).
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.REQAML_SMOKE_URL ?? "http://127.0.0.1:3000";

const composeBase = ["-f", "docker-compose.yml", "-f", "docker-compose.hostports.yml"];

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function loadMergedEnv() {
  const files = [path.join(root, ".env"), path.join(root, ".reqaml/devenv.env")];
  const merged = {};
  for (const f of files) {
    if (existsSync(f)) Object.assign(merged, parseEnv(readFileSync(f, "utf8")));
  }
  return merged;
}

class CommandError extends Error {
  constructor(label, result) {
    super(`Command failed (exit ${result.code}): ${label}`);
    this.result = result;
  }
}

function run(cmd, args, { env, cwd = root, quiet = false, allowFail = false } = {}) {
  const label = [cmd, ...args].join(" ");
  if (!quiet) console.log(`\n$ ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
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
    [...composeBase, "ps", "-a"],
    [...composeBase, "logs", "--no-color", "--tail=150"],
  ]) {
    const r = await run("docker", ["compose", ...args], { quiet: true, allowFail: true });
    console.error(`----- docker compose ${args.join(" ")} (exit ${r.code}) -----`);
    console.error((r.stdout + r.stderr).trimEnd());
  }
}

function lastJsonObject(text) {
  const start = text.lastIndexOf("\n{");
  return JSON.parse(text.slice(start === -1 ? text.indexOf("{") : start + 1));
}

async function main() {
  process.env.DEVENV_INIT_QUIET = "1";
  await run("node", ["scripts/devenv-init.mjs"], { quiet: true });
  const secrets = loadMergedEnv();
  const smokePassword = secrets.REQAML_DEV_ACCOUNT_PASSWORD;
  if (!smokePassword) fail("REQAML_DEV_ACCOUNT_PASSWORD missing after devenv:init");
  process.env.REQAML_DEV_ACCOUNT_PASSWORD = smokePassword;
  process.env.REQAML_MFA_DEV_SECRET = secrets.REQAML_MFA_DEV_SECRET;
  process.env.REQAML_AGENT_CLIENT_SECRET = secrets.REQAML_AGENT_CLIENT_SECRET;

  const hostDsn =
    secrets.DATABASE_URL ??
    `postgresql://${secrets.POSTGRES_USER ?? "reqaml"}:${secrets.POSTGRES_PASSWORD}@127.0.0.1:5432/${secrets.POSTGRES_DB ?? "reqaml"}`;

  console.log("Starting peripherals + app (full-container, hostports for migrate)…");
  await run("docker", [
    "compose",
    ...composeBase,
    "up",
    "--build",
    "-d",
    "--wait",
    "--wait-timeout",
    "300",
  ]);

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

  console.log("\nEnrolling privileged dev MFA (sam-security) for smoke…");
  await run("pnpm", ["--silent", "devenv:mfa", "sam-security", "--quiet"], {
    env: { ...secrets, DATABASE_URL: hostDsn },
  });

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

  const psOut = (
    await run("docker", ["compose", ...composeBase, "ps", "-a", "--format", "json"], { quiet: true })
  ).stdout;
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
      "compose",
      ...composeBase,
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "-e",
      "REQAML_MODE=production",
      "-e",
      "REQAML_SEED_ON_START=false",
      "-e",
      "REQAML_DEV_ACCOUNT_PASSWORD=",
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

  console.log("\nAuth flow smoke (PKCE login, refresh/reuse, revoke, lockout, RBAC deny, MFA, agent token)…");
  const { runAuthFlowSmoke } = await import("./auth-flow-smoke.mjs");
  const authSmoke = await runAuthFlowSmoke(smokePassword, {
    mfaDevSecret: secrets.REQAML_MFA_DEV_SECRET,
    agentClientSecret: secrets.REQAML_AGENT_CLIENT_SECRET,
  });
  if (!authSmoke.privileged_mfa_login) fail("privileged MFA login did not run");
  if (!authSmoke.agent_client_credentials) fail("agent client_credentials did not run");

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
          auth_smoke: authSmoke,
        },
        null,
        2,
      ),
  );

  if (process.env.REQAML_SMOKE_DOWN === "1") {
    await run("docker", ["compose", ...composeBase, "down", "-v"]);
  }
}

main().catch(async (err) => {
  await reportFailure(err);
  process.exit(1);
});
