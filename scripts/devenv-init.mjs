#!/usr/bin/env node
/**
 * Idempotent local dev setup: random secrets in .reqaml/devenv.env + root .env for Compose.
 * Usage: pnpm devenv:init [--rotate]
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const secretsDir = path.join(root, ".reqaml");
const secretsFile = path.join(secretsDir, "devenv.env");
const envFile = path.join(root, ".env");
const exampleFile = path.join(root, ".env.example");
const rotate = process.argv.includes("--rotate");

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function serializeEnv(map) {
  return `${Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`;
}

function secret(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

function base32Secret(chars = 32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return Array.from(randomBytes(chars), (b) => alphabet[b & 31]).join("");
}

let created = false;

function loadOrCreateSecrets() {
  mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  let cur = {};
  if (existsSync(secretsFile) && !rotate) {
    cur = parseEnv(readFileSync(secretsFile, "utf8"));
  }
  const needed = {
    POSTGRES_PASSWORD: cur.POSTGRES_PASSWORD ?? secret(18),
    REQAML_DEV_ACCOUNT_PASSWORD: cur.REQAML_DEV_ACCOUNT_PASSWORD ?? secret(18),
    REQAML_AGENT_CLIENT_SECRET: cur.REQAML_AGENT_CLIENT_SECRET ?? secret(24),
    REQAML_SESSION_SECRET: cur.REQAML_SESSION_SECRET ?? secret(32),
    REQAML_CSRF_SECRET: cur.REQAML_CSRF_SECRET ?? secret(16),
    REQAML_MFA_DEV_SECRET: cur.REQAML_MFA_DEV_SECRET ?? base32Secret(32),
  };
  const text = serializeEnv(needed);
  created = !existsSync(secretsFile) || readFileSync(secretsFile, "utf8") !== text;
  writeFileSync(secretsFile, text, { mode: 0o600 });
  chmodSync(secretsFile, 0o600);
  return needed;
}

function mergeRootEnv(secrets) {
  const base = existsSync(envFile)
    ? readFileSync(envFile, "utf8")
    : existsSync(exampleFile)
      ? readFileSync(exampleFile, "utf8")
      : "";
  const map = parseEnv(base);
  map.REQAML_MODE = map.REQAML_MODE ?? "development";
  map.POSTGRES_USER = map.POSTGRES_USER ?? "reqaml";
  map.POSTGRES_DB = map.POSTGRES_DB ?? "reqaml";
  map.POSTGRES_PASSWORD = secrets.POSTGRES_PASSWORD;
  map.REQAML_DEV_ACCOUNT_PASSWORD = secrets.REQAML_DEV_ACCOUNT_PASSWORD;
  map.REQAML_AGENT_CLIENT_SECRET = secrets.REQAML_AGENT_CLIENT_SECRET;
  map.REQAML_SESSION_SECRET = secrets.REQAML_SESSION_SECRET;
  map.REQAML_CSRF_SECRET = secrets.REQAML_CSRF_SECRET;
  map.REQAML_AUTH_IDENTITY_MODE = map.REQAML_AUTH_IDENTITY_MODE ?? "hybrid";
  map.REQAML_AUTH_LOCAL_ACCOUNTS = map.REQAML_AUTH_LOCAL_ACCOUNTS ?? "enabled";
  map.REQAML_ISSUER_URL = map.REQAML_ISSUER_URL ?? "http://localhost:3000";
  map.DATABASE_URL = `postgresql://${map.POSTGRES_USER}:${secrets.POSTGRES_PASSWORD}@127.0.0.1:5432/${map.POSTGRES_DB}`;
  map.OPENBAO_ADDR = map.OPENBAO_ADDR ?? "http://127.0.0.1:8200";
  map.REQAML_HOST_BIND = map.REQAML_HOST_BIND ?? "127.0.0.1";
  writeFileSync(envFile, serializeEnv(map), { mode: 0o600 });
  chmodSync(envFile, 0o600);
}

function main() {
  const secrets = loadOrCreateSecrets();
  mergeRootEnv(secrets);
  if (!process.env.DEVENV_INIT_QUIET) {
    console.log("ReqAML devenv initialized (.reqaml/devenv.env + .env updated).");
    if (created) {
      // Print new secrets once; later runs only point at the gitignored file.
      console.log("New secrets (also in .reqaml/devenv.env — gitignored):");
      for (const [k, v] of Object.entries(secrets)) {
        console.log(`  ${k}=${v}`);
      }
    } else {
      console.log("Secrets unchanged; see .reqaml/devenv.env (gitignored).");
    }
    if (rotate) {
      console.log(
        "\n--rotate changed POSTGRES_PASSWORD: an existing Postgres volume keeps the old one. Reset dev data with\n  docker compose down -v && docker compose up --build -d --wait",
      );
    }
    console.log("\nNext steps:");
    console.log("  1. docker compose up --build");
    console.log("  2. Open http://127.0.0.1:3000/login (or http://localhost:3000/login)");
    console.log("  3. Privileged dev users: pnpm devenv:mfa <identity-id>  (e.g. sam-security)");
    console.log("  4. Coding agents: pnpm devenv:agent-token --agent cursor-cloud --role Author   (default Reader)");
    console.log(
      "\nHybrid mode (host Postgres/OpenBao ports): docker compose -f docker-compose.yml -f docker-compose.hostports.yml up peripherals -d",
    );
  }
}

main();
