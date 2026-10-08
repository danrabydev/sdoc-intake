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

export type RequirementTreeNodeDto = {
  uid: string;
  title: string;
  kind: string;
  type: string;
  status: string;
  child_count: number;
};

export type RequirementAncestorDto = {
  uid: string;
  title: string;
};

export type RequirementDetailDto = RequirementSummaryDto & {
  project_id: string;
  statement: string;
  attributes: Record<string, string | number | null>;
  parent_uid: string | null;
  ancestors: RequirementAncestorDto[];
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
export type ListRequirementTreeInput = PageQuery & {
  projectId: string;
  parentUid: string | null;
};

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
  parent_uid?: string | null;
  child_count?: number;
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

function treeNode(r: Row): RequirementTreeNodeDto {
  return {
    uid: r.base_uid,
    title: r.title ?? r.line_title,
    kind: r.kind,
    type: r.mint_kind ?? r.kind,
    status: r.status,
    child_count: r.child_count ?? 0,
  };
}

async function loadAncestors(
  ctx: RequestContext,
  projectId: string,
  baseUid: string,
): Promise<RequirementAncestorDto[]> {
  const res = await ctx.pool.query<{ uid: string; title: string }>(
    `
    WITH RECURSIVE chain AS (
      SELECT base_uid, parent, title, 0 AS depth, ARRAY[base_uid] AS path
        FROM requirement_lines
       WHERE project_id = $1 AND base_uid = $2
      UNION ALL
      SELECT p.base_uid, p.parent, p.title, chain.depth + 1, chain.path || p.base_uid
        FROM requirement_lines p
        JOIN chain ON chain.parent = p.base_uid AND p.project_id = $1
       WHERE p.base_uid <> ALL (chain.path) AND chain.depth < 32
    )
    SELECT base_uid AS uid, title
      FROM chain
     WHERE base_uid <> $2
     ORDER BY depth DESC
  `,
    [projectId, baseUid],
  );
  return res.rows;
}

function detail(
  r: Row,
  projectId: string,
  ancestors: RequirementAncestorDto[],
): RequirementDetailDto {
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
    parent_uid: r.parent_uid ?? null,
    ancestors,
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
    `SELECT l.base_uid, l.title AS line_title, l.kind, l.parent AS parent_uid, v.uid, v.version_n, v.status, v.title, v.statement,
            v.priority, v.iteration, v.rbac_op, v.grooming_state, v.mint_kind
     ${CURRENT_JOIN} WHERE l.project_id = $1 AND l.base_uid = $2`,
    [input.projectId, input.requirementId],
  );
  const row = res.rows[0];
  if (!row) return err("not_found", "Requirement not found");
  const ancestors = await loadAncestors(ctx, input.projectId, row.base_uid);
  return ok(detail(row, input.projectId, ancestors));
}

const CHILD_COUNT_SQL = `(SELECT count(*)::int FROM requirement_lines c
     WHERE c.project_id = l.project_id AND c.parent = l.base_uid)`;

export async function listRequirementTree(
  ctx: RequestContext,
  input: ListRequirementTreeInput,
): Promise<ServiceResult<PageResult<RequirementTreeNodeDto>>> {
  if (input.parentUid) {
    const parent = await ctx.pool.query(
      `SELECT 1 FROM requirement_lines WHERE project_id = $1 AND base_uid = $2`,
      [input.projectId, input.parentUid],
    );
    if (!parent.rowCount) return err("not_found", "Requirement not found");
  }
  const parentClause = input.parentUid
    ? `l.parent = $2`
    : `l.parent IS NULL`;
  const params: unknown[] = input.parentUid
    ? [input.projectId, input.parentUid]
    : [input.projectId];
  let n = params.length + 1;
  const w = `l.project_id = $1 AND ${parentClause}`;
  const total =
    (await ctx.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM requirement_lines l WHERE ${w}`, params))
      .rows[0]?.c ?? 0;
  const res = await ctx.pool.query<Row>(
    `SELECT l.base_uid, l.title AS line_title, l.kind, v.uid, v.version_n, v.status, v.title, v.statement,
            v.priority, v.iteration, v.rbac_op, v.grooming_state, v.mint_kind,
            ${CHILD_COUNT_SQL} AS child_count
     ${CURRENT_JOIN} WHERE ${w}
     ORDER BY l.sibling_order ASC, l.base_uid ASC
     LIMIT $${n} OFFSET $${n + 1}`,
    [...params, input.limit, input.offset],
  );
  return ok({ items: res.rows.map(treeNode), limit: input.limit, offset: input.offset, total });
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
