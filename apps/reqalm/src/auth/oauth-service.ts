import { createHash } from "node:crypto";
import type pg from "pg";
import type { AppConfig } from "../config.js";
import { writeAuthAudit } from "../audit/auth-audit.js";
import {
  clearLoginFailures,
  reserveLoginAttempt,
} from "../credential/lockout.js";
import {
  hashPassword,
  needsRehash,
  randomToken,
  verifyPassword,
} from "../credential/password.js";
import {
  identityHasPrivilegedRole,
  loadMfaSecret,
  verifyTotp,
} from "../credential/mfa.js";
import type { KeyProvider } from "../key/provider.js";
import { signAccessToken } from "../key/signing.js";
import { getClient, type OAuthClient } from "./clients.js";
import { verifyPkceS256, validateAuthorizePkce } from "./pkce.js";
import { resolveResource, type OAuthResource } from "./resources.js";
import type { AuthProfile } from "./profile.js";
import { localLoginAllowed } from "./profile.js";
import { hashUsernameForAudit, normalizeUsername } from "../credential/username.js";
import { isIpThrottled, recordIpLoginFailure } from "../credential/ip-throttle.js";

const CODE_TTL_SEC = 120;
const ACCESS_TTL_SEC = 300;
const REFRESH_TTL_SEC = 86400;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type LoginContext = {
  ip?: string;
  userAgent?: string;
};

export async function authenticateLocalUser(
  pool: pg.Pool,
  profile: AuthProfile,
  username: string,
  password: string,
  ctx: LoginContext,
): Promise<
  | { ok: true; identityId: string; needsMfa: boolean }
  | { ok: false; error: string }
