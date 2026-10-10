import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { Secret, TOTP } from "otpauth";
import type pg from "pg";
import type { AppConfig, AppRole } from "../config.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../credential/password.js";
import { storeMfaSecret } from "../credential/mfa.js";
import type { KeyProvider } from "../key/provider.js";
import { createMemoryKeyProvider } from "../key/memory-provider.js";
import { buildApiServer, type RuntimeState } from "../http/server.js";
import { ProbeCache } from "../readiness/cache.js";
import { defaultRoleAssets } from "../readiness/report.js";
import type { ReadinessContext } from "../readiness/report.js";
import { createMigratedPglitePool } from "./pglite-pool.js";
import { loadDogfoodSeed, readDogfoodFile } from "../seed/load-dogfood.js";

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
    REQALM_MODE: "development",
    REQALM_ROLES: "api,web,mcp",
    REQALM_PORT: process.env.REQALM_PORT ?? "3000",
    DATABASE_URL: "postgres://pglite/test",
    REQALM_SESSION_SECRET: "harness-session-secret-min-32-chars!!",
    REQALM_AGENT_CLIENT_SECRET: TEST_AGENT_SECRET,
    REQALM_SEED_ON_START: "false",
    REQALM_DEV_ACCOUNT_PASSWORD: randomBytes(18).toString("base64url"),
    REQALM_TRUST_PROXY: "true",
    REQALM_TRUSTED_PROXIES: "203.0.113.0/24,198.51.100.0/24",
  };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const DOGFOOD_SEED_PATH = path.join(repoRoot, "docs/design/seed/dogfood.yaml");

export async function seedAuthUsers(pool: pg.Pool, keyProvider: KeyProvider): Promise<void> {
  await pool.query(
    `INSERT INTO clients (id, name) VALUES ('reqalm-client', 'ReqALM') ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO projects (id, client_id, name) VALUES ('reqalm', 'reqalm-client', 'ReqALM') ON CONFLICT DO NOTHING`,
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
       VALUES ($1, 'reqalm', $2, $3) ON CONFLICT DO NOTHING`,
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

export async function createTestApp(options?: { roles?: string; dogfood?: boolean }): Promise<TestApp> {
  const pgFixture = await createMigratedPglitePool();
  const { pool } = pgFixture;
  const env = testConfigEnv();
  if (options?.roles) env.REQALM_ROLES = options.roles;
  const config = loadConfig(env);
  const keyProvider = createMemoryKeyProvider();
  await seedAuthUsers(pool, keyProvider);
  if (options?.dogfood) {
    const seed = await readDogfoodFile(DOGFOOD_SEED_PATH);
    await loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true });
  }

  const roles = new Set<AppRole>(config.REQALM_ROLES);
  const readiness: ReadinessContext = {
    config,
    pool,
    roles,
    sync: null,
    roleAssets: await defaultRoleAssets(),
    cache: new ProbeCache(config.REQALM_READY_CACHE_MS),
    probeTimeoutMs: config.REQALM_READY_PROBE_TIMEOUT_MS,
  };
  const state: RuntimeState = {
    config,
    pool,
    roles,
    sync: null,
    readiness,
    keyProvider,
  };
  try {
    const app = await buildApiServer(state);
    return {
      app,
      pool,
      config,
      keyProvider,
      close: async () => {
        await app.close();
        await pgFixture.close();
      },
    };
  } catch (error) {
    try {
      await pgFixture.close();
    } catch {
      // Preserve the original build/registration failure.
    }
    throw error;
  }
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

/** Access token for a seeded local user, through the real authorize → local login → token flow. */
export async function issueTestAccessToken(
  app: FastifyInstance,
  username = "casey-reader@dev.local",
): Promise<string> {
  const inject = (opts: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }) =>
    app.inject({
      ...opts,
      remoteAddress: "203.0.113.50",
      headers: { host: "localhost:3000", ...opts.headers },
    } as never);
  const { verifier, challenge } = pkcePair();
  const redirectUri = `${TEST_ISSUER}/oauth/callback`;
  const authz = await inject({
    method: "GET",
    url: `/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: "reqalm-web",
      redirect_uri: redirectUri,
      scope: "openid profile",
      state: "s",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: TEST_API_RESOURCE,
    })}`,
  });
  const handoff = new URL(String(authz.headers.location ?? ""), TEST_ISSUER).searchParams.get("h");
  if (!handoff) throw new Error(`authorize: no handoff (${authz.statusCode})`);
  const login = await inject({
    method: "POST",
    url: "/api/v1/auth/local/login",
    headers: { "content-type": "application/json" },
    payload: { username, password: TEST_PASSWORD, h: handoff },
  });
  if (login.statusCode !== 200) throw new Error(`login ${username}: ${login.statusCode}`);
  const code = new URL((login.json() as { redirect: string }).redirect, TEST_ISSUER).searchParams.get("code");
  if (!code) throw new Error("login: no code");
  const token = await inject({
    method: "POST",
    url: "/oauth/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: "reqalm-web",
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: TEST_API_RESOURCE,
    }).toString(),
  });
  if (token.statusCode !== 200) throw new Error(`token: ${token.statusCode}`);
  return (token.json() as { access_token: string }).access_token;
}
