import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { PageQuery, PageResult } from "../../core/paging.js";
import type { RequestContext } from "../../core/request-context.js";
import {
  auditClientIpExposureAllowed,
  platformAuditReadAllowed,
  redactAuditDetail,
} from "../../audit/audit-api-redact.js";
import type { AuditFilterQuery } from "../../audit/audit-api-schemas.js";

export type AuditEventDto = {
  id: string;
  source: "business" | "auth";
  occurred_at: string;
  action: string;
  outcome: string;
  actor_identity_id: string | null;
  actor_client_id: string | null;
  agent_name: string | null;
  token_role: string | null;
  acting_for: string | null;
  project_id: string | null;
  target_type: string | null;
  target_id: string | null;
  detail: Record<string, unknown>;
  client_ip: string | null;
};

export type ListProjectAuditInput = AuditFilterQuery & { projectId: string };
export type ListPlatformAuditInput = AuditFilterQuery;

type FilterParams = {
  actor: string | null;
  action: string | null;
  targetType: string | null;
  from: string | null;
  to: string | null;
};

type BusinessRow = {
  id: string;
  occurred_at: string;
  operation: string;
  outcome: string;
  identity_id: string | null;
  client_id: string | null;
  agent_name: string | null;
  token_role: string | null;
  acting_for: string | null;
  project_id: string | null;
  target_type: string | null;
  target_id: string | null;
  detail: Record<string, unknown>;
};

type AuthRow = {
  id: string;
  occurred_at: string;
  event_type: string;
  outcome: string;
  identity_id: string | null;
  client_id: string | null;
  resource: string | null;
  ip: string | null;
  detail: Record<string, unknown>;
};

function filterParams(input: AuditFilterQuery): FilterParams {
  return {
    actor: input.actor ?? null,
    action: input.action ?? null,
    targetType: input.target_type ?? null,
    from: input.from ?? null,
    to: input.to ?? null,
  };
}

function appendFilters(
  clauses: string[],
  params: unknown[],
  f: FilterParams,
  opts: { operationCol: string; includeTargetType: boolean },
): void {
  if (f.actor) {
    params.push(f.actor);
    clauses.push(`identity_id = $${params.length}`);
  }
  if (f.action) {
    params.push(f.action);
    clauses.push(`${opts.operationCol} = $${params.length}`);
  }
  if (f.targetType && opts.includeTargetType) {
    params.push(f.targetType);
    clauses.push(`target_type = $${params.length}`);
  }
  if (f.from) {
    params.push(f.from);
    clauses.push(`occurred_at >= $${params.length}::timestamptz`);
  }
  if (f.to) {
    params.push(f.to);
    clauses.push(`occurred_at <= $${params.length}::timestamptz`);
  }
}

function businessWhere(projectId: string | null, f: FilterParams) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (projectId === null) {
    clauses.push("project_id IS NULL");
  } else {
    params.push(projectId);
    clauses.push(`project_id = $${params.length}`);
  }
  appendFilters(clauses, params, f, { operationCol: "operation", includeTargetType: true });
  return { sql: clauses.join(" AND "), params };
}

function authWhere(f: FilterParams) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (f.targetType) {
    return { sql: "FALSE", params, includeAuth: false };
  }
  appendFilters(clauses, params, f, { operationCol: "event_type", includeTargetType: false });
  const sql = clauses.length ? clauses.join(" AND ") : "TRUE";
  return { sql, params, includeAuth: true };
}

function mapBusiness(row: BusinessRow): AuditEventDto {
  return {
    id: `b:${row.id}`,
    source: "business",
    occurred_at: row.occurred_at,
    action: row.operation,
    outcome: row.outcome,
    actor_identity_id: row.identity_id,
    actor_client_id: row.client_id,
    agent_name: row.agent_name,
    token_role: row.token_role,
    acting_for: row.acting_for,
    project_id: row.project_id,
    target_type: row.target_type,
    target_id: row.target_id,
    detail: redactAuditDetail(row.detail),
    client_ip: null,
  };
}

function mapAuth(row: AuthRow, exposeIp: boolean): AuditEventDto {
  return {
    id: `a:${row.id}`,
    source: "auth",
    occurred_at: row.occurred_at,
    action: row.event_type,
    outcome: row.outcome,
    actor_identity_id: row.identity_id,
    actor_client_id: row.client_id,
    agent_name: null,
    token_role: null,
    acting_for: null,
    project_id: null,
    target_type: row.resource ? "auth_resource" : null,
    target_id: row.resource,
    detail: redactAuditDetail(row.detail),
    client_ip: exposeIp ? row.ip : null,
  };
}

