import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { PageQuery, PageResult } from "../../core/paging.js";
import type { RequestContext } from "../../core/request-context.js";
import {
  ROLE_PERMISSIONS,
  callerHasAccessRead,
  callerHasAnyGrant,
} from "../../rbac/enforce.js";

export type AccessPersonDto = {
  display_name: string;
  roles: string[];
};

export type ProjectGrantDto = {
  id: string;
  role: string;
  person: Pick<AccessPersonDto, "display_name">;
};

export type ClientGrantDto = ProjectGrantDto;

export type RoleCatalogDto = {
  name: string;
  permissions: string[];
};

export type PlatformGrantDto = {
  id: string;
  role: string;
  person: Pick<AccessPersonDto, "display_name">;
};

export type ListProjectPeopleInput = PageQuery & { projectId: string };
export type ListProjectGrantsInput = PageQuery & { projectId: string };
export type ListClientGrantsInput = PageQuery & { clientId: string };
export type ListRolesInput = PageQuery;
export type ListPlatformGrantsInput = PageQuery;

const notFound = (detail: string) => err("not_found", detail);

type PersonRow = {
  id: string;
  display_name: string | null;
  role: string;
};

function personDisplayFromRow(r: PersonRow): Pick<AccessPersonDto, "display_name"> {
  return {
    display_name: r.display_name ?? r.id,
  };
}

async function callerHasPlatformGrant(ctx: RequestContext): Promise<boolean> {
  if (!ctx.identityId) return false;
  const r = await ctx.pool.query(
    `SELECT 1 FROM platform_grants WHERE identity_id = $1 LIMIT 1`,
    [ctx.identityId],
  );
  return (r.rowCount ?? 0) > 0;
}

async function callerHasClientGrantOn(ctx: RequestContext, clientId: string): Promise<boolean> {
  if (!ctx.identityId) return false;
  const r = await ctx.pool.query(
    `SELECT 1 FROM client_grants WHERE identity_id = $1 AND client_id = $2 LIMIT 1`,
    [ctx.identityId, clientId],
  );
  return (r.rowCount ?? 0) > 0;
}

async function assertAccessReadGate(
  ctx: RequestContext,
  detail: string,
): Promise<ServiceResult<never> | null> {
  if (!(await callerHasAccessRead(ctx))) {
    return notFound(detail);
  }
  return null;
}

export async function listProjectPeople(
  ctx: RequestContext,
  input: ListProjectPeopleInput,
): Promise<ServiceResult<PageResult<AccessPersonDto>>> {
  const res = await ctx.pool.query<PersonRow>(
    `
    SELECT i.id, i.display_name, pg.role
      FROM project_grants pg
      JOIN identities i ON i.id = pg.identity_id
     WHERE pg.project_id = $1 AND pg.revoked_at IS NULL
     ORDER BY COALESCE(i.display_name, i.id) ASC, i.id ASC, pg.role ASC
    `,
    [input.projectId],
  );
  const byId = new Map<string, AccessPersonDto & { sortKey: string }>();
  for (const row of res.rows) {
    let person = byId.get(row.id);
    if (!person) {
      person = { ...personDisplayFromRow(row), roles: [], sortKey: row.id };
      byId.set(row.id, person);
    }
    if (!person.roles.includes(row.role)) person.roles.push(row.role);
  }
  const all = [...byId.values()]
    .map(({ sortKey, ...p }) => ({
      ...p,
      roles: [...p.roles].sort(),
      sortKey,
    }))
    .sort(
      (a, b) =>
        a.display_name.localeCompare(b.display_name) ||
        a.sortKey.localeCompare(b.sortKey),
    )
    .map(({ sortKey: _, ...p }) => p);
  const total = all.length;
  return ok({
    items: all.slice(input.offset, input.offset + input.limit),
    limit: input.limit,
    offset: input.offset,
    total,
  });
}

