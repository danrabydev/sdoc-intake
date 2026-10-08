import { trace, SpanStatusCode } from "@opentelemetry/api";
import { authorize, projectIdsWithPermission } from "../rbac/enforce.js";
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
  /** Declares that any authenticated caller may run it (no permission). Routes must say one or the other. */
  authenticatedOnly?: true;
  /** When true, caller must have a live project grant before permission check; else not_found. */
  projectScoped?: boolean;
  projectIdFromInput?: (input: TIn) => string | undefined;
  /** Cross-project list/read: skip union RBAC gate; filter by per-project permission in execute. */
  listScope?: true;
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

/**
 * One operation call. `projectId` is the project scope, resolved before any input validation;
 * `parseInput` runs only after authentication, project scope and permission pass.
 */
export type OperationCall<TIn> = {
  projectId: string | undefined;
  parseInput: () => ServiceResult<TIn>;
};

/** Run an operation on already-validated input (non-HTTP callers and tests). */
export async function runOperation<TIn, TOut>(
  ctx: RequestContext,
  def: OperationDef<TIn, TOut>,
  input: TIn,
): Promise<ServiceResult<TOut>> {
  const meta = def.auditMeta?.(input) ?? {};
  const projectId = def.projectIdFromInput?.(input) ?? meta.projectId ?? undefined;
  return runPipeline(ctx, def, projectId, meta, () => ok(input));
}

/**
 * Run an operation for a request: authenticate → project scope → permission → validate input → execute,
 * then append-only audit and log. Every outcome, including a validation failure, is audited.
 */
export async function runOperationCall<TIn, TOut>(
  ctx: RequestContext,
  def: OperationDef<TIn, TOut>,
  call: OperationCall<TIn>,
): Promise<ServiceResult<TOut>> {
  return runPipeline(ctx, def, call.projectId, {}, call.parseInput);
}

async function runPipeline<TIn, TOut>(
  ctx: RequestContext,
  def: OperationDef<TIn, TOut>,
  projectId: string | undefined,
  initialMeta: OperationAuditMeta,
  parseInput: () => ServiceResult<TIn>,
): Promise<ServiceResult<TOut>> {
  const tracer = trace.getTracer(OP_TRACER);
  return tracer.startActiveSpan(`operation ${def.name}`, async (span) => {
    try {
    const started = ctx.clock.now();
    // Before validation only the resolved scope is known; raw input never reaches the audit row.
    let meta = initialMeta;

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
        setSpanError(span, result.ok ? auditOutcome : result.error.code);
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      await recordAudit(
        ctx,
        def as OperationDef<unknown, unknown>,
        auditOutcome,
        { ...meta, projectId: projectId ?? meta.projectId },
        result.ok ? undefined : { error_code: result.error.code },
      );
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

    if (def.listScope && def.projectScoped) {
      ctx.logger.error({ operation: def.name, request_id: ctx.requestId }, "operation_list_scope_conflict");
      return finish(err("internal", "Internal error"), "error", "error");
    }

    if (def.listScope && def.permission) {
      ctx.allowedProjectIds = await projectIdsWithPermission(ctx, def.permission);
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

    if (def.permission && !def.listScope) {
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
      const parsed = parseInput();
      if (!parsed.ok) {
        return finish({ ok: false, error: parsed.error }, serviceOutcomeToAudit(parsed.error.code), "error");
      }
      const input = parsed.data;
      meta = def.auditMeta?.(input) ?? meta;
      if (def.projectScoped && def.projectIdFromInput?.(input) !== projectId) {
        // The validated input names another project than the one scope and RBAC were checked against.
        ctx.logger.error({ operation: def.name, request_id: ctx.requestId }, "operation_scope_mismatch");
        return finish(err("internal", "Internal error"), "error", "error");
      }
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
      setSpanError(span, "internal");
      return finish(err("internal", "Internal error"), "error", "error");
    }
    } finally {
      span.end();
    }
  });
}

export { ok, err };
