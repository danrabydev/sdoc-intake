import type pg from "pg";
import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { PageQuery, PageResult } from "../../core/paging.js";
import type { RequestContext } from "../../core/request-context.js";

export type ClientDto = {
  id: string;
  name: string;
  created_at: string | null;
  notes: string | null;
};

export type GetClientInput = { clientId: string };
export type ListClientsInput = PageQuery;

export async function grantedClientIds(pool: pg.Pool, projectIds: Set<string>): Promise<string[]> {
  if (projectIds.size === 0) return [];
  const res = await pool.query<{ client_id: string }>(
    `SELECT DISTINCT client_id FROM projects WHERE id = ANY($1::text[])`,
    [[...projectIds]],
  );
  return res.rows.map((r) => r.client_id);
}

export async function listClients(
  ctx: RequestContext,
  input: ListClientsInput,
): Promise<ServiceResult<PageResult<ClientDto>>> {
  const clientIds = await grantedClientIds(ctx.pool, ctx.projectIds);
  if (clientIds.length === 0) {
    return ok({ items: [], limit: input.limit, offset: input.offset, total: 0 });
  }
  const count = await ctx.pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM clients WHERE id = ANY($1::text[])`,
    [clientIds],
  );
  const total = count.rows[0]?.c ?? 0;
  const res = await ctx.pool.query<ClientDto>(
    `SELECT id, name, created_at::text, notes FROM clients
     WHERE id = ANY($1::text[])
     ORDER BY name ASC, id ASC
     LIMIT $2 OFFSET $3`,
    [clientIds, input.limit, input.offset],
  );
  return ok({ items: res.rows, limit: input.limit, offset: input.offset, total });
}

export async function getClient(
  ctx: RequestContext,
  input: GetClientInput,
): Promise<ServiceResult<ClientDto>> {
  const allowed = new Set(await grantedClientIds(ctx.pool, ctx.projectIds));
  if (!allowed.has(input.clientId)) {
    return err("not_found", "Client not found");
  }
  const res = await ctx.pool.query<ClientDto>(
    `SELECT id, name, created_at::text, notes FROM clients WHERE id = $1`,
    [input.clientId],
  );
  const row = res.rows[0];
  if (!row) {
    return err("not_found", "Client not found");
  }
  return ok(row);
}
