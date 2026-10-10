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

export const auditFilterQuerySchema = pageQuerySchema
  .extend({
    actor: z.string().regex(AUDIT_ACTOR_ID, "invalid actor").optional(),
    action: z.string().regex(AUDIT_ACTION, "invalid action").optional(),
    target_type: z.string().regex(AUDIT_TARGET_TYPE, "invalid target_type").optional(),
    from: optionalInstant,
    to: optionalInstant,
  })
  .superRefine((q, ctx) => {
    if (q.from && q.to) {
      const fromMs = Date.parse(q.from);
      const toMs = Date.parse(q.to);
      if (toMs < fromMs) {
        ctx.addIssue({ code: "custom", message: "to before from", path: ["to"] });
      } else if (toMs - fromMs > MAX_AUDIT_RANGE_MS) {
        ctx.addIssue({ code: "custom", message: "time range too wide", path: ["to"] });
      }
    }
  });

export type AuditFilterQuery = z.infer<typeof auditFilterQuerySchema>;
