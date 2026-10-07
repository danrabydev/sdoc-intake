import type { AppConfig } from "../config.js";

export type OAuthResource = {
  id: string;
  canonicalUri: string;
  protectedMetadataPath: string;
};

export function issuerUrl(config: AppConfig, reqHost?: string): string {
  const explicit = process.env.REQAML_ISSUER_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const host = reqHost ?? `127.0.0.1:${config.REQAML_PORT}`;
  return `http://${host}`;
}

export function apiResource(config: AppConfig, reqHost?: string): OAuthResource {
  const base = issuerUrl(config, reqHost);
  return {
    id: "reqaml-api",
    canonicalUri: `${base}/api`,
    protectedMetadataPath: "/.well-known/oauth-protected-resource/api",
  };
}

export function mcpResource(config: AppConfig, reqHost?: string): OAuthResource {
  const base = issuerUrl(config, reqHost);
  return {
    id: "reqaml-mcp",
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
