import { createHmac, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import type { AppConfig } from "../config.js";
import { isProduction } from "../config.js";
import type { KeyProvider } from "../key/provider.js";
import { randomToken } from "../credential/password.js";

export const SESSION_COOKIE = "reqalm_session";
export const CSRF_COOKIE = "reqalm_csrf";

const EPHEMERAL_DEV_SESSION_SECRET = randomBytes(32).toString("base64url");
const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;

export function sessionSecret(config: AppConfig): string {
  const s = process.env.REQALM_SESSION_SECRET;
  if (!s && isProduction(config)) {
    throw new Error("REQALM_SESSION_SECRET required in production");
  }
  // No committed fallback: without devenv:init, dev uses a per-process random secret (sessions end
  // on restart).
  return s ?? EPHEMERAL_DEV_SESSION_SECRET;
}

export function signSessionId(id: string, config: AppConfig): string {
  const sig = createHmac("sha256", sessionSecret(config)).update(id).digest("base64url");
  return `${id}.${sig}`;
}

export function verifySessionCookie(raw: string | undefined, config: AppConfig): string | null {
  if (!raw) return null;
  const [id, sig] = raw.split(".");
  if (!id || !sig) return null;
  const expected = createHmac("sha256", sessionSecret(config)).update(id).digest("base64url");
  if (sig.length !== expected.length) return null;
  let ok = 0;
  for (let i = 0; i < sig.length; i++) ok |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return ok === 0 ? id : null;
}

export async function createWebSession(
  pool: pg.Pool,
  keyProvider: KeyProvider,
  input: {
    identityId: string;
    refreshToken: string;
    mfaVerified: boolean;
  },
): Promise<{ sessionId: string; csrfToken: string }> {
  const sessionId = randomToken(24);
  const csrfToken = randomBytes(24).toString("base64url");
  const refreshCt = await keyProvider.wrapSecret(
    Buffer.from(input.refreshToken, "utf8"),
    "web-session",
  );
  const now = Date.now();
  await pool.query(
    `
    INSERT INTO web_sessions
      (id, identity_id, refresh_token_ciphertext, csrf_token, mfa_verified, absolute_expires_at, idle_expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
  `,
    [
      sessionId,
      input.identityId,
      refreshCt,
      csrfToken,
      input.mfaVerified,
      new Date(now + SESSION_ABSOLUTE_MS),
      new Date(now + SESSION_IDLE_MS),
    ],
  );
  return { sessionId, csrfToken };
}

export async function loadWebSession(
  pool: pg.Pool,
  sessionId: string,
): Promise<{
  identityId: string;
  csrfToken: string;
  mfaVerified: boolean;
  refreshTokenCiphertext: string;
} | null> {
  const r = await pool.query<{
    identity_id: string;
    csrf_token: string;
    mfa_verified: boolean;
    refresh_token_ciphertext: string;
    absolute_expires_at: Date;
    idle_expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT * FROM web_sessions WHERE id = $1`,
    [sessionId],
  );
  if (!r.rowCount || r.rows[0].revoked_at) return null;
  const row = r.rows[0];
  const now = Date.now();
  if (row.absolute_expires_at.getTime() < now || row.idle_expires_at.getTime() < now) {
    return null;
  }
  await pool.query(
    `UPDATE web_sessions SET idle_expires_at = $2 WHERE id = $1`,
    [sessionId, new Date(now + SESSION_IDLE_MS)],
  );
  return {
    identityId: row.identity_id,
    csrfToken: row.csrf_token,
    mfaVerified: row.mfa_verified,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
  };
}

export async function revokeWebSession(pool: pg.Pool, sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE web_sessions SET revoked_at = now() WHERE id = $1`,
    [sessionId],
  );
}

export function setSessionCookies(
  reply: FastifyReply,
  config: AppConfig,
  sessionId: string,
  csrfToken: string,
): void {
  const signed = signSessionId(sessionId, config);
  const secure = isProduction(config);
  reply.setCookie(SESSION_COOKIE, signed, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
  });
  reply.setCookie(CSRF_COOKIE, csrfToken, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    secure,
  });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
  reply.clearCookie(CSRF_COOKIE, { path: "/" });
}

export function assertCsrf(req: FastifyRequest, expectedCsrf: string): boolean {
  const header = req.headers["x-csrf-token"];
  return typeof header === "string" && header === expectedCsrf;
}
