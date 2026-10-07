import type pg from "pg";
import { effectiveRoles } from "./agent-role.js";

/** Minimal v1 role → permission map (aligned to permission-matrix-flat.md). */
const ROLE_PERMISSIONS: Record<string, Set<string>> = {
  Reader: new Set(["requirement:read", "audit:read", "grant:read"]),
  Author: new Set([
    "requirement:read",
    "requirement:write",
    "audit:read",
    "grant:read",
  ]),
  Developer: new Set([
    "requirement:read",
    "workitem:write",
    "audit:read",
    "grant:read",
  ]),
  Tester: new Set(["requirement:read", "verification:write", "audit:read", "grant:read"]),
  "Release manager": new Set([
    "requirement:read",
    "release:plan",
    "release:ship",
    "audit:read",
    "grant:read",
  ]),
  Security: new Set([
    "requirement:read",
    "security:apply",
    "audit:read",
    "grant:read",
  ]),
  AO: new Set(["requirement:read", "gate:approve", "audit:read", "grant:read"]),
  Auditor: new Set(["requirement:read", "audit:read", "grant:read"]),
  "Project admin": new Set([
    "requirement:read",
    "requirement:write",
    "grant:manage",
    "audit:read",
    "grant:read",
  ]),
  "Client admin": new Set([
    "requirement:read",
    "client:manage",
    "grant:manage",
    "audit:read",
    "grant:read",
  ]),
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
  /** Verified access-token claims; a bound `reqaml_role` (agent tokens) narrows the grants. */
  token?: { readonly [claim: string]: unknown },
): Promise<boolean> {
  const roles = effectiveRoles(await listActiveRoles(pool, identityId, projectId), token);
  if (roles.length === 0) return false;
  const perms = permissionsForRoles(roles);
  return perms.has(permission);
}
