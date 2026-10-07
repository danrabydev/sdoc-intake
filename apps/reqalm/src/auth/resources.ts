import type { AppConfig } from "../config.js";
import { isProduction } from "../config.js";

export type OAuthResource = {
  id: string;
  canonicalUri: string;
  protectedMetadataPath: string;
};

export function issuerUrl(config: AppConfig, reqHost?: string): string {
  const explicit = process.env.REQALM_ISSUER_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (isProduction(config)) {
    throw new Error("REQALM_ISSUER_URL is required in production");
  }
  if (reqHost) {
    return `http://${reqHost.replace(/\/$/, "")}`;
  }
  return `http://localhost:${config.REQALM_PORT}`;
}

export function apiResource(config: AppConfig, reqHost?: string): OAuthResource {
  const base = issuerUrl(config, reqHost);
  return {
    id: "reqalm-api",
    canonicalUri: `${base}/api`,
    protectedMetadataPath: "/.well-known/oauth-protected-resource/api",
  };
}

export function mcpResource(config: AppConfig, reqHost?: string): OAuthResource {
  const base = issuerUrl(config, reqHost);
  return {
    id: "reqalm-mcp",
    canonicalUri: `${base}/mcp`,
    protectedMetadataPath: "/.well-known/oauth-protected-resource/mcp",
  };
}

export function resolveResource(
  config: AppConfig,
  resourceParam: string | undefined,
  reqHost?: string,
): OAuthResource {
  const api = apiResource(config, reqHost);
  const mcp = mcpResource(config, reqHost);
  if (!resourceParam || resourceParam === api.canonicalUri) return api;
  if (resourceParam === mcp.canonicalUri) return mcp;
  throw new Error("invalid_target");
}
