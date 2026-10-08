import type pg from "pg";
import type { RequestContext } from "../core/request-context.js";
import { effectiveRoles } from "./agent-role.js";

/** Minimal v1 role → permission map (aligned to permission-matrix-flat.md). */
const browseList = ["client:list", "project:list", "requirement:list", "release:list"] as const;
const withBrowse = (...perms: string[]) => new Set([...perms, ...browseList]);

/** Exact role → permission map (tests pin this table). */
export const ROLE_PERMISSIONS: Record<string, Set<string>> = {
  Reader: withBrowse("requirement:read", "release:read", "audit:read", "grant:read"),
  Author: withBrowse("requirement:read", "requirement:write", "release:read", "audit:read", "grant:read"),
  Developer: withBrowse("requirement:read", "workitem:write", "release:read", "audit:read", "grant:read"),
  Tester: withBrowse("requirement:read", "verification:write", "release:read", "audit:read", "grant:read"),
  "Release manager": withBrowse(
    "requirement:read",
    "release:read",
    "release:plan",
    "release:ship",
    "audit:read",
    "grant:read",
  ),
  Security: withBrowse("requirement:read", "security:apply", "release:read", "audit:read", "grant:read"),
  AO: withBrowse("requirement:read", "gate:approve", "release:read", "audit:read", "grant:read"),
  Auditor: withBrowse("requirement:read", "release:read", "audit:read", "grant:read"),
  "Project admin": withBrowse(
    "requirement:read",
    "requirement:write",
    "release:read",
    "grant:manage",
    "audit:read",
    "grant:read",
  ),
  "Client admin": withBrowse(
    "requirement:read",
    "client:manage",
    "release:read",
    "grant:manage",
    "audit:read",
    "grant:read",
  ),
  "Key custodian": new Set(["key:manage", "audit:read"]),
};

export async function listActiveRoles(
  pool: pg.Pool,
  identityId: string,
  projectId?: string,
): Promise<string[]> {
  const roles = new Set<string>();
  const grants = await pool.query<{ role: string; project_id: string }>(
    `
    SELECT role, project_id FROM project_grants
    WHERE identity_id = $1 AND revoked_at IS NULL
  `,
    [identityId],
  );
  for (const g of grants.rows) {
    if (!projectId || g.project_id === projectId) {
      roles.add(g.role);
    }
  }
  const platform = await pool.query<{ role: string }>(
    `SELECT role FROM platform_grants WHERE identity_id = $1`,
    [identityId],
  );
  for (const p of platform.rows) {
    roles.add(p.role);
  }
  return [...roles];
}

export function permissionsForRoles(roles: string[]): Set<string> {
  const perms = new Set<string>();
  for (const role of roles) {
    for (const p of ROLE_PERMISSIONS[role] ?? []) {
      perms.add(p);
    }
  }
  return perms;
}

export async function authorize(
  pool: pg.Pool,
  identityId: string,
  permission: string,
  projectId?: string,
  /** Verified access-token claims; a bound `reqalm_role` (agent tokens) narrows the grants. */
  token?: { readonly [claim: string]: unknown },
): Promise<boolean> {
  const roles = effectiveRoles(await listActiveRoles(pool, identityId, projectId), token);
  if (roles.length === 0) return false;
  const perms = permissionsForRoles(roles);
  return perms.has(permission);
}

export async function projectIdsWithPermission(
  ctx: RequestContext,
  permission: string,
): Promise<string[]> {
  if (!ctx.identityId || !ctx.auth) return [];
  const allowed: string[] = [];
  for (const projectId of ctx.projectIds) {
    if (await authorize(ctx.pool, ctx.identityId, permission, projectId, ctx.auth.accessToken)) {
      allowed.push(projectId);
    }
  }
  return allowed;
}

export async function clientIdsForProjects(
  ctx: RequestContext,
  projectIds: readonly string[],
): Promise<string[]> {
  if (projectIds.length === 0) return [];
  const res = await ctx.pool.query<{ client_id: string }>(
    `SELECT DISTINCT client_id FROM projects WHERE id = ANY($1::text[])`,
    [projectIds],
  );
  return res.rows.map((r) => r.client_id);
}
