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
import {
  authenticateLocalUser,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeToken,
  validateAuthorizeRequest,
  verifyMfaForLogin,
} from "./oauth-service.js";
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
      grant_types_supported: ["authorization_code", "refresh_token"],
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
    const pending = Buffer.from(
      JSON.stringify({
        clientId: validated.client.clientId,
        redirectUri: validated.redirectUri,
        codeChallenge: validated.codeChallenge,
        codeChallengeMethod: "S256",
        resource: validated.resource.canonicalUri,
        scope: validated.scope,
        state: validated.state,
      }),
    ).toString("base64url");
    const loginUrl = `/login?pending=${pending}&state=${encodeURIComponent(validated.state ?? "")}`;
    return reply.redirect(loginUrl);
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
    return reply.code(400).send({ error: "unsupported_grant_type" });
  });

  app.post("/oauth/revoke", async (req, reply) => {
    const body = req.body as Record<string, string | undefined>;
    if (!body.token) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    await revokeToken(pool, body.token, body.token_type_hint, requestContext(req));
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
      pending?: string;
      mfa_code?: string;
    };
    if (!body.username || !body.password || !body.pending) {
      return reply.code(400).send({ error: "invalid_request" });
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
    if (auth.needsMfa) {
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
        await writeAuthAudit(pool, {
          eventType: "mfa.verify",
          outcome: "failure",
          identityId: auth.identityId,
          ip: req.ip,
        });
        return reply.code(401).send({ error: "invalid_mfa" });
      }
      await writeAuthAudit(pool, {
        eventType: "mfa.verify",
        outcome: "success",
        identityId: auth.identityId,
        ip: req.ip,
      });
    }
    const pending = JSON.parse(
      Buffer.from(body.pending, "base64url").toString("utf8"),
    ) as {
      clientId: string;
      redirectUri: string;
      codeChallenge: string;
      resource: string;
      scope?: string;
      state?: string;
    };
    const code = await createAuthorizationCode(pool, {
      clientId: pending.clientId,
      identityId: auth.identityId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: "S256",
      resource: pending.resource,
      scope: pending.scope,
      state: pending.state,
      mfaVerified,
    });
    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", pending.state ?? "");
    redirect.searchParams.set("iss", issuerUrl(config, hostFromRequest(req, config)));
    return reply.send({ redirect: redirect.toString() });
  });

  app.get("/api/v1/auth/upstream/connectors", async (_req, reply) => {
    const r = await pool.query(
      `SELECT id, client_id, protocol, issuer, enabled FROM upstream_connectors ORDER BY id`,
    );
    return reply.send({ connectors: r.rows });
  });
}
