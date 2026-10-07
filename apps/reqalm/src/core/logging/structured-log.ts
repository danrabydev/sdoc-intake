import type { FastifyBaseLogger } from "fastify";
import { redactForLog } from "./redact.js";

export type OperationLogFields = {
  requestId: string;
  operation: string;
  outcome: "allow" | "deny" | "error";
  permission?: string;
  identityId?: string | null;
  projectId?: string | null;
  durationMs: number;
  detail?: Record<string, unknown>;
};

export function logOperation(logger: FastifyBaseLogger, fields: OperationLogFields): void {
  logger.info(
    {
      reqalm: redactForLog({
        request_id: fields.requestId,
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
