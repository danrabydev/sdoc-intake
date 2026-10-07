import type { FastifyRequest } from "fastify";
import type pg from "pg";
import type { AppConfig } from "../config.js";
import type { KeyProvider } from "../key/provider.js";
import type { VerifiedAccessToken } from "./token-verify.js";
import { verifyAccessToken } from "./token-verify.js";
import { apiResource, issuerUrl } from "./resources.js";
import {
  loadWebSession,
  verifySessionCookie,
  SESSION_COOKIE,
} from "./web-session.js";
import { mintAccessFromRefreshPlain } from "./oauth-service.js";

export type ResolvedAuth = {
  accessToken: VerifiedAccessToken;
  rawAccessToken: string;
  fromSession: boolean;
};

export async function resolveRequestAuth(
  req: FastifyRequest,
  pool: pg.Pool,
  config: AppConfig,
  keyProvider: KeyProvider,
): Promise<ResolvedAuth | null> {
  const host = req.headers.host ?? `localhost:${config.REQAML_PORT}`;
  const aud = apiResource(config, host).canonicalUri;
  const iss = issuerUrl(config, host);

  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const raw = header.slice("Bearer ".length);
    try {
      const accessToken = await verifyAccessToken(pool, config, raw, aud, host);
      return { accessToken, rawAccessToken: raw, fromSession: false };
    } catch {
      return null;
    }
  }

  const sessionRaw = req.cookies?.[SESSION_COOKIE];
  const sessionId = verifySessionCookie(sessionRaw, config);
  if (!sessionId) return null;
  const session = await loadWebSession(pool, sessionId);
  if (!session) return null;
  const refreshPlain = (
    await keyProvider.unwrapSecret(session.refreshTokenCiphertext, "web-session")
  ).toString("utf8");
  const raw = await mintAccessFromRefreshPlain(pool, keyProvider, {
    refreshToken: refreshPlain,
    clientId: "reqaml-web",
    resource: aud,
    issuer: iss,
  });
  if (!raw) return null;
  const accessToken = await verifyAccessToken(pool, config, raw, aud, host);
  return { accessToken, rawAccessToken: raw, fromSession: true };
}
