#!/usr/bin/env node
/**
 * Mint a short-lived agent token via client_credentials (dev agent client).
 * Usage: pnpm devenv:agent-token --agent <name> --role <role> [--ttl 3600] [--acting-for identity-id]
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const agent = arg("--agent");
const role = arg("--role");
const ttl = Number(arg("--ttl") ?? 3600);
const actingFor = arg("--acting-for");
const baseUrl = process.env.REQAML_SMOKE_URL ?? "http://127.0.0.1:3000";

if (!agent || !role) {
  console.error("Usage: pnpm devenv:agent-token --agent <name> --role <role> [--ttl seconds] [--acting-for identity-id]");
  process.exit(1);
}

const env = {
  ...loadEnvFile(path.join(root, ".env")),
  ...loadEnvFile(path.join(root, ".reqaml/devenv.env")),
};

const clientSecret = env.REQAML_AGENT_CLIENT_SECRET;
if (!clientSecret) {
  console.error("Run pnpm devenv:init first (REQAML_AGENT_CLIENT_SECRET missing).");
  process.exit(1);
}

const resource = `${env.REQAML_ISSUER_URL ?? "http://localhost:3000"}/api`.replace("127.0.0.1", "localhost");

const body = new URLSearchParams({
  grant_type: "client_credentials",
  client_id: "reqaml-agent-dev",
  client_secret: clientSecret,
  agent_name: agent,
  resource,
  ttl_seconds: String(Math.min(ttl, 86400)),
});
if (actingFor) body.set("acting_for", actingFor);

const res = await fetch(`${baseUrl}/oauth/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});
const json = await res.json();
if (!res.ok) {
  console.error(JSON.stringify(json, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ agent, role, resource, acting_for: actingFor ?? null, ...json }, null, 2));
