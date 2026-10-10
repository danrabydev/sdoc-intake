import { redactForLog } from "../core/logging/redact.js";
import type { RequestContext } from "../core/request-context.js";
import { authorize, listActiveRoles } from "../rbac/enforce.js";

const SESSION_KEY = /^session[_-]?id$/i;

/** Platform Security (or Key custodian) may see raw client IPs on auth audit rows. */
export async function auditClientIpExposureAllowed(ctx: RequestContext): Promise<boolean> {
  if (!ctx.identityId || !ctx.auth) return false;
  const platformRoles = await listActiveRoles(ctx.pool, ctx.identityId, undefined);
  return platformRoles.some((r) => r === "Security" || r === "Key custodian");
}

/** Redact audit event detail for API responses (secrets, tokens, session ids). */
export function redactAuditDetail(detail: unknown): Record<string, unknown> {
  const base = redactForLog(detail ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    if (SESSION_KEY.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function platformAuditReadAllowed(ctx: RequestContext): Promise<boolean> {
  if (!ctx.identityId || !ctx.auth) return false;
  return authorize(ctx.pool, ctx.identityId, "audit:read", undefined, ctx.auth.accessToken);
}
