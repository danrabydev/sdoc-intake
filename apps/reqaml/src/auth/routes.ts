import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import type { AppConfig } from "../config.js";
import { writeAuthAudit } from "../audit/auth-audit.js";
import type { KeyProvider } from "../key/provider.js";
import { getPublicJwks } from "../key/signing.js";
import {
  apiResource,
  issuerUrl,
  mcpResource,
} from "./resources.js";
import { clearLoginFailures } from "../credential/lockout.js";
import {
  authenticateLocalUser,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  mintAccessFromRefreshPlain,
  needsMfaEnrollment,
  refreshAccessToken,
  revokeToken,
  validateAuthorizeRequest,
  verifyMfaForLogin,
} from "./oauth-service.js";
import {
  createLoginHandoff,
  deleteLoginHandoff,
  handoffFromValidated,
  loadLoginHandoff,
} from "./handoff.js";
import { confirmMfaEnrollment, startMfaEnrollment } from "./mfa-enroll.js";
import { issueClientCredentialsToken } from "./agent-auth.js";
import {
  assertCsrf,
  clearSessionCookies,
  createWebSession,
  loadWebSession,
  revokeWebSession,
  setSessionCookies,
  SESSION_COOKIE,
  verifySessionCookie,
} from "./web-session.js";
import { randomToken } from "../credential/password.js";
import { reserveLoginAttempt } from "../credential/lockout.js";
import { recordIpLoginFailure } from "../credential/ip-throttle.js";
import type { AuthProfile } from "./profile.js";
import { localLoginAllowed } from "./profile.js";

export type AuthRouteDeps = {
  config: AppConfig;
  pool: pg.Pool;
  keyProvider: KeyProvider;
  profile: AuthProfile;
};

