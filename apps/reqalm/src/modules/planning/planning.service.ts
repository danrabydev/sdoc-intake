import type { QueryResultRow } from "pg";
import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { PageQuery, PageResult } from "../../core/paging.js";
import type { RequestContext } from "../../core/request-context.js";
import { projectIdsWithPermission } from "../../rbac/enforce.js";

export type IterationSummaryDto = {
  id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
};

export type IterationDetailDto = IterationSummaryDto & { project_id: string };

export type ChangeSetSummaryDto = {
  id: string;
  kind: string;
  status: string;
  parent_id: string | null;
  opened_by: string;
  opened_at: string;
  closed_at: string | null;
  summary: string | null;
};

export type ChangeSetDetailDto = ChangeSetSummaryDto & {
  project_id: string;
  scope: string;
  notes: string | null;
};

export type WorkItemLinkSummaryDto = {
  id: string;
  requirement_version_uid: string;
  devops_id: string;
  system: string | null;
  status: string | null;
  last_sync_at: string | null;
};

export type WorkItemLinkDetailDto = WorkItemLinkSummaryDto & {
  project_id: string;
  synced_fields: Record<string, boolean> | null;
  notes: string | null;
};

export type ListPlanningInput = PageQuery & { projectId: string };
export type GetIterationInput = { projectId: string; iterationId: string };
export type GetChangeSetInput = { projectId: string; changeSetId: string };
export type GetWorkItemLinkInput = { projectId: string; linkId: string };

async function pageQuery<T extends QueryResultRow>(
  ctx: RequestContext,
  select: string,
  sqlFrom: string,
  orderBy: string,
  input: PageQuery,
  params: unknown[],
): Promise<PageResult<T>> {
  const total =
    (await ctx.pool.query<{ c: number }>(`SELECT count(*)::int AS c ${sqlFrom}`, params)).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<T>(
    `SELECT ${select} ${sqlFrom} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, input.limit, input.offset],
  );
  return { items: res.rows, limit: input.limit, offset: input.offset, total };
}

export async function listIterations(
  ctx: RequestContext,
  input: ListPlanningInput,
): Promise<ServiceResult<PageResult<IterationSummaryDto>>> {
  const params = [input.projectId];
  const page = await pageQuery<IterationSummaryDto>(
    ctx,
    "i.id, i.name, i.starts_on::text AS starts_on, i.ends_on::text AS ends_on",
    "FROM iterations i WHERE i.project_id = $1",
    "i.starts_on DESC NULLS LAST, i.id ASC",
    input,
    params,
  );
  return ok(page);
}

export async function getIteration(
  ctx: RequestContext,
  input: GetIterationInput,
): Promise<ServiceResult<IterationDetailDto>> {
  const res = await ctx.pool.query<IterationDetailDto>(
    `SELECT i.id, i.project_id, i.name, i.starts_on::text AS starts_on, i.ends_on::text AS ends_on
       FROM iterations i WHERE i.project_id = $1 AND i.id = $2`,
    [input.projectId, input.iterationId],
  );
  if (!res.rows[0]) return err("not_found", "Not found");
  return ok(res.rows[0]);
}

export async function listChangeSets(
  ctx: RequestContext,
  input: ListPlanningInput,
): Promise<ServiceResult<PageResult<ChangeSetSummaryDto>>> {
  const params = [input.projectId];
  const page = await pageQuery<ChangeSetSummaryDto>(
    ctx,
    `c.id, c.kind, c.status, c.parent_id, c.opened_by, c.opened_at::text AS opened_at,
     c.closed_at::text AS closed_at, c.summary`,
    "FROM change_sets c WHERE c.project_id = $1",
    "c.opened_at DESC, c.id ASC",
    input,
    params,
  );
  return ok(page);
}

export async function getChangeSet(
  ctx: RequestContext,
  input: GetChangeSetInput,
): Promise<ServiceResult<ChangeSetDetailDto>> {
  const res = await ctx.pool.query<ChangeSetDetailDto>(
    `SELECT c.id, c.project_id, c.kind, c.parent_id, c.scope, c.status, c.opened_by,
            c.opened_at::text AS opened_at, c.closed_at::text AS closed_at, c.summary, c.notes
       FROM change_sets c WHERE c.project_id = $1 AND c.id = $2`,
    [input.projectId, input.changeSetId],
  );
  if (!res.rows[0]) return err("not_found", "Not found");
  return ok(res.rows[0]);
}

export async function listWorkItemLinks(
  ctx: RequestContext,
  input: ListPlanningInput,
): Promise<ServiceResult<PageResult<WorkItemLinkSummaryDto>>> {
  const reqProjects = await projectIdsWithPermission(ctx, "requirement:read");
  const params = [input.projectId, reqProjects];
  const page = await pageQuery<WorkItemLinkSummaryDto>(
    ctx,
    `w.id, w.requirement_version_uid, w.devops_id, w.system, w.status, w.last_sync_at::text AS last_sync_at`,
    `FROM work_item_links w
     JOIN requirement_versions v ON v.uid = w.requirement_version_uid
     WHERE w.project_id = $1 AND v.project_id = ANY($2::text[])`,
    "w.id ASC",
    input,
    params,
  );
  return ok(page);
}

export async function getWorkItemLink(
  ctx: RequestContext,
  input: GetWorkItemLinkInput,
): Promise<ServiceResult<WorkItemLinkDetailDto>> {
  const reqProjects = await projectIdsWithPermission(ctx, "requirement:read");
  const res = await ctx.pool.query<WorkItemLinkDetailDto>(
    `SELECT w.id, w.project_id, w.requirement_version_uid, w.devops_id, w.system, w.status,
            w.last_sync_at::text AS last_sync_at, w.synced_fields, w.notes
       FROM work_item_links w
       JOIN requirement_versions v ON v.uid = w.requirement_version_uid
       WHERE w.project_id = $1 AND w.id = $2 AND v.project_id = ANY($3::text[])`,
    [input.projectId, input.linkId, reqProjects],
  );
  if (!res.rows[0]) return err("not_found", "Not found");
  return ok(res.rows[0]);
}
