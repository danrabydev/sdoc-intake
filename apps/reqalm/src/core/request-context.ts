import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import type pg from "pg";
import type { AppConfig } from "../config.js";
import type { ResolvedAuth } from "../auth/request-auth.js";
import { resolveRequestAuth } from "../auth/request-auth.js";
import type { KeyProvider } from "../key/provider.js";
import { effectiveRoles } from "../rbac/agent-role.js";
import { listActiveRoles, permissionsForRoles } from "../rbac/enforce.js";
import { requestIdFromFastify } from "../telemetry/request-id.js";
import { activeTraceIds } from "../telemetry/trace-context.js";

export type ProjectGrantRow = { project_id: string; role: string };

export type RequestContext = {
  requestId: string;
  traceId: string | null;
  spanId: string | null;
  ip: string;
  userAgent: string | null;
  pool: pg.Pool;
  config: AppConfig;
  keyProvider: KeyProvider;
  logger: FastifyBaseLogger;
  clock: { now: () => number };
  auth: ResolvedAuth | null;
  identityId: string | null;
  projectGrants: ProjectGrantRow[];
  projectIds: Set<string>;
  effectiveRoles: string[];
  permissions: Set<string>;
  agentName: string | null;
  tokenRole: string | null;
  actingFor: string | null;
};

export type RequestContextDeps = {
  pool: pg.Pool;
  config: AppConfig;
  keyProvider: KeyProvider;
  logger: FastifyBaseLogger;
};

function tokenStringField(token: { readonly [k: string]: unknown }, key: string): string | null {
  const v = token[key];
  return typeof v === "string" ? v : null;
}

export async function buildRequestContext(
  req: FastifyRequest,
  deps: RequestContextDeps,
): Promise<RequestContext> {
  const requestId = requestIdFromFastify(req);
  const trace = activeTraceIds();
  const auth = await resolveRequestAuth(req, deps.pool, deps.config, deps.keyProvider);
  const identityId = auth?.accessToken.sub ?? null;
  let projectGrants: ProjectGrantRow[] = [];
  if (identityId) {
    const grants = await deps.pool.query<ProjectGrantRow>(
      `SELECT project_id, role FROM project_grants
       WHERE identity_id = $1 AND revoked_at IS NULL`,
      [identityId],
    );
    projectGrants = grants.rows;
  }
  const eff = identityId
    ? effectiveRoles(
        projectGrants.map((g) => g.role),
        auth?.accessToken,
      )
    : [];
  const permissions = permissionsForRoles(eff);
  const token = auth?.accessToken;
  const act = token?.act as { sub?: string } | undefined;
  return {
    requestId,
    traceId: trace?.traceId ?? null,
    spanId: trace?.spanId ?? null,
    ip: req.ip,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
    pool: deps.pool,
    config: deps.config,
    keyProvider: deps.keyProvider,
    logger: deps.logger,
    clock: { now: () => Date.now() },
    auth,
    identityId,
    projectGrants,
    projectIds: new Set(projectGrants.map((g) => g.project_id)),
    effectiveRoles: eff,
    permissions,
    agentName: token ? tokenStringField(token, "agent_name") : null,
    tokenRole: token ? tokenStringField(token, "reqalm_role") : null,
    actingFor: act?.sub ?? null,
  };
}

/** Recompute roles for a specific project (used by authorize helper). */
export async function rolesForProject(
  ctx: RequestContext,
  projectId: string,
): Promise<string[]> {
  if (!ctx.identityId) return [];
  const roles = await listActiveRoles(ctx.pool, ctx.identityId, projectId);
  return effectiveRoles(roles, ctx.auth?.accessToken);
}