export async function listProjectGrants(
  ctx: RequestContext,
  input: ListProjectGrantsInput,
): Promise<ServiceResult<PageResult<ProjectGrantDto>>> {
  const total =
    (
      await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM project_grants WHERE project_id = $1 AND revoked_at IS NULL`,
        [input.projectId],
      )
    ).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<PersonRow & { grant_id: string }>(
    `
    SELECT pg.id AS grant_id, pg.role, i.id, i.display_name
      FROM project_grants pg
      JOIN identities i ON i.id = pg.identity_id
     WHERE pg.project_id = $1 AND pg.revoked_at IS NULL
     ORDER BY pg.role ASC, pg.id ASC
     LIMIT $2 OFFSET $3
    `,
    [input.projectId, input.limit, input.offset],
  );
  const items: ProjectGrantDto[] = res.rows.map((r) => ({
    id: r.grant_id,
    role: r.role,
    person: personDisplayFromRow(r),
  }));
  return ok({ items, limit: input.limit, offset: input.offset, total });
}

export async function listClientGrants(
  ctx: RequestContext,
  input: ListClientGrantsInput,
): Promise<ServiceResult<PageResult<ClientGrantDto>>> {
  const denied = await assertAccessReadGate(ctx, "Client not found");
  if (denied) return denied;
  const hasPlatform = await callerHasPlatformGrant(ctx);
  const hasClient = await callerHasClientGrantOn(ctx, input.clientId);
  if (!hasPlatform && !hasClient) {
    return notFound("Client not found");
  }
  const clientExists = await ctx.pool.query(`SELECT 1 FROM clients WHERE id = $1 LIMIT 1`, [
    input.clientId,
  ]);
  if ((clientExists.rowCount ?? 0) === 0) {
    return notFound("Client not found");
  }
  const total =
    (
      await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM client_grants WHERE client_id = $1`,
        [input.clientId],
      )
    ).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<PersonRow & { grant_id: string }>(
    `
    SELECT cg.id AS grant_id, cg.role, i.id, i.display_name
      FROM client_grants cg
      JOIN identities i ON i.id = cg.identity_id
     WHERE cg.client_id = $1
     ORDER BY cg.role ASC, cg.id ASC
     LIMIT $2 OFFSET $3
    `,
    [input.clientId, input.limit, input.offset],
  );
  const items: ClientGrantDto[] = res.rows.map((r) => ({
    id: r.grant_id,
    role: r.role,
    person: personDisplayFromRow(r),
  }));
  return ok({ items, limit: input.limit, offset: input.offset, total });
}

export async function listRoleCatalog(
  ctx: RequestContext,
  input: ListRolesInput,
): Promise<ServiceResult<PageResult<RoleCatalogDto>>> {
  const denied = await assertAccessReadGate(ctx, "Not found");
  if (denied) return denied;
  if (!(await callerHasAnyGrant(ctx))) {
    return notFound("Not found");
  }
  const all: RoleCatalogDto[] = Object.keys(ROLE_PERMISSIONS)
    .sort()
    .map((name) => ({
      name,
      permissions: [...(ROLE_PERMISSIONS[name] ?? [])].sort(),
    }));
  const total = all.length;
  return ok({
    items: all.slice(input.offset, input.offset + input.limit),
    limit: input.limit,
    offset: input.offset,
    total,
  });
}

export async function listPlatformGrants(
  ctx: RequestContext,
  input: ListPlatformGrantsInput,
): Promise<ServiceResult<PageResult<PlatformGrantDto>>> {
  const denied = await assertAccessReadGate(ctx, "Not found");
  if (denied) return denied;
  if (!(await callerHasPlatformGrant(ctx))) {
    return notFound("Not found");
  }
  const total =
    (await ctx.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM platform_grants`)).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<{
    grant_id: string;
    role: string;
    display_name: string | null;
    identity_id: string;
  }>(
    `
    SELECT pg.id AS grant_id, pg.role, i.display_name, i.id AS identity_id
      FROM platform_grants pg
      JOIN identities i ON i.id = pg.identity_id
     ORDER BY pg.role ASC, pg.id ASC
     LIMIT $1 OFFSET $2
    `,
    [input.limit, input.offset],
  );
  const items: PlatformGrantDto[] = res.rows.map((r) => ({
    id: r.grant_id,
    role: r.role,
    person: {
      display_name: r.display_name ?? r.identity_id,
    },
  }));
  return ok({ items, limit: input.limit, offset: input.offset, total });
}