function requestContext(req: FastifyRequest) {
  return {
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

function hostFromRequest(req: FastifyRequest, config: AppConfig): string {
  const host = req.headers.host;
  if (host) return host;
  return `127.0.0.1:${config.REQAML_PORT}`;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRouteDeps,
): Promise<void> {
  const { config, pool, keyProvider, profile } = deps;

  app.get("/.well-known/oauth-authorization-server", async (req, reply) => {
    const iss = issuerUrl(config, hostFromRequest(req, config));
    const metadata = {
      issuer: iss,
      authorization_endpoint: `${iss}/oauth/authorize`,
      token_endpoint: `${iss}/oauth/token`,
      revocation_endpoint: `${iss}/oauth/revoke`,
      jwks_uri: `${iss}/oauth/jwks`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      scopes_supported: ["openid", "profile"],
    };
    return reply.send(metadata);
  });

  for (const [suffix, resourceFn] of [
    ["api", apiResource],
    ["mcp", mcpResource],
  ] as const) {
    app.get(
      `/.well-known/oauth-protected-resource/${suffix}`,
      async (req, reply) => {
        const host = hostFromRequest(req, config);
        const iss = issuerUrl(config, host);
        const resource = resourceFn(config, host);
        return reply.send({
          resource: resource.canonicalUri,
          authorization_servers: [iss],
          bearer_methods_supported: ["header"],
          scopes_supported: ["openid", "profile"],
        });
      },
    );
  }

  app.get("/oauth/jwks", async (_req, reply) => {
    return reply.send(await getPublicJwks(pool));
  });

  app.get("/oauth/web/start", async (req, reply) => {
    const host = hostFromRequest(req, config);
    const iss = issuerUrl(config, host);
    const verifier = randomToken(48);
    const challenge = createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const state = randomToken(16);
    const redirectUri = `${iss}/oauth/web/callback`;
    const resource = apiResource(config, host).canonicalUri;
    const handoffId = await createLoginHandoff(pool, {
      clientId: "reqaml-web",
      redirectUri,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      resource,
      scope: "openid profile",
      state,
      codeVerifier: verifier,
    });
    const q = new URLSearchParams({
      response_type: "code",
      client_id: "reqaml-web",
      redirect_uri: redirectUri,
      scope: "openid profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
      handoff: handoffId,
    });
    return reply.redirect(`/oauth/authorize?${q}`);
  });

  app.get("/oauth/authorize", async (req, reply) => {
    const host = hostFromRequest(req, config);
    const iss = issuerUrl(config, host);
    const params = req.query as Record<string, string | undefined>;
    const validated = await validateAuthorizeRequest(
      pool,
      config,
      params,
      iss,
      host,
    );
    if (!validated.ok) {
      return reply.code(400).send({
        error: validated.error,
        error_description: validated.errorDescription,
      });
    }
    let handoffId = params.handoff;
    if (!handoffId) {
      handoffId = await createLoginHandoff(
        pool,
        handoffFromValidated(validated, null),
      );
    } else {
      const handoff = await loadLoginHandoff(pool, handoffId);
      if (
        !handoff ||
        handoff.clientId !== validated.client.clientId ||
        handoff.redirectUri !== validated.redirectUri ||
        handoff.codeChallenge !== validated.codeChallenge ||
        handoff.resource !== validated.resource.canonicalUri ||
        handoff.state !== validated.state
      ) {
        return reply.code(400).send({ error: "invalid_request", error_description: "handoff mismatch" });
      }
    }
    return reply.redirect(
      `/login?h=${encodeURIComponent(handoffId)}&state=${encodeURIComponent(validated.state ?? "")}`,
    );
  });

  app.post("/oauth/token", async (req, reply) => {
    const host = hostFromRequest(req, config);
    const iss = issuerUrl(config, host);
    const body = req.body as Record<string, string | undefined>;
    const grantType = body.grant_type;
    const ctx = requestContext(req);
    if (grantType === "authorization_code") {
      if (!body.code || !body.client_id || !body.redirect_uri || !body.code_verifier) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const resource =
        body.resource ??
        apiResource(config, host).canonicalUri;
      const result = await exchangeAuthorizationCode(
        pool,
        config,
        keyProvider,
        {
          code: body.code,
          clientId: body.client_id,
          redirectUri: body.redirect_uri,
          codeVerifier: body.code_verifier,
          resource,
          issuer: iss,
        },
        ctx,
      );
      if (!result.ok) {
        return reply.code(400).send({ error: result.error });
      }
      return reply.send({
        access_token: result.accessToken,
        token_type: "Bearer",
        expires_in: result.expiresIn,
        refresh_token: result.refreshToken,
        iss,
      });
    }
    if (grantType === "refresh_token") {
      if (!body.refresh_token || !body.client_id) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const resource =
        body.resource ??
        apiResource(config, host).canonicalUri;
      const result = await refreshAccessToken(
        pool,
        config,
        keyProvider,
        {
          refreshToken: body.refresh_token,
          clientId: body.client_id,
          resource,
          issuer: iss,
        },
        ctx,
      );
      if (!result.ok) {
        const code = result.reuseDetected ? 400 : 400;
        return reply.code(code).send({ error: result.error });
      }
      return reply.send({
        access_token: result.accessToken,
        token_type: "Bearer",
        expires_in: result.expiresIn,
        refresh_token: result.refreshToken,
        iss,
      });
    }
    if (grantType === "client_credentials") {
      if (!body.client_id || !body.client_secret || !body.resource) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const agentName = body.agent_name ?? body.agent_id;
      if (!agentName) {
        return reply.code(400).send({ error: "invalid_request", error_description: "agent_name required" });
      }
      const ttl = Number(body.ttl_seconds ?? 3600);
      const result = await issueClientCredentialsToken(
        pool,
        config,
        keyProvider,
        {
          clientId: body.client_id,
          clientSecret: body.client_secret,
          agentName,
          resource: body.resource,
          issuer: iss,
          ttlSeconds: ttl,
          actingForIdentityId: body.acting_for,
          role: body.role,
        },
        ctx,
      );
      if ("error" in result) {
        const status = result.error === "invalid_client" ? 401 : 400;
        return reply
          .code(status)
          .send({ error: result.error, error_description: result.errorDescription });
      }
      return reply.send({
        access_token: result.accessToken,
        token_type: "Bearer",
        expires_in: result.expiresIn,
        reqaml_role: result.role,
      });
    }
    return reply.code(400).send({ error: "unsupported_grant_type" });
  });

  app.post("/oauth/revoke", async (req, reply) => {
    const host = hostFromRequest(req, config);
    const body = req.body as Record<string, string | undefined>;
    if (!body.token) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    await revokeToken(
      pool,
      config,
      keyProvider,
      body.token,
      body.token_type_hint,
      requestContext(req),
      host,
    );
    return reply.code(200).send({});
  });

  app.post("/oauth/register", async (_req, reply) => {
    await writeAuthAudit(pool, {
      eventType: "client.register",
      outcome: "deny",
      detail: { reason: "dcr_disabled" },
    });
    return reply.code(403).send({
      error: "access_denied",
      error_description: "Dynamic client registration is disabled",
    });
  });

  app.post("/api/v1/auth/local/login", async (req, reply) => {
    if (!localLoginAllowed(profile)) {
      return reply.code(404).send({ error: "local_login_disabled" });
    }
    const body = req.body as {
      username?: string;
      password?: string;
      h?: string;
      handoff?: string;
      mfa_code?: string;
      enrollment_ticket?: string;
      csrf_token?: string;
    };
    const handoffId = body.h ?? body.handoff;
    if (!body.username || !body.password || !handoffId) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const handoff = await loadLoginHandoff(pool, handoffId);
    if (!handoff) {
      return reply.code(400).send({ error: "invalid_request", error_description: "handoff expired" });
    }
    const auth = await authenticateLocalUser(
      pool,
      profile,
      body.username,
      body.password,
      requestContext(req),
    );
    if (!auth.ok) {
      const status = auth.error === "account_locked" ? 423 : 401;
      return reply.code(status).send({ error: auth.error });
    }
    let mfaVerified = !auth.needsMfa;
    if (await needsMfaEnrollment(pool, auth.identityId)) {
      if (!body.enrollment_ticket) {
        const enroll = await startMfaEnrollment(
          pool,
          keyProvider,
          auth.identityId,
          `${body.username}`,
        );
        return reply.send({
          status: "mfa_enrollment_required",
          enrollment_ticket: enroll.ticketId,
          otpauth_uri: enroll.otpauthUri,
        });
      }
      if (!body.mfa_code) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const confirmed = await confirmMfaEnrollment(
        pool,
        keyProvider,
        body.enrollment_ticket,
        body.mfa_code,
      );
      if (!confirmed.ok || confirmed.identityId !== auth.identityId) {
        await reserveLoginAttempt(pool, auth.identityId);
        await recordIpLoginFailure(pool, req.ip);
        return reply.code(401).send({ error: "invalid_mfa" });
      }
      await clearLoginFailures(pool, auth.identityId);
      mfaVerified = true;
    } else if (auth.needsMfa) {
      if (!body.mfa_code) {
        return reply.send({ status: "mfa_required", identity_id: auth.identityId });
      }
      mfaVerified = await verifyMfaForLogin(
        pool,
        keyProvider,
        auth.identityId,
        body.mfa_code,
      );
      if (!mfaVerified) {
        await reserveLoginAttempt(pool, auth.identityId);
        await recordIpLoginFailure(pool, req.ip);
        await writeAuthAudit(pool, {
          eventType: "mfa.verify",
          outcome: "failure",
          identityId: auth.identityId,
          ip: req.ip,
        });
        return reply.code(401).send({ error: "invalid_mfa" });
      }
      await clearLoginFailures(pool, auth.identityId);
      await writeAuthAudit(pool, {
        eventType: "mfa.verify",
        outcome: "success",
        identityId: auth.identityId,
        ip: req.ip,
      });
    }
    const code = await createAuthorizationCode(pool, {
      clientId: handoff.clientId,
      identityId: auth.identityId,
      redirectUri: handoff.redirectUri,
      codeChallenge: handoff.codeChallenge,
      codeChallengeMethod: "S256",
      resource: handoff.resource,
      scope: handoff.scope,
      state: handoff.state,
      mfaVerified,
    });
    await deleteLoginHandoff(pool, handoffId);
    const host = hostFromRequest(req, config);
    const iss = issuerUrl(config, host);
    if (handoff.redirectUri.endsWith("/oauth/web/callback")) {
      const exchange = await exchangeAuthorizationCode(
        pool,
        config,
        keyProvider,
        {
          code,
          clientId: handoff.clientId,
          redirectUri: handoff.redirectUri,
          codeVerifier: handoff.codeVerifier ?? "",
          resource: handoff.resource,
          issuer: iss,
        },
        requestContext(req),
      );
      if (!exchange.ok) {
        return reply.code(400).send({ error: exchange.error });
      }
      const session = await createWebSession(pool, keyProvider, {
        identityId: auth.identityId,
        refreshToken: exchange.refreshToken,
        mfaVerified,
      });
      setSessionCookies(reply, config, session.sessionId, session.csrfToken);
      return reply.send({ redirect: "/app", csrf_token: session.csrfToken });
    }
    const redirect = new URL(handoff.redirectUri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", handoff.state);
    redirect.searchParams.set("iss", iss);
    return reply.send({ redirect: redirect.toString() });
  });

  app.get("/oauth/web/callback", async (req, reply) => {
    return reply.redirect("/login");
  });

  app.get("/api/v1/auth/session", async (req, reply) => {
    const sessionRaw = req.cookies?.[SESSION_COOKIE];
    const sessionId = verifySessionCookie(sessionRaw, config);
    if (!sessionId) return reply.send({ authenticated: false });
    const session = await loadWebSession(pool, sessionId);
    if (!session) return reply.send({ authenticated: false });
    return reply.send({ authenticated: true, identity_id: session.identityId });
  });

  app.post("/api/v1/auth/signout", async (req, reply) => {
    const sessionRaw = req.cookies?.[SESSION_COOKIE];
    const sessionId = verifySessionCookie(sessionRaw, config);
    if (sessionId) {
      const session = await loadWebSession(pool, sessionId);
      if (session && assertCsrf(req, session.csrfToken)) {
        const refresh = (
          await keyProvider.unwrapSecret(session.refreshTokenCiphertext, "web-session")
        ).toString("utf8");
        await revokeToken(
          pool,
          config,
          keyProvider,
          refresh,
          "refresh_token",
          requestContext(req),
          hostFromRequest(req, config),
        );
      }
      await revokeWebSession(pool, sessionId);
    }
    clearSessionCookies(reply);
    return reply.send({ ok: true });
  });

  app.get("/api/v1/auth/upstream/connectors", async (req, reply) => {
    const { resolveRequestAuth } = await import("./request-auth.js");
    const auth = await resolveRequestAuth(req, pool, config, keyProvider);
    if (!auth) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const r = await pool.query(
      `SELECT id, client_id, protocol, issuer, enabled FROM upstream_connectors ORDER BY id`,
    );
    return reply.send({ connectors: r.rows });
  });
}
