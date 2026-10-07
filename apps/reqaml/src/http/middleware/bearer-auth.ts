import type { FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import type { AppConfig } from "../../config.js";
import { verifyAccessToken, wwwAuthenticateResource, type VerifiedAccessToken } from "../../auth/token-verify.js";
import { apiResource, mcpResource } from "../../auth/resources.js";

export type AuthedRequest = FastifyRequest & {
  accessToken?: VerifiedAccessToken;
};

export function createBearerGuard(
  pool: pg.Pool,
  config: AppConfig,
  audience: "api" | "mcp",
) {
  return async function bearerGuard(
    req: AuthedRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      const host = req.headers.host ?? `127.0.0.1:${config.REQAML_PORT}`;
      const resource =
        audience === "api"
          ? apiResource(config, host)
          : mcpResource(config, host);
      const metaUrl = `http://${host}${resource.protectedMetadataPath}`;
      return reply
        .header("WWW-Authenticate", wwwAuthenticateResource(config, metaUrl))
        .code(401)
        .send({ error: "invalid_token" });
    }
    const token = header.slice("Bearer ".length);
    const host = req.headers.host ?? `127.0.0.1:${config.REQAML_PORT}`;
    const expected =
      audience === "api"
        ? apiResource(config, host).canonicalUri
        : mcpResource(config, host).canonicalUri;
    try {
      req.accessToken = await verifyAccessToken(
        pool,
        config,
        token,
        expected,
        host,
      );
    } catch {
      const metaUrl = `http://${host}${
        audience === "api"
          ? apiResource(config, host).protectedMetadataPath
          : mcpResource(config, host).protectedMetadataPath
      }`;
      return reply
        .header("WWW-Authenticate", wwwAuthenticateResource(config, metaUrl))
        .code(401)
        .send({ error: "invalid_token" });
    }
  };
}
