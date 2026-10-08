import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { PageQuery, PageResult } from "../../core/paging.js";
import type { RequestContext } from "../../core/request-context.js";

export type RequirementListFilters = PageQuery & {
  projectId: string;
  kind?: string;
  type?: string;
  status?: string;
  q?: string;
};

export type RequirementSummaryDto = {
  id: string;
  title: string;
  kind: string;
  type: string;
  status: string;
  version_id: string;
  version_n: number;
};

export type RequirementDetailDto = RequirementSummaryDto & {
  project_id: string;
  statement: string;
  attributes: Record<string, string | number | null>;
};

export type RequirementVersionDto = {
  version_id: string;
  version_n: number;
  status: string;
  title: string | null;
  statement: string;
};

export type GetRequirementInput = { projectId: string; requirementId: string };
export type ListRequirementVersionsInput = PageQuery & GetRequirementInput;

const CURRENT_JOIN = `
  FROM requirement_lines l
  JOIN LATERAL (
    SELECT * FROM requirement_versions
    WHERE project_id = l.project_id AND base_uid = l.base_uid
    ORDER BY version_n DESC LIMIT 1
  ) v ON true`;

function escapeIlike(raw: string): string {
  return raw.replace(/[%_\\]/g, (c) => `\\${c}`);
}

type Row = {
  base_uid: string;
  line_title: string;
  kind: string;
  uid: string;
  version_n: number;
  status: string;
  title: string | null;
  statement: string;
  priority: number | null;
  iteration: string | null;
  rbac_op: string | null;
  grooming_state: string | null;
  mint_kind: string | null;
};

function summary(r: Row): RequirementSummaryDto {
  return {
    id: r.base_uid,
    title: r.title ?? r.line_title,
    kind: r.kind,
    type: r.mint_kind ?? r.kind,
    status: r.status,
    version_id: r.uid,
    version_n: r.version_n,
  };
}

function detail(r: Row, projectId: string): RequirementDetailDto {
  return {
    ...summary(r),
    project_id: projectId,
    statement: r.statement,
    attributes: {
      priority: r.priority,
      iteration: r.iteration,
      rbac_op: r.rbac_op,
      grooming_state: r.grooming_state,
      mint_kind: r.mint_kind,
    },
  };
}

export async function listRequirements(
  ctx: RequestContext,
  input: RequirementListFilters,
): Promise<ServiceResult<PageResult<RequirementSummaryDto>>> {
  const params: unknown[] = [input.projectId];
  const where = ["l.project_id = $1"];
  let n = 2;
  if (input.kind) {
    where.push(`l.kind = $${n++}`);
    params.push(input.kind);
  }
  if (input.type) {
    where.push(`COALESCE(v.mint_kind, l.kind) = $${n++}`);
    params.push(input.type);
  }
  if (input.status) {
    where.push(`v.status = $${n++}`);
    params.push(input.status);
  }
  if (input.q) {
    where.push(`(l.base_uid ILIKE $${n} ESCAPE '\\' OR l.title ILIKE $${n} ESCAPE '\\' OR COALESCE(v.title,'') ILIKE $${n} ESCAPE '\\')`);
    params.push(`%${escapeIlike(input.q.trim())}%`);
    n++;
  }
  const w = where.join(" AND ");
  const total =
    (await ctx.pool.query<{ c: number }>(`SELECT count(*)::int AS c ${CURRENT_JOIN} WHERE ${w}`, params)).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<Row>(
    `SELECT l.base_uid, l.title AS line_title, l.kind, v.uid, v.version_n, v.status, v.title, v.statement,
            v.priority, v.iteration, v.rbac_op, v.grooming_state, v.mint_kind
     ${CURRENT_JOIN} WHERE ${w} ORDER BY l.base_uid ASC LIMIT $${n} OFFSET $${n + 1}`,
    [...params, input.limit, input.offset],
  );
  return ok({ items: res.rows.map(summary), limit: input.limit, offset: input.offset, total });
}

export async function getRequirement(
  ctx: RequestContext,
  input: GetRequirementInput,
): Promise<ServiceResult<RequirementDetailDto>> {
  const res = await ctx.pool.query<Row>(
    `SELECT l.base_uid, l.title AS line_title, l.kind, v.uid, v.version_n, v.status, v.title, v.statement,
            v.priority, v.iteration, v.rbac_op, v.grooming_state, v.mint_kind
     ${CURRENT_JOIN} WHERE l.project_id = $1 AND l.base_uid = $2`,
    [input.projectId, input.requirementId],
  );
  const row = res.rows[0];
  return row ? ok(detail(row, input.projectId)) : err("not_found", "Requirement not found");
}

export async function listRequirementVersions(
  ctx: RequestContext,
  input: ListRequirementVersionsInput,
): Promise<ServiceResult<PageResult<RequirementVersionDto>>> {
  const exists = await ctx.pool.query(
    `SELECT 1 FROM requirement_lines WHERE project_id = $1 AND base_uid = $2`,
    [input.projectId, input.requirementId],
  );
  if (!exists.rowCount) return err("not_found", "Requirement not found");
  const total =
    (
      await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM requirement_versions WHERE project_id = $1 AND base_uid = $2`,
        [input.projectId, input.requirementId],
      )
    ).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<RequirementVersionDto>(
    `SELECT uid AS version_id, version_n, status, title, statement
     FROM requirement_versions WHERE project_id = $1 AND base_uid = $2
     ORDER BY version_n DESC LIMIT $3 OFFSET $4`,
    [input.projectId, input.requirementId, input.limit, input.offset],
  );
  return ok({ items: res.rows, limit: input.limit, offset: input.offset, total });
}
