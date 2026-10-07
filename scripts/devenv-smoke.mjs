#!/usr/bin/env node
/**
 * FIX-ALLOW-DEVENV-SMOKE — clone-to-running smoke (Compose full-container mode).
 */
import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const baseUrl = process.env.REQAML_SMOKE_URL ?? "http://127.0.0.1:3000";

function sh(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

function curlJson(path) {
  const out = execSync(`curl -sf ${baseUrl}${path}`, { encoding: "utf8" });
  return JSON.parse(out);
}

console.log("Starting peripherals + app (full-container)…");
sh("docker compose up --build -d");

for (let i = 0; i < 60; i++) {
  try {
    const h = curlJson("/health");
    if (h.status === "ok") break;
  } catch {
    await sleep(3000);
  }
}

const health = curlJson("/health");
const ready = curlJson("/ready");
if (!ready.ready) {
  console.error("Readiness failed:", ready);
  process.exit(1);
}

const summary1 = curlJson("/api/v1/seed/summary");
if (!summary1.identities || summary1.sample_identity_id !== "taylor-tester") {
  console.error("Seed summary unexpected:", summary1);
  process.exit(1);
}

console.log("Re-running migrate + seed (idempotency)…");
const dsn =
  process.env.DATABASE_URL ??
  "postgresql://reqaml:reqaml@127.0.0.1:5432/reqaml";
sh("pnpm reqaml:seed", { env: { ...process.env, DATABASE_URL: dsn } });
sh("pnpm reqaml:seed", { env: { ...process.env, DATABASE_URL: dsn } });

const summary2 = curlJson("/api/v1/seed/summary");
for (const key of [
  "identities",
  "project_grants",
  "requirement_lines",
  "requirement_versions",
]) {
  if (summary1[key] !== summary2[key]) {
    console.error(`Count drift for ${key}: ${summary1[key]} -> ${summary2[key]}`);
    process.exit(1);
  }
}

const ps = execSync("docker compose ps --status running --format json", {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const running = ps.filter((s) => s.Service === "app" || s.Service === "peripherals");
if (running.length !== 2) {
  console.error("Expected 2 running containers (app + peripherals), got:", running);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      health,
      ready_roles: ready.roles,
      seed: summary2,
      containers: running.map((s) => s.Service),
    },
    null,
    2,
  ),
);
