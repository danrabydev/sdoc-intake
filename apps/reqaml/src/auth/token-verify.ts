import { jwtVerify, type JWTPayload } from "jose";
import type pg from "pg";
import type { AppConfig } from "../config.js";
import { getPublicJwks } from "../key/signing.js";
import { issuerUrl } from "./resources.js";

export type VerifiedAccessToken = JWTPayload & {
  sub: string;
  aud: string | string[];
  client_id?: string;
  auth_time?: number;
  amr?: string[];
};

export async function verifyAccessToken(
  pool: pg.Pool,
  config: AppConfig,
  token: string,
  expectedAudience: string,
  reqHost?: string,
): Promise<VerifiedAccessToken> {
  const iss = issuerUrl(config, reqHost);
  const jwks = await getPublicJwks(pool);
  if (!jwks.keys.length) {
    throw new Error("no_signing_keys");
  }
  const { importJWK } = await import("jose");
  let lastErr: unknown;
  for (const jwk of jwks.keys) {
    try {
      const key = await importJWK(jwk, jwk.alg ?? "ES256");
      const { payload } = await jwtVerify(token, key, {
        issuer: iss,
        audience: expectedAudience,
      });
      const jti = payload.jti;
      if (jti) {
        const revoked = await pool.query(
          `SELECT 1 FROM oauth_access_revocations WHERE jti = $1`,
          [jti],
        );
        if (revoked.rowCount) {
          throw new Error("token_revoked");
        }
      }
      return payload as VerifiedAccessToken;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("invalid_token");
}

export function wwwAuthenticateResource(
  config: AppConfig,
  resourceMetadataUrl: string,
): string {
  return `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl}"`;
}