> {
  if (await isIpThrottled(pool, ctx.ip)) {
    await writeAuthAudit(pool, {
      eventType: "login.ip_throttle",
      outcome: "deny",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: false, error: "invalid_credentials" };
  }
  username = normalizeUsername(username);
  if (!localLoginAllowed(profile)) {
    await writeAuthAudit(pool, {
      eventType: "login.local",
      outcome: "deny",
      detail: { reason: "local_accounts_disabled" },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: false, error: "invalid_credentials" };
  }
  const r = await pool.query<{
    identity_id: string;
    password_hash: string;
    mfa_enabled: boolean;
    is_breakglass: boolean;
  }>(
    `SELECT identity_id, password_hash, mfa_enabled, is_breakglass FROM local_credentials WHERE username = $1`,
    [username],
  );
  if (!r.rowCount) {
    await recordIpLoginFailure(pool, ctx.ip);
    await writeAuthAudit(pool, {
      eventType: "login.local",
      outcome: "failure",
      detail: { username_hash: hashUsernameForAudit(username) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: false, error: "invalid_credentials" };
  }
  const row = r.rows[0];
  if (profile.localAccounts === "breakglass_only" && !row.is_breakglass) {
    return { ok: false, error: "invalid_credentials" };
  }
  // Count the attempt atomically *before* verifying, so concurrent guesses cannot race past the
  // threshold. Cleared only when the whole login (password + MFA if required) succeeds.
  const lockout = await reserveLoginAttempt(pool, row.identity_id);
  if (lockout.locked) {
    await writeAuthAudit(pool, {
      eventType: "login.lockout",
      outcome: "deny",
      identityId: row.identity_id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: false, error: "account_locked" };
  }
  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    await recordIpLoginFailure(pool, ctx.ip);
    await writeAuthAudit(pool, {
      eventType: "login.local",
      outcome: "failure",
      identityId: row.identity_id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: false, error: "invalid_credentials" };
  }
  if (needsRehash(row.password_hash)) {
    const h = await hashPassword(password);
    await pool.query(
      `UPDATE local_credentials SET password_hash = $2 WHERE identity_id = $1`,
      [row.identity_id, h],
    );
  }
  const privileged = await identityHasPrivilegedRole(pool, row.identity_id);
  const needsMfa = privileged || row.mfa_enabled;
  // Without MFA the login is complete; with MFA the route clears failures after the code verifies,
  // so wrong TOTP guesses count toward lockout too.
  if (!needsMfa) await clearLoginFailures(pool, row.identity_id);
  await writeAuthAudit(pool, {
    eventType: "login.local",
    outcome: "success",
    identityId: row.identity_id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    detail: { needsMfa },
  });
  return { ok: true, identityId: row.identity_id, needsMfa };
}

export async function verifyMfaForLogin(
  pool: pg.Pool,
  keyProvider: KeyProvider,
  identityId: string,
  code: string,
): Promise<boolean> {
  const secret = await loadMfaSecret(pool, keyProvider, identityId);
  if (!secret) return false;
  const { verifyTotpNoReplay } = await import("../credential/mfa.js");
  return verifyTotpNoReplay(pool, identityId, secret, code);
}

export async function needsMfaEnrollment(
  pool: pg.Pool,
  identityId: string,
): Promise<boolean> {
  const privileged = await identityHasPrivilegedRole(pool, identityId);
  if (!privileged) return false;
  const r = await pool.query<{ mfa_enabled: boolean }>(
    `SELECT mfa_enabled FROM local_credentials WHERE identity_id = $1`,
    [identityId],
  );
  return !r.rowCount || !r.rows[0].mfa_enabled;
}

export async function mintAccessFromRefreshPlain(
  pool: pg.Pool,
  keyProvider: KeyProvider,
  input: {
    refreshToken: string;
    clientId: string;
    resource: string;
    issuer: string;
  },
): Promise<string | null> {
  const tokenHash = hashToken(input.refreshToken);
  const r = await pool.query<{
    identity_id: string;
    mfa_verified: boolean;
    revoked_at: Date | null;
    expires_at: Date;
  }>(
    `
    SELECT f.identity_id, f.mfa_verified, f.revoked_at, rt.expires_at
    FROM oauth_refresh_tokens rt
    JOIN oauth_refresh_families f ON f.id = rt.family_id
    WHERE rt.token_hash = $1 AND rt.rotated_at IS NULL
  `,
    [tokenHash],
  );
  if (!r.rowCount || r.rows[0].revoked_at) return null;
  if (r.rows[0].expires_at.getTime() < Date.now()) return null;
  const { token } = await signAccessToken(
    pool,
    keyProvider,
    {
      sub: r.rows[0].identity_id,
      aud: input.resource,
      iss: input.issuer,
      clientId: input.clientId,
      authTime: Math.floor(Date.now() / 1000),
      mfa: r.rows[0].mfa_verified,
    },
    ACCESS_TTL_SEC,
  );
  return token;
}

export async function createAuthorizationCode(
  pool: pg.Pool,
  input: {
    clientId: string;
    identityId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    resource: string;
    scope?: string;
    state?: string;
    mfaVerified: boolean;
  },
): Promise<string> {
  const code = randomToken(32);
  const codeHash = hashToken(code);
  const expires = new Date(Date.now() + CODE_TTL_SEC * 1000);
  await pool.query(
    `
    INSERT INTO oauth_authorization_codes
      (code_hash, client_id, identity_id, redirect_uri, code_challenge, code_challenge_method,
       resource, scope, state, mfa_verified, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  `,
    [
      codeHash,
      input.clientId,
      input.identityId,
      input.redirectUri,
      input.codeChallenge,
      input.codeChallengeMethod,
      input.resource,
      input.scope ?? null,
      input.state ?? null,
      input.mfaVerified,
      expires,
    ],
  );
  return code;
}

export async function exchangeAuthorizationCode(
  pool: pg.Pool,
  config: AppConfig,
  keyProvider: KeyProvider,
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    resource: string;
    issuer: string;
  },
  ctx: LoginContext,
): Promise<
  | { ok: true; accessToken: string; refreshToken: string; expiresIn: number }
  | { ok: false; error: string }
> {
  const codeHash = hashToken(input.code);
  const r = await pool.query<{
    client_id: string;
    identity_id: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    resource: string;
    mfa_verified: boolean;
    expires_at: Date;
    used_at: Date | null;
  }>(
    // Single-use: mark used atomically so two concurrent exchanges cannot both redeem the code.
    `UPDATE oauth_authorization_codes SET used_at = now()
     WHERE code_hash = $1 AND used_at IS NULL
     RETURNING *`,
    [codeHash],
  );
  if (!r.rowCount) return { ok: false, error: "invalid_grant" };
  const row = r.rows[0];
  if (row.expires_at.getTime() < Date.now()) {
    return { ok: false, error: "invalid_grant" };
  }
  if (
    row.client_id !== input.clientId ||
    row.redirect_uri !== input.redirectUri ||
    row.resource !== input.resource
  ) {
    return { ok: false, error: "invalid_grant" };
  }
  if (row.code_challenge_method !== "S256") {
    return { ok: false, error: "invalid_grant" };
  }
  if (!verifyPkceS256(input.codeVerifier, row.code_challenge)) {
    return { ok: false, error: "invalid_grant" };
  }
  const privileged = await identityHasPrivilegedRole(pool, row.identity_id);
  if (privileged && !row.mfa_verified) {
    return { ok: false, error: "mfa_required" };
  }

  const tokens = await issueTokens(pool, config, keyProvider, {
    identityId: row.identity_id,
    clientId: input.clientId,
    resource: input.resource,
    issuer: input.issuer,
    mfa: row.mfa_verified,
  });
  await writeAuthAudit(pool, {
    eventType: "token.issue",
    outcome: "success",
    identityId: row.identity_id,
    clientId: input.clientId,
    resource: input.resource,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { ok: true, ...tokens };
}

async function issueTokens(
  pool: pg.Pool,
  config: AppConfig,
  keyProvider: KeyProvider,
  input: {
    identityId: string;
    clientId: string;
    resource: string;
    issuer: string;
    mfa: boolean;
    /** Existing refresh family when rotating; a new family is created at code exchange. */
    familyId?: string;
  },
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const authTime = Math.floor(Date.now() / 1000);
  const { token: accessToken } = await signAccessToken(
    pool,
    keyProvider,
    {
      sub: input.identityId,
      aud: input.resource,
      iss: input.issuer,
      clientId: input.clientId,
      authTime,
      mfa: input.mfa,
    },
    ACCESS_TTL_SEC,
  );
  const refreshToken = randomToken(48);
  let familyId = input.familyId;
  if (!familyId) {
    familyId = randomToken(16);
    await pool.query(
      `INSERT INTO oauth_refresh_families (id, identity_id, client_id, resource, mfa_verified)
       VALUES ($1,$2,$3,$4,$5)`,
      [familyId, input.identityId, input.clientId, input.resource, input.mfa],
    );
  }
  const refreshHash = hashToken(refreshToken);
  const refreshExpires = new Date(Date.now() + REFRESH_TTL_SEC * 1000);
  await pool.query(
    `INSERT INTO oauth_refresh_tokens (token_hash, family_id, expires_at) VALUES ($1,$2,$3)`,
    [refreshHash, familyId, refreshExpires],
  );
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TTL_SEC,
  };
}

export async function refreshAccessToken(
  pool: pg.Pool,
  config: AppConfig,
  keyProvider: KeyProvider,
  input: {
    refreshToken: string;
    clientId: string;
    resource: string;
    issuer: string;
  },
  ctx: LoginContext,
): Promise<
  | { ok: true; accessToken: string; refreshToken: string; expiresIn: number }
  | { ok: false; error: string; reuseDetected?: boolean }
> {
  const tokenHash = hashToken(input.refreshToken);
  const r = await pool.query<{
    token_hash: string;
    family_id: string;
    rotated_at: Date | null;
    expires_at: Date;
    identity_id: string;
    client_id: string;
    resource: string;
    revoked_at: Date | null;
    mfa_verified: boolean;
  }>(
    `
    SELECT rt.token_hash, rt.family_id, rt.rotated_at, rt.expires_at,
           f.identity_id, f.client_id, f.resource, f.revoked_at, f.mfa_verified
    FROM oauth_refresh_tokens rt
    JOIN oauth_refresh_families f ON f.id = rt.family_id
    WHERE rt.token_hash = $1
  `,
    [tokenHash],
  );
  if (!r.rowCount) return { ok: false, error: "invalid_grant" };
  const row = r.rows[0];
  if (row.revoked_at) return { ok: false, error: "invalid_grant" };
  const reuse = async () => {
    await revokeRefreshFamily(pool, row.family_id);
    await writeAuthAudit(pool, {
      eventType: "token.refresh_reuse",
      outcome: "deny",
      identityId: row.identity_id,
      clientId: row.client_id,
      resource: row.resource,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: false as const, error: "invalid_grant", reuseDetected: true };
  };
  if (row.rotated_at) return reuse();
  if (row.expires_at.getTime() < Date.now()) {
    return { ok: false, error: "invalid_grant" };
  }
  if (row.client_id !== input.clientId || row.resource !== input.resource) {
    return { ok: false, error: "invalid_grant" };
  }
  // Rotate atomically: if a concurrent request already rotated this token, treat it as reuse.
  const rotated = await pool.query(
    `UPDATE oauth_refresh_tokens SET rotated_at = now()
     WHERE token_hash = $1 AND rotated_at IS NULL`,
    [tokenHash],
  );
  if (!rotated.rowCount) return reuse();
  // The new refresh token stays in the same family, so reuse of any earlier token revokes it too.
  const tokens = await issueTokens(pool, config, keyProvider, {
    identityId: row.identity_id,
    clientId: row.client_id,
    resource: row.resource,
    issuer: input.issuer,
    mfa: row.mfa_verified,
    familyId: row.family_id,
  });
  await writeAuthAudit(pool, {
    eventType: "token.refresh",
    outcome: "success",
    identityId: row.identity_id,
    clientId: row.client_id,
    resource: row.resource,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { ok: true, ...tokens };
}

async function revokeRefreshFamily(pool: pg.Pool, familyId: string): Promise<void> {
  await pool.query(
    `UPDATE oauth_refresh_families SET revoked_at = now() WHERE id = $1`,
    [familyId],
  );
}

export async function revokeToken(
  pool: pg.Pool,
  config: AppConfig,
  keyProvider: KeyProvider,
  token: string,
  tokenTypeHint: string | undefined,
  ctx: LoginContext,
  reqHost?: string,
): Promise<void> {
  const hash = hashToken(token);
  if (tokenTypeHint === "refresh_token" || tokenTypeHint === undefined) {
    const r = await pool.query<{ family_id: string; identity_id: string }>(
      `
      SELECT f.id AS family_id, f.identity_id
      FROM oauth_refresh_tokens rt
      JOIN oauth_refresh_families f ON f.id = rt.family_id
      WHERE rt.token_hash = $1
    `,
      [hash],
    );
    if (r.rowCount) {
      await revokeRefreshFamily(pool, r.rows[0].family_id);
      await writeAuthAudit(pool, {
        eventType: "token.revoke",
        outcome: "success",
        identityId: r.rows[0].identity_id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { kind: "refresh" },
      });
      return;
    }
  }
  if (tokenTypeHint === "access_token" || token.includes(".")) {
    try {
      const { verifyAccessToken } = await import("./token-verify.js");
      const { apiResource, issuerUrl } = await import("./resources.js");
      const host = reqHost ?? `localhost:${config.REQALM_PORT}`;
      const aud = apiResource(config, host).canonicalUri;
      const payload = await verifyAccessToken(pool, config, token, aud, host);
      if (payload.jti && payload.exp) {
        await pool.query(
          `
          INSERT INTO oauth_access_revocations (jti, expires_at)
          VALUES ($1, to_timestamp($2))
          ON CONFLICT (jti) DO NOTHING
        `,
          [payload.jti, payload.exp],
        );
        await writeAuthAudit(pool, {
          eventType: "token.revoke",
          outcome: "success",
          identityId: payload.sub,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          detail: { kind: "access", jti: payload.jti },
        });
      }
    } catch {
      /* RFC 7009: invalid tokens are ignored */
    }
  }
}

export async function validateAuthorizeRequest(
  pool: pg.Pool,
  config: AppConfig,
  params: Record<string, string | undefined>,
  issuer: string,
  reqHost: string,
): Promise<
  | {
      ok: true;
      client: OAuthClient;
      resource: OAuthResource;
      redirectUri: string;
      codeChallenge: string;
      state?: string;
      scope?: string;
    }
  | { ok: false; error: string; errorDescription?: string }
> {
  const clientId = params.client_id;
  const redirectUri = params.redirect_uri;
  const responseType = params.response_type;
  const pkceErr = validateAuthorizePkce(
    params.code_challenge_method,
    params.code_challenge,
  );
  if (pkceErr) {
    return { ok: false, error: "invalid_request", errorDescription: pkceErr };
  }
  if (responseType !== "code") {
    return { ok: false, error: "unsupported_response_type" };
  }
  if (!params.state) {
    return { ok: false, error: "invalid_request", errorDescription: "state required" };
  }
  if (!clientId || !redirectUri) {
    return { ok: false, error: "invalid_request" };
  }
  const client = await getClient(pool, clientId);
  if (!client) return { ok: false, error: "unauthorized_client" };
  if (!client.redirectUris.includes(redirectUri)) {
    return { ok: false, error: "invalid_request", errorDescription: "redirect_uri mismatch" };
  }
  let resource: OAuthResource;
  try {
    resource = resolveResource(config, params.resource, reqHost);
  } catch {
    return { ok: false, error: "invalid_target" };
  }
  if (!client.allowedResources.includes(resource.canonicalUri)) {
    return { ok: false, error: "invalid_target" };
  }
  return {
    ok: true,
    client,
    resource,
    redirectUri,
    codeChallenge: params.code_challenge!,
    state: params.state,
    scope: params.scope,
  };
}
