import { trace, SpanStatusCode } from "@opentelemetry/api";
import { authorize } from "../rbac/enforce.js";
import { writeBusinessAudit } from "../audit/business-audit.js";
import { logOperation } from "./logging/structured-log.js";
import type { RequestContext } from "./request-context.js";
import { setSpanError } from "../telemetry/trace-context.js";
import { err, ok, type ServiceErrorCode, type ServiceResult } from "./service-result.js";

export type OperationAuditMeta = {
  projectId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
};

export type OperationDef<TIn, TOut> = {
  name: string;
  /** When set, RBAC must allow this permission (after auth). */
  permission?: string;
  /** When true, caller must have a live project grant before permission check; else not_found. */
  projectScoped?: boolean;
  projectIdFromInput?: (input: TIn) => string | undefined;
  auditMeta?: (input: TIn) => OperationAuditMeta;
  execute: (ctx: RequestContext, input: TIn) => Promise<ServiceResult<TOut>>;
};

const OP_TRACER = "reqalm.operation";

async function recordAudit(
  ctx: RequestContext,
  def: OperationDef<unknown, unknown>,
  outcome: "allow" | "deny" | "error",
  meta: OperationAuditMeta,
  extra?: Record<string, unknown>,
): Promise<void> {
  await writeBusinessAudit(ctx.pool, {
    requestId: ctx.requestId,
    traceId: ctx.traceId,
    operation: def.name,
    permission: def.permission ?? null,
    outcome,
    identityId: ctx.identityId,
    clientId: (ctx.auth?.accessToken.client_id as string | undefined) ?? null,
    agentName: ctx.agentName,
    tokenRole: ctx.tokenRole,
    actingFor: ctx.actingFor,
    projectId: meta.projectId ?? null,
    targetType: meta.targetType ?? null,
    targetId: meta.targetId ?? null,
    detail: { ...meta.detail, ...extra },
  });
}

function serviceOutcomeToAudit(
  code: ServiceErrorCode,
): "allow" | "deny" | "error" {
  if (code === "internal") return "error";
  if (code === "forbidden" || code === "unauthenticated" || code === "not_found") return "deny";
  return "error";
}

function identityKind(ctx: RequestContext): string {
  if (!ctx.auth) return "none";
  const token = ctx.auth.accessToken;
  if (ctx.agentName) return "agent";
  if (token.client_id && !ctx.identityId) return "client";
  return "user";
}

function operationSpanAttributes(
  ctx: RequestContext,
  def: OperationDef<unknown, unknown>,
  projectId: string | undefined,
): Record<string, string | boolean> {
  const attrs: Record<string, string | boolean> = {
    "reqalm.operation": def.name,
    "reqalm.identity.kind": identityKind(ctx),
  };
  if (def.permission) attrs["reqalm.permission"] = def.permission;
  if (projectId) attrs["reqalm.project_id"] = projectId;
  if (ctx.agentName) attrs["reqalm.agent_name"] = ctx.agentName;
  const clientId = ctx.auth?.accessToken.client_id;
  if (typeof clientId === "string") attrs["reqalm.client_id"] = clientId;
  return attrs;
}

export async function runOperation<TIn, TOut>(
  ctx: RequestContext,
  def: OperationDef<TIn, TOut>,
  input: TIn,
): Promise<ServiceResult<TOut>> {
  const tracer = trace.getTracer(OP_TRACER);
  return tracer.startActiveSpan(`operation ${def.name}`, async (span) => {
    try {
    const started = ctx.clock.now();
    const meta = def.auditMeta?.(input) ?? {};
    const projectId = def.projectIdFromInput?.(input) ?? meta.projectId ?? undefined;

    for (const [k, v] of Object.entries(operationSpanAttributes(ctx, def as OperationDef<unknown, unknown>, projectId))) {
      span.setAttribute(k, v);
    }

    const finish = async (
      result: ServiceResult<TOut>,
      auditOutcome: "allow" | "deny" | "error",
      logOutcome: "allow" | "deny" | "error",
    ): Promise<ServiceResult<TOut>> => {
      span.setAttribute("reqalm.outcome", logOutcome);
      if (!result.ok) {
        span.setAttribute("reqalm.error_code", result.error.code);
      }
      if (auditOutcome === "deny" || auditOutcome === "error") {
        setSpanError(span, result.ok ? auditOutcome : result.error.message);
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      await recordAudit(ctx, def as OperationDef<unknown, unknown>, auditOutcome, {
        ...meta,
        projectId: projectId ?? meta.projectId,
      });
      logOperation(ctx.logger, {
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        operation: def.name,
        outcome: logOutcome,
        permission: def.permission,
        identityId: ctx.identityId,
        projectId: projectId ?? meta.projectId ?? null,
        durationMs: ctx.clock.now() - started,
      });
      return result;
    };

    if (!ctx.auth || !ctx.identityId) {
      return finish(
        err("unauthenticated", "Authentication required"),
        "deny",
        "deny",
      );
    }

    if (def.projectScoped) {
      if (!projectId || !ctx.projectIds.has(projectId)) {
        return finish(
          err("not_found", "Project not found"),
          "deny",
          "deny",
        );
      }
    }

    if (def.permission) {
      const allowed = await authorize(
        ctx.pool,
        ctx.identityId,
        def.permission,
        projectId,
        ctx.auth.accessToken,
      );
      if (!allowed) {
        return finish(err("forbidden", "Insufficient permission"), "deny", "deny");
      }
    }

    try {
      const result = await def.execute(ctx, input);
      if (result.ok) {
        return finish(result, "allow", "allow");
      }
      const auditOutcome = serviceOutcomeToAudit(result.error.code);
      return finish(result, auditOutcome, auditOutcome === "allow" ? "allow" : auditOutcome);
    } catch (e) {
      ctx.logger.error(
        { err: e, operation: def.name, request_id: ctx.requestId },
        "operation_failed",
      );
      setSpanError(span, e instanceof Error ? e.message : "Internal error");
      return finish(err("internal", "Internal error"), "error", "error");
    }
    } finally {
      span.end();
    }
  });
}

/** Authenticated read with no permission (e.g. /me). */
export async function runAuthenticated<TOut>(
  ctx: RequestContext,
  name: string,
  execute: (ctx: RequestContext) => Promise<ServiceResult<TOut>>,
): Promise<ServiceResult<TOut>> {
  const def: OperationDef<Record<string, never>, TOut> = {
    name,
    execute: async (c) => execute(c),
  };
  return runOperation(ctx, def, {});
}

export { ok, err };
