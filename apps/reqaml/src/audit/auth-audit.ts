import type pg from "pg";

export type AuthAuditInput = {
  eventType: string;
  outcome: "success" | "failure" | "deny";
  identityId?: string | null;
  clientId?: string | null;
  resource?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detail?: Record<string, unknown>;
};

export async function writeAuthAudit(
  pool: pg.Pool,
  input: AuthAuditInput,
): Promise<void> {
  await pool.query(
    `
    INSERT INTO auth_audit_events
      (event_type, outcome, identity_id, client_id, resource, ip, user_agent, detail)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
  `,
    [
      input.eventType,
      input.outcome,
      input.identityId ?? null,
      input.clientId ?? null,
      input.resource ?? null,
      input.ip ?? null,
      input.userAgent ?? null,
      JSON.stringify(input.detail ?? {}),
    ],
  );
}
