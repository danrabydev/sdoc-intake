import type pg from "pg";
import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { PageQuery, PageResult } from "../../core/paging.js";
import type { RequestContext } from "../../core/request-context.js";
import { grantedClientIds } from "../clients/clients.service.js";

export type ProjectDto = {
  id: string;
  client_id: string;
  name: string;
  status: string | null;
};

export type GetProjectInput = { projectId: string };
export type ListProjectsInput = PageQuery;
export type ListClientProjectsInput = PageQuery & { clientId: string };

export async function getProjectById(
  pool: pg.Pool,
  projectId: string,
): Promise<ProjectDto | null> {
  const res = await pool.query<{
    id: string;
    client_id: string;
    name: string;
    status: string | null;
  }>(`SELECT id, client_id, name, status FROM projects WHERE id = $1`, [projectId]);
  return res.rows[0] ?? null;
}

export async function getProject(
  ctx: RequestContext,
  input: GetProjectInput,
): Promise<ServiceResult<ProjectDto>> {
  const row = await getProjectById(ctx.pool, input.projectId);
  if (!row) {
    return err("not_found", "Project not found");
  }
  return ok(row);
}

export async function listProjects(
  ctx: RequestContext,
  input: ListProjectsInput,
): Promise<ServiceResult<PageResult<ProjectDto>>> {
  const ids = [...ctx.projectIds];
  if (ids.length === 0) {
    return ok({ items: [], limit: input.limit, offset: input.offset, total: 0 });
  }
  const count = await ctx.pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM projects WHERE id = ANY($1::text[])`,
    [ids],
  );
  const total = count.rows[0]?.c ?? 0;
  const res = await ctx.pool.query<ProjectDto>(
    `SELECT id, client_id, name, status FROM projects
     WHERE id = ANY($1::text[])
     ORDER BY name ASC, id ASC
     LIMIT $2 OFFSET $3`,
    [ids, input.limit, input.offset],
  );
  return ok({ items: res.rows, limit: input.limit, offset: input.offset, total });
}

export async function listClientProjects(
  ctx: RequestContext,
  input: ListClientProjectsInput,
): Promise<ServiceResult<PageResult<ProjectDto>>> {
  const allowedClients = new Set(await grantedClientIds(ctx.pool, ctx.projectIds));
  if (!allowedClients.has(input.clientId)) {
    return err("not_found", "Client not found");
  }
  const ids = [...ctx.projectIds];
  const count = await ctx.pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM projects WHERE client_id = $1 AND id = ANY($2::text[])`,
    [input.clientId, ids],
  );
  const total = count.rows[0]?.c ?? 0;
  const res = await ctx.pool.query<ProjectDto>(
    `SELECT id, client_id, name, status FROM projects
     WHERE client_id = $1 AND id = ANY($2::text[])
     ORDER BY name ASC, id ASC
     LIMIT $3 OFFSET $4`,
    [input.clientId, ids, input.limit, input.offset],
  );
  return ok({ items: res.rows, limit: input.limit, offset: input.offset, total });
}
