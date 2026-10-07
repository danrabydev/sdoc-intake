import type pg from "pg";
import type { AppConfig } from "../config.js";
import type { KeyProvider } from "../key/provider.js";
import { signAccessToken } from "../key/signing.js";
import { writeAuthAudit } from "../audit/auth-audit.js";
import { getClient, verifyClientSecret } from "./clients.js";
import { hashPassword } from "../credential/password.js";

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
      'reqaml-agent-dev',
      'ReqAML dev agent (client credentials)',
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
    VALUES ($1, $2, $3, 'reqaml-agent-dev', $4, $5)
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
  },
  ctx: { ip?: string; userAgent?: string },
): Promise<{ accessToken: string; expiresIn: number } | { error: string }> {
  const client = await getClient(pool, input.clientId);
  if (!client || client.clientId !== "reqaml-agent-dev") {
    return { error: "invalid_client" };
  }
  if (!(await verifyClientSecret(client, input.clientSecret))) {
    return { error: "invalid_client" };
  }
  const agent = await pool.query<{ identity_id: string }>(
    `SELECT identity_id FROM agent_principals WHERE name = $1`,
    [input.agentName],
  );
  if (!agent.rowCount) {
    return { error: "invalid_grant" };
  }
  const sub = agent.rows[0].identity_id;
  const { token, jti } = await signAccessToken(
    pool,
    keyProvider,
    {
      sub,
      aud: input.resource,
      iss: input.issuer,
      clientId: input.clientId,
      authTime: Math.floor(Date.now() / 1000),
      mfa: true,
      agentName: input.agentName,
      actingFor: input.actingForIdentityId,
    },
    input.ttlSeconds,
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
      jti,
    },
  });
  return { accessToken: token, expiresIn: input.ttlSeconds };
}
