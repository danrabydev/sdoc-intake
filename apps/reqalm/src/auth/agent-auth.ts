import type pg from "pg";
import type { AppConfig } from "../config.js";
import type { KeyProvider } from "../key/provider.js";
import { signAccessToken } from "../key/signing.js";
import { writeAuthAudit } from "../audit/auth-audit.js";
import { getClient, verifyClientSecret } from "./clients.js";
import { hashPassword } from "../credential/password.js";
import { listActiveRoles } from "../rbac/enforce.js";
import { resolveAgentRole } from "../rbac/agent-role.js";

const AGENT_TTL_MIN_SEC = 60;
const AGENT_TTL_MAX_SEC = 3600;

/**
 * Dev agent principal: its own identity with explicit Reader + Author grants on the dogfood
 * project (never mapped to a human or admin identity). Tokens then pick one of those roles.
 */
export async function ensureDevAgentPrincipal(
  pool: pg.Pool,
  input: { name: string; projectId: string; roles: string[] },
): Promise<void> {
  const identityId = `agent-${input.name}`;
  await pool.query(
    `INSERT INTO identities (id, display_name, notes)
     VALUES ($1, $2, 'Dev coding-agent principal (client_credentials on reqalm-agent-dev)')
     ON CONFLICT (id) DO NOTHING`,
    [identityId, `${input.name} (agent)`],
  );
  const project = await pool.query(`SELECT 1 FROM projects WHERE id = $1`, [input.projectId]);
  if (project.rowCount) {
    for (const role of input.roles) {
      await pool.query(
        `INSERT INTO project_grants (id, project_id, identity_id, role, notes)
         VALUES ($1, $2, $3, $4, 'explicit dev agent grant')
         ON CONFLICT DO NOTHING`,
        [`grant-${identityId}-${role.toLowerCase().replace(/\s+/g, "-")}`, input.projectId, identityId, role],
      );
    }
  }
  await upsertAgentPrincipal(pool, {
    name: input.name,
    identityId,
    defaultProjectId: input.projectId,
    defaultRole: "Reader",
  });
}

export async function ensureAgentDevClient(
  pool: pg.Pool,
  issuer: string,
  plainSecret: string | undefined,
): Promise<void> {
  const secretHash = plainSecret ? await hashPassword(plainSecret) : null;
  await pool.query(
    `
    INSERT INTO oauth_clients (client_id, client_name, client_type, redirect_uris, allowed_resources, client_secret_hash)
    VALUES (
      'reqalm-agent-dev',
      'ReqALM dev agent (client credentials)',
      'confidential',
      '[]'::jsonb,
      $1::jsonb,
      $2
    )
    ON CONFLICT (client_id) DO UPDATE SET
      client_secret_hash = COALESCE(EXCLUDED.client_secret_hash, oauth_clients.client_secret_hash),
      allowed_resources = EXCLUDED.allowed_resources
  `,
    [
      JSON.stringify([`${issuer}/api`, `${issuer}/mcp`]),
      secretHash,
    ],
  );
}

export async function upsertAgentPrincipal(
  pool: pg.Pool,
  input: {
    name: string;
    identityId: string;
    defaultProjectId?: string;
    defaultRole?: string;
  },
): Promise<void> {
  const id = `agent-${input.name}`;
  await pool.query(
    `
    INSERT INTO agent_principals (id, name, identity_id, oauth_client_id, default_project_id, default_role)
    VALUES ($1, $2, $3, 'reqalm-agent-dev', $4, $5)
    ON CONFLICT (id) DO UPDATE SET
      identity_id = EXCLUDED.identity_id,
      default_project_id = EXCLUDED.default_project_id,
      default_role = EXCLUDED.default_role
  `,
    [id, input.name, input.identityId, input.defaultProjectId ?? null, input.defaultRole ?? null],
  );
}

export async function issueClientCredentialsToken(
  pool: pg.Pool,
  config: AppConfig,
  keyProvider: KeyProvider,
  input: {
    clientId: string;
    clientSecret: string;
    agentName: string;
    resource: string;
    issuer: string;
    ttlSeconds: number;
    actingForIdentityId?: string;
    role?: string;
  },
  ctx: { ip?: string; userAgent?: string },
): Promise<
  | { accessToken: string; expiresIn: number; role: string }
  | { error: string; errorDescription?: string }
> {
  const client = await getClient(pool, input.clientId);
  if (!client || client.clientId !== "reqalm-agent-dev") {
    return { error: "invalid_client" };
  }
  if (!(await verifyClientSecret(client, input.clientSecret))) {
    return { error: "invalid_client" };
  }
  if (!client.allowedResources.includes(input.resource)) {
    return { error: "invalid_target" };
  }
  const agent = await pool.query<{ identity_id: string; default_project_id: string | null }>(
    `SELECT identity_id, default_project_id FROM agent_principals WHERE name = $1`,
    [input.agentName],
  );
  if (!agent.rowCount) {
    return { error: "invalid_grant" };
  }
  const sub = agent.rows[0].identity_id;
  const projectId = agent.rows[0].default_project_id ?? undefined;
  const granted = projectId ? await listActiveRoles(pool, sub, projectId) : [];
  const roleResult = resolveAgentRole(input.role, granted);
  if (!roleResult.ok) {
    await writeAuthAudit(pool, {
      eventType: "token.client_credentials",
      outcome: "deny",
      identityId: sub,
      clientId: input.clientId,
      resource: input.resource,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      detail: { agent: input.agentName, requested_role: input.role ?? null, reason: roleResult.description },
    });
    return { error: roleResult.error, errorDescription: roleResult.description };
  }
  if (input.actingForIdentityId) {
    const exists = await pool.query(`SELECT 1 FROM identities WHERE id = $1`, [input.actingForIdentityId]);
    if (!exists.rowCount) return { error: "invalid_request", errorDescription: "unknown acting_for identity" };
  }
  const ttl = Number.isFinite(input.ttlSeconds)
    ? Math.min(Math.max(Math.trunc(input.ttlSeconds), AGENT_TTL_MIN_SEC), AGENT_TTL_MAX_SEC)
    : AGENT_TTL_MAX_SEC;
  const { token, jti } = await signAccessToken(
    pool,
    keyProvider,
    {
      sub,
      aud: input.resource,
      iss: input.issuer,
      clientId: input.clientId,
      authTime: Math.floor(Date.now() / 1000),
      mfa: false,
      agentName: input.agentName,
      actingFor: input.actingForIdentityId,
      role: roleResult.role,
      projectId,
    },
    ttl,
  );
  await writeAuthAudit(pool, {
    eventType: "token.client_credentials",
    outcome: "success",
    identityId: sub,
    clientId: input.clientId,
    resource: input.resource,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    detail: {
      agent: input.agentName,
      acting_for: input.actingForIdentityId ?? null,
      role: roleResult.role,
      jti,
    },
  });
  return { accessToken: token, expiresIn: ttl, role: roleResult.role };
}
