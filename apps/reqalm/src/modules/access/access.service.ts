import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { PageQuery, PageResult } from "../../core/paging.js";
import type { RequestContext } from "../../core/request-context.js";
import { ROLE_PERMISSIONS, clientIdsForProjects } from "../../rbac/enforce.js";

export type AccessPersonDto = {
  id: string;
  display_name: string;
  email: string | null;
  roles: string[];
};

export type ProjectGrantDto = {
  id: string;
  role: string;
  person: Pick<AccessPersonDto, "id" | "display_name" | "email">;
};

export type ClientGrantDto = ProjectGrantDto;

export type RoleCatalogDto = {
  name: string;
  permissions: string[];
};

export type PlatformGrantDto = {
  id: string;
  role: string;
  person: Pick<AccessPersonDto, "display_name" | "email">;
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
  email: string | null;
  role: string;
};

function personFromRow(r: PersonRow): Pick<AccessPersonDto, "id" | "display_name" | "email"> {
  return {
    id: r.id,
    display_name: r.display_name ?? r.id,
    email: r.email,
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

export async function listProjectPeople(
  ctx: RequestContext,
  input: ListProjectPeopleInput,
): Promise<ServiceResult<PageResult<AccessPersonDto>>> {
  const res = await ctx.pool.query<PersonRow>(
    `
    SELECT i.id, i.display_name, i.email, pg.role
      FROM project_grants pg
      JOIN identities i ON i.id = pg.identity_id
     WHERE pg.project_id = $1 AND pg.revoked_at IS NULL
     ORDER BY COALESCE(i.display_name, i.id) ASC, i.id ASC, pg.role ASC
    `,
    [input.projectId],
  );
  const byId = new Map<string, AccessPersonDto>();
  for (const row of res.rows) {
    let person = byId.get(row.id);
    if (!person) {
      person = { ...personFromRow(row), roles: [] };
      byId.set(row.id, person);
    }
    if (!person.roles.includes(row.role)) person.roles.push(row.role);
  }
  const all = [...byId.values()]
    .map((p) => ({
      ...p,
      roles: [...p.roles].sort(),
    }))
    .sort(
      (a, b) =>
        a.display_name.localeCompare(b.display_name) || a.id.localeCompare(b.id),
    );
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
    SELECT pg.id AS grant_id, pg.role, i.id, i.display_name, i.email
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
    person: personFromRow(r),
  }));
  return ok({ items, limit: input.limit, offset: input.offset, total });
}

export async function listClientGrants(
  ctx: RequestContext,
  input: ListClientGrantsInput,
): Promise<ServiceResult<PageResult<ClientGrantDto>>> {
  const allowed = ctx.allowedProjectIds;
  if (!allowed) return err("internal", "Internal error");
  const clientIds = new Set(await clientIdsForProjects(ctx, allowed));
  if (!clientIds.has(input.clientId)) {
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
    SELECT cg.id AS grant_id, cg.role, i.id, i.display_name, i.email
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
    person: personFromRow(r),
  }));
  return ok({ items, limit: input.limit, offset: input.offset, total });
}

export async function listRoleCatalog(
  _ctx: RequestContext,
  input: ListRolesInput,
): Promise<ServiceResult<PageResult<RoleCatalogDto>>> {
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
  if (!(await callerHasPlatformGrant(ctx))) {
    return notFound("Not found");
  }
  const total =
    (await ctx.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM platform_grants`)).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<{
    grant_id: string;
    role: string;
    display_name: string | null;
    email: string | null;
  }>(
    `
    SELECT pg.id AS grant_id, pg.role, i.display_name, i.email
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
      display_name: r.display_name ?? "",
      email: r.email,
    },
  }));
  return ok({ items, limit: input.limit, offset: input.offset, total });
}
