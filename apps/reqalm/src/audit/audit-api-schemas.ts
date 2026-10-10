import { z } from "zod";
import { pageQuerySchema } from "../core/paging.js";
import { SLUG_ID } from "../http/project-id.js";

/** Identity slug (actor filter). */
export const AUDIT_ACTOR_ID = SLUG_ID;

/** Business operation or auth event_type. */
export const AUDIT_ACTION = /^[a-z][a-z0-9._-]{0,127}$/;

/** Persisted audit_events.target_type values. */
export const AUDIT_TARGET_TYPE = /^[a-z][a-z0-9_]{0,63}$/;

/** UTC instant with Z suffix (bounded parsing). */
export const AUDIT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

export const MAX_AUDIT_RANGE_MS = 90 * 24 * 60 * 60 * 1000;

const optionalInstant = z
  .string()
  .regex(AUDIT_INSTANT, "invalid instant")
  .optional();

export type ResolvedAuditBounds =
  | { ok: true; from: string; to: string }
  | { ok: false; message: string; path: "from" | "to" };

/** Format for SQL timestamptz params (UTC Z, preserves fractional seconds). */
export function formatAuditInstant(d: Date): string {
  return d.toISOString();
}

/**
 * Resolve effective [from, to] for audit queries. Default window is the last 90 days through now.
 * Explicit ranges may not span more than 90 days.
 */
function instantMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function resolveAuditTimeBounds(
  from: string | undefined,
  to: string | undefined,
  nowMs: number = Date.now(),
): ResolvedAuditBounds {
  const now = new Date(nowMs);
  if (from && instantMs(from) === null) {
    return { ok: false, message: "invalid instant", path: "from" };
  }
  if (to && instantMs(to) === null) {
    return { ok: false, message: "invalid instant", path: "to" };
  }

  if (from && to) {
    const fromMs = instantMs(from)!;
    const toMs = instantMs(to)!;
    if (toMs < fromMs) {
      return { ok: false, message: "to before from", path: "to" };
    }
    if (toMs - fromMs > MAX_AUDIT_RANGE_MS) {
      return { ok: false, message: "time range too wide", path: "to" };
    }
    return { ok: true, from, to };
  }

  if (from && !to) {
    const fromMs = instantMs(from)!;
    const cappedToMs = Math.min(now.getTime(), fromMs + MAX_AUDIT_RANGE_MS);
    if (cappedToMs < fromMs) {
      return { ok: false, message: "to before from", path: "to" };
    }
    return { ok: true, from, to: formatAuditInstant(new Date(cappedToMs)) };
  }

  if (!from && to) {
    const toMs = instantMs(to)!;
    const fromMs = toMs - MAX_AUDIT_RANGE_MS;
    return { ok: true, from: formatAuditInstant(new Date(fromMs)), to };
  }

  return {
    ok: true,
    from: formatAuditInstant(new Date(nowMs - MAX_AUDIT_RANGE_MS)),
    to: formatAuditInstant(now),
  };
}

const auditFilterBase = pageQuerySchema.extend({
  actor: z.string().regex(AUDIT_ACTOR_ID, "invalid actor").optional(),
  action: z.string().regex(AUDIT_ACTION, "invalid action").optional(),
  target_type: z.string().regex(AUDIT_TARGET_TYPE, "invalid target_type").optional(),
  from: optionalInstant,
  to: optionalInstant,
});

export const auditFilterQuerySchema = auditFilterBase
  .superRefine((q, ctx) => {
    const bounds = resolveAuditTimeBounds(q.from, q.to);
    if (!bounds.ok) {
      ctx.addIssue({ code: "custom", message: bounds.message, path: [bounds.path] });
    }
  })
  .transform((q) => {
    const bounds = resolveAuditTimeBounds(q.from, q.to);
    if (!bounds.ok) {
      throw new Error("resolveAuditTimeBounds failed after superRefine");
    }
    return { ...q, from: bounds.from, to: bounds.to };
  });

export type AuditFilterQuery = z.infer<typeof auditFilterQuerySchema>;

const AUDIT_QUERY_PARAM_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["actor", AUDIT_ACTOR_ID],
  ["action", AUDIT_ACTION],
  ["target_type", AUDIT_TARGET_TYPE],
  ["from", AUDIT_INSTANT],
  ["to", AUDIT_INSTANT],
];

/** Redact invalid audit list filter values in request URLs (logging / telemetry). */
export function redactInvalidAuditQueryParams(url: string): string {
  if (!url.includes("/audit-events")) return url;
  const qIdx = url.indexOf("?");
  if (qIdx === -1) return url;
  const pathPart = url.slice(0, qIdx);
  const query = url.slice(qIdx + 1);
  const params = new URLSearchParams(query);
  for (const [key, valid] of AUDIT_QUERY_PARAM_RULES) {
    const val = params.get(key);
    if (val !== null && !valid.test(val)) {
      params.set(key, "[invalid]");
    }
  }
  const next = params.toString();
  return next ? `${pathPart}?${next}` : pathPart;
}
