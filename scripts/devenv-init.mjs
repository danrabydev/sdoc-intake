#!/usr/bin/env node
/**
 * Idempotent local dev setup: random secrets in .reqalm/devenv.env + root .env for Compose.
 * Usage: pnpm devenv:init [--rotate]
 */
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const secretsDir = path.join(root, ".reqalm");
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
const legacySecretsDir = path.join(root, ".reqaml");
const legacySecretsFile = path.join(legacySecretsDir, "devenv.env");

/** @type {string[]} */
const legacyEnvKeyMigrations = [];

const LEGACY_SECRET_KEYS = [
  ["REQAML_DEV_ACCOUNT_PASSWORD", "REQALM_DEV_ACCOUNT_PASSWORD"],
  ["REQAML_AGENT_CLIENT_SECRET", "REQALM_AGENT_CLIENT_SECRET"],
  ["REQAML_SESSION_SECRET", "REQALM_SESSION_SECRET"],
  ["REQAML_CSRF_SECRET", "REQALM_CSRF_SECRET"],
  ["REQAML_MFA_DEV_SECRET", "REQALM_MFA_DEV_SECRET"],
];


function migrateLegacySecretKeys(map) {
  for (const [oldKey, newKey] of LEGACY_SECRET_KEYS) {
    if (map[newKey] === undefined && map[oldKey] !== undefined) {
      map[newKey] = map[oldKey];
      delete map[oldKey];
      legacyEnvKeyMigrations.push(`${oldKey} → ${newKey} (devenv.env)`);
    }
  }
}

function migrateLegacyRootEnv(map) {
  // Every REQAML_* key moves to REQALM_* with its value unchanged. POSTGRES_USER / POSTGRES_DB are
  // left alone: an existing Postgres volume keeps the role and database it was created with.
  for (const oldKey of Object.keys(map)) {
    if (!oldKey.startsWith("REQAML_")) continue;
    const newKey = `REQALM_${oldKey.slice("REQAML_".length)}`;
    if (map[newKey] === undefined) {
      map[newKey] = map[oldKey];
      legacyEnvKeyMigrations.push(`${oldKey} → ${newKey} (.env)`);
    }
    delete map[oldKey];
  }
}

function migrateLegacySecretsLayout() {
  if (!existsSync(secretsFile) && existsSync(legacySecretsFile)) {
    mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
    renameSync(legacySecretsFile, secretsFile);
    legacyEnvKeyMigrations.push(".reqaml/devenv.env → .reqalm/devenv.env (renamed)");
    try {
      rmdirSync(legacySecretsDir); // only succeeds when the legacy dir is now empty
    } catch {
      // Non-empty legacy dir: keep it; secrets now live under .reqalm.
    }
  }
}

function loadOrCreateSecrets() {
  migrateLegacySecretsLayout();
  mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  let cur = {};
  if (existsSync(secretsFile) && !rotate) {
    cur = parseEnv(readFileSync(secretsFile, "utf8"));
    migrateLegacySecretKeys(cur);
  } else if (existsSync(legacySecretsFile) && !rotate) {
    cur = parseEnv(readFileSync(legacySecretsFile, "utf8"));
    migrateLegacySecretKeys(cur);
  }
  const needed = {
    POSTGRES_PASSWORD: cur.POSTGRES_PASSWORD ?? secret(18),
    REQALM_DEV_ACCOUNT_PASSWORD: cur.REQALM_DEV_ACCOUNT_PASSWORD ?? secret(18),
    REQALM_AGENT_CLIENT_SECRET: cur.REQALM_AGENT_CLIENT_SECRET ?? secret(24),
    REQALM_SESSION_SECRET: cur.REQALM_SESSION_SECRET ?? secret(32),
    REQALM_CSRF_SECRET: cur.REQALM_CSRF_SECRET ?? secret(16),
    REQALM_MFA_DEV_SECRET: cur.REQALM_MFA_DEV_SECRET ?? base32Secret(32),
  };
  const text = serializeEnv(needed);
  created = Object.entries(needed).some(([k, v]) => cur[k] !== v);
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
  migrateLegacyRootEnv(map);
  map.REQALM_MODE = map.REQALM_MODE ?? "development";
  map.POSTGRES_USER = map.POSTGRES_USER ?? "reqalm";
  map.POSTGRES_DB = map.POSTGRES_DB ?? "reqalm";
  map.POSTGRES_PASSWORD = secrets.POSTGRES_PASSWORD;
  map.REQALM_DEV_ACCOUNT_PASSWORD = secrets.REQALM_DEV_ACCOUNT_PASSWORD;
  map.REQALM_AGENT_CLIENT_SECRET = secrets.REQALM_AGENT_CLIENT_SECRET;
  map.REQALM_SESSION_SECRET = secrets.REQALM_SESSION_SECRET;
  map.REQALM_CSRF_SECRET = secrets.REQALM_CSRF_SECRET;
  map.REQALM_AUTH_IDENTITY_MODE = map.REQALM_AUTH_IDENTITY_MODE ?? "hybrid";
  map.REQALM_AUTH_LOCAL_ACCOUNTS = map.REQALM_AUTH_LOCAL_ACCOUNTS ?? "enabled";
  map.REQALM_ISSUER_URL = map.REQALM_ISSUER_URL ?? "http://localhost:3000";
  map.DATABASE_URL = `postgresql://${map.POSTGRES_USER}:${secrets.POSTGRES_PASSWORD}@127.0.0.1:5432/${map.POSTGRES_DB}`;
  map.OPENBAO_ADDR = map.OPENBAO_ADDR ?? "http://127.0.0.1:8200";
  map.REQALM_HOST_BIND = map.REQALM_HOST_BIND ?? "127.0.0.1";
  writeFileSync(envFile, serializeEnv(map), { mode: 0o600 });
  chmodSync(envFile, 0o600);
}

function main() {
  const secrets = loadOrCreateSecrets();
  mergeRootEnv(secrets);
  if (!process.env.DEVENV_INIT_QUIET) {
    console.log("ReqALM devenv initialized (.reqalm/devenv.env + .env updated).");
    if (legacyEnvKeyMigrations.length) {
      console.log("Migrated legacy ReqAML devenv names (secret values unchanged):");
      for (const line of legacyEnvKeyMigrations) {
        console.log(`  ${line}`);
      }
    }
    if (created) {
      // Print new secrets once; later runs only point at the gitignored file.
      console.log("New secrets (also in .reqalm/devenv.env — gitignored):");
      for (const [k, v] of Object.entries(secrets)) {
        console.log(`  ${k}=${v}`);
      }
    } else {
      console.log("Secrets unchanged; see .reqalm/devenv.env (gitignored).");
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
