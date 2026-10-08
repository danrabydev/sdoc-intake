import type pg from "pg";

type PgQueryable = Pick<pg.Pool, "query">;

export type BusinessAuditInput = {
  requestId: string;
  traceId?: string | null;
  operation: string;
  permission?: string | null;
  outcome: "allow" | "deny" | "error";
  identityId?: string | null;
  clientId?: string | null;
  agentName?: string | null;
  tokenRole?: string | null;
  actingFor?: string | null;
  projectId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
};

/** Business-operation audit (append-only `audit_events`). Auth login/token events stay in `auth_audit_events`. */
export async function writeBusinessAudit(
  pool: PgQueryable,
  input: BusinessAuditInput,
): Promise<void> {
  await pool.query(
    `
    INSERT INTO audit_events (
      request_id, trace_id, operation, permission, outcome,
      identity_id, client_id, agent_name, token_role, acting_for,
      project_id, target_type, target_id, detail
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
  `,
    [
      input.requestId,
      input.traceId ?? null,
      input.operation,
      input.permission ?? null,
      input.outcome,
      input.identityId ?? null,
      input.clientId ?? null,
      input.agentName ?? null,
      input.tokenRole ?? null,
      input.actingFor ?? null,
      input.projectId ?? null,
      input.targetType ?? null,
      input.targetId ?? null,
      JSON.stringify(input.detail ?? {}),
    ],
  );
}