async function listBusinessPage(
  ctx: RequestContext,
  projectId: string | null,
  input: PageQuery & AuditFilterQuery,
): Promise<ServiceResult<PageResult<AuditEventDto>>> {
  const f = filterParams(input);
  const where = businessWhere(projectId, f);
  const count = await ctx.pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM audit_events WHERE ${where.sql}`,
    where.params,
  );
  const total = count.rows[0]?.c ?? 0;
  const limitIdx = where.params.length + 1;
  const offsetIdx = where.params.length + 2;
  const res = await ctx.pool.query<BusinessRow>(
    `SELECT sorted.id::text AS id, sorted.occurred_at::text AS occurred_at, sorted.operation, sorted.outcome,
            sorted.identity_id, sorted.client_id, sorted.agent_name, sorted.token_role, sorted.acting_for,
            sorted.project_id, sorted.target_type, sorted.target_id, sorted.detail
     FROM (
       SELECT id, occurred_at, operation, outcome, identity_id, client_id, agent_name, token_role, acting_for,
              project_id, target_type, target_id, detail
       FROM audit_events
       WHERE ${where.sql}
     ) sorted
     ORDER BY sorted.occurred_at DESC, sorted.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...where.params, input.limit, input.offset],
  );
  return ok({
    items: res.rows.map(mapBusiness),
    limit: input.limit,
    offset: input.offset,
    total,
  });
}

export async function listProjectAuditEvents(
  ctx: RequestContext,
  input: ListProjectAuditInput,
): Promise<ServiceResult<PageResult<AuditEventDto>>> {
  return listBusinessPage(ctx, input.projectId, input);
}

export async function listPlatformAuditEvents(
  ctx: RequestContext,
  input: ListPlatformAuditInput,
): Promise<ServiceResult<PageResult<AuditEventDto>>> {
  if (!(await platformAuditReadAllowed(ctx))) {
    return err("not_found", "Not found");
  }
  const exposeIp = await auditClientIpExposureAllowed(ctx);
  const f = filterParams(input);
  const biz = businessWhere(null, f);
  const auth = authWhere(f);

  let total = 0;
  const bizCount = await ctx.pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM audit_events WHERE ${biz.sql}`,
    biz.params,
  );
  total += bizCount.rows[0]?.c ?? 0;
  if (auth.includeAuth) {
    const authCount = await ctx.pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM auth_audit_events WHERE ${auth.sql}`,
      auth.params,
    );
    total += authCount.rows[0]?.c ?? 0;
  }

  const unionParts: string[] = [];
  const unionParams: unknown[] = [...biz.params];
  unionParts.push(`
    SELECT 'business' AS source, id AS sort_id, occurred_at AS sort_at, id::text, occurred_at::text, operation, outcome,
           identity_id, client_id, agent_name, token_role, acting_for, project_id, target_type, target_id, detail,
           NULL::text AS event_type, NULL::text AS resource, NULL::text AS ip
    FROM audit_events WHERE ${biz.sql}`);

  if (auth.includeAuth) {
    const authStart = unionParams.length + 1;
    const authSql = auth.sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + authStart - 1}`);
    unionParams.push(...auth.params);
    unionParts.push(`
    SELECT 'auth' AS source, id AS sort_id, occurred_at AS sort_at, id::text, occurred_at::text, event_type AS operation,
           outcome, identity_id, client_id, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
           detail, event_type, resource, ip
    FROM auth_audit_events WHERE ${authSql}`);
  }

  const limitIdx = unionParams.length + 1;
  const offsetIdx = unionParams.length + 2;
  const res = await ctx.pool.query<
    BusinessRow & { source: string; event_type?: string | null; resource?: string | null; ip?: string | null }
  >(
    `SELECT source, id, occurred_at, operation, outcome, identity_id, client_id, agent_name, token_role, acting_for,
            project_id, target_type, target_id, detail, event_type, resource, ip
     FROM (${unionParts.join(" UNION ALL ")}) u
     ORDER BY sort_at DESC, sort_id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...unionParams, input.limit, input.offset],
  );

  const items = res.rows.map((row) =>
    row.source === "auth"
      ? mapAuth(
          {
            id: row.id,
            occurred_at: row.occurred_at,
            event_type: row.event_type ?? row.operation,
            outcome: row.outcome,
            identity_id: row.identity_id,
            client_id: row.client_id,
            resource: row.resource ?? null,
            ip: row.ip ?? null,
            detail: row.detail,
          },
          exposeIp,
        )
      : mapBusiness(row),
  );
  return ok({ items, limit: input.limit, offset: input.offset, total });
}
