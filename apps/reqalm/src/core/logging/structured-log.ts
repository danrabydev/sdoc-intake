import type { FastifyBaseLogger } from "fastify";
import { redactForLog } from "./redact.js";

/** Test-only sink for operation log fields (in-process tests). */
let captureOperationLogs: OperationLogFields[] | null = null;

export function bindOperationLogCapture(sink: OperationLogFields[] | null): void {
  captureOperationLogs = sink;
}

export type OperationLogFields = {
  requestId: string;
  traceId?: string | null;
  spanId?: string | null;
  operation: string;
  outcome: "allow" | "deny" | "error";
  permission?: string;
  identityId?: string | null;
  projectId?: string | null;
  durationMs: number;
  detail?: Record<string, unknown>;
};

export function logOperation(logger: FastifyBaseLogger, fields: OperationLogFields): void {
  captureOperationLogs?.push(fields);
  logger.info(
    {
      reqalm: redactForLog({
        request_id: fields.requestId,
        trace_id: fields.traceId ?? undefined,
        span_id: fields.spanId ?? undefined,
        operation: fields.operation,
        outcome: fields.outcome,
        permission: fields.permission,
        identity_id: fields.identityId,
        project_id: fields.projectId,
        duration_ms: fields.durationMs,
        ...fields.detail,
      }),
    },
    "operation",
  );
}
