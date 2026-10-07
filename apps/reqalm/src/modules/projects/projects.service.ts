import type pg from "pg";
import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { RequestContext } from "../../core/request-context.js";

export type ProjectDto = {
  id: string;
  client_id: string;
  name: string;
  status: string | null;
};

export type GetProjectInput = { projectId: string };

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
