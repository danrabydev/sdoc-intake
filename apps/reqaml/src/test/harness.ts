import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Secret, TOTP } from "otpauth";
import type pg from "pg";
import type { AppConfig, AppRole } from "../config.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../credential/password.js";
import { storeMfaSecret } from "../credential/mfa.js";
import { createMemoryKeyProvider, type KeyProvider } from "../key/provider.js";
import { buildApiServer, type RuntimeState } from "../http/server.js";
import { ProbeCache } from "../readiness/cache.js";
import { defaultRoleAssets } from "../readiness/report.js";
import type { ReadinessContext } from "../readiness/report.js";
import { createMigratedPglitePool } from "./pglite-pool.js";

export const TEST_PASSWORD = "test-harness-password-42";
export const TEST_AGENT_SECRET = "agent-harness-secret-99";
export const TEST_ISSUER = "http://localhost:3000";
export const TEST_API_RESOURCE = `${TEST_ISSUER}/api`;
export const TEST_MFA_SECRET = "JBSWY3DPEHPK3PXP";

export type TestApp = {
  app: FastifyInstance;
  pool: pg.Pool;
  config: AppConfig;
  keyProvider: KeyProvider;
  close: () => Promise<void>;
};

export function testConfigEnv(): NodeJS.ProcessEnv {
  return {
    REQAML_MODE: "development",
    REQAML_ROLES: "api,web,mcp",
    REQAML_PORT: "3000",
    DATABASE_URL: "postgres://pglite/test",
    REQAML_SESSION_SECRET: "harness-session-secret-min-32-chars!!",
    REQAML_AGENT_CLIENT_SECRET: TEST_AGENT_SECRET,
    REQAML_SEED_ON_START: "false",
    REQAML_TRUST_PROXY: "true",
    REQAML_TRUSTED_PROXIES: "203.0.113.0/24,198.51.100.0/24",
  };
}

export async function seedAuthUsers(pool: pg.Pool, keyProvider: KeyProvider): Promise<void> {
  await pool.query(
    `INSERT INTO clients (id, name) VALUES ('reqaml-client', 'ReqAML') ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO projects (id, client_id, name) VALUES ('reqaml', 'reqaml-client', 'ReqAML') ON CONFLICT DO NOTHING`,
  );
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const users: Array<{ id: string; username: string; role: string }> = [
    { id: "casey-reader", username: "casey-reader@dev.local", role: "Reader" },
    { id: "taylor-tester", username: "taylor-tester@dev.local", role: "Tester" },
    { id: "sam-security", username: "sam-security@dev.local", role: "Security" },
  ];
  for (const u of users) {
    await pool.query(
      `INSERT INTO identities (id, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [u.id, u.id],
    );
    await pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role)
       VALUES ($1, 'reqaml', $2, $3) ON CONFLICT DO NOTHING`,
      [`grant-${u.id}`, u.id, u.role],
    );
    await pool.query(
      `INSERT INTO local_credentials (identity_id, username, password_hash, is_dev_seeded)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (identity_id) DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash`,
      [u.id, u.username, passwordHash],
    );
  }
  await storeMfaSecret(pool, keyProvider, "sam-security", TEST_MFA_SECRET);
}

export async function createTestApp(): Promise<TestApp> {
  const { pool } = await createMigratedPglitePool();
  const config = loadConfig(testConfigEnv());
  const keyProvider = createMemoryKeyProvider();
  await seedAuthUsers(pool, keyProvider);

  const roles = new Set<AppRole>(config.REQAML_ROLES);
  const readiness: ReadinessContext = {
    config,
    pool,
    roles,
    sync: null,
    roleAssets: await defaultRoleAssets(),
    cache: new ProbeCache(config.REQAML_READY_CACHE_MS),
    probeTimeoutMs: config.REQAML_READY_PROBE_TIMEOUT_MS,
  };
  const state: RuntimeState = {
    config,
    pool,
    roles,
    sync: null,
    readiness,
    keyProvider,
  };
  const app = await buildApiServer(state);
  return {
    app,
    pool,
    config,
    keyProvider,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

export function totpNow(secretBase32: string): string {
  return new TOTP({ secret: Secret.fromBase32(secretBase32) }).generate();
}
