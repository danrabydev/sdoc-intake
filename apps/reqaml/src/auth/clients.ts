import type pg from "pg";
import { hashPassword } from "../credential/password.js";

export type OAuthClient = {
  clientId: string;
  clientName: string;
  clientType: "public" | "confidential";
  redirectUris: string[];
  allowedResources: string[];
  clientSecretHash: string | null;
};

export async function ensureBootstrapClients(
  pool: pg.Pool,
  issuer: string,
): Promise<void> {
  // In dev (no REQAML_ISSUER_URL) the issuer follows the Host header, so register the loopback
  // spellings people actually browse to (localhost and 127.0.0.1) for the web client.
  const issuers = [issuer];
  const loopback = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.exec(issuer);
  if (loopback && !process.env.REQAML_ISSUER_URL) {
    const port = loopback[2] ?? "";
    issuers.splice(0, 1, `http://127.0.0.1${port}`, `http://localhost${port}`);
  }
  const clients: Array<Omit<OAuthClient, "clientSecretHash"> & { secret?: string }> = [
    {
      clientId: "reqaml-web",
      clientName: "ReqAML Web UI",
      clientType: "public",
      redirectUris: issuers.flatMap((i) => [`${i}/oauth/callback`, `${i}/`]),
      allowedResources: issuers.flatMap((i) => [`${i}/api`, `${i}/mcp`]),
    },
    {
      clientId: "reqaml-mcp-dev",
      clientName: "ReqAML MCP (dev)",
      clientType: "public",
      redirectUris: ["http://127.0.0.1:8765/callback", "http://localhost:8765/callback"],
      allowedResources: issuers.flatMap((i) => [`${i}/mcp`, `${i}/api`]),
    },
  ];
  for (const c of clients) {
    await pool.query(
      `
      INSERT INTO oauth_clients (client_id, client_name, client_type, redirect_uris, allowed_resources)
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
      ON CONFLICT (client_id) DO UPDATE SET
        client_name = EXCLUDED.client_name,
        redirect_uris = EXCLUDED.redirect_uris,
        allowed_resources = EXCLUDED.allowed_resources
    `,
      [
        c.clientId,
        c.clientName,
        c.clientType,
        JSON.stringify(c.redirectUris),
        JSON.stringify(c.allowedResources),
      ],
    );
  }
}

export async function getClient(
  pool: pg.Pool,
  clientId: string,
): Promise<OAuthClient | null> {
  const r = await pool.query<{
    client_id: string;
    client_name: string;
    client_type: string;
    redirect_uris: string[];
    allowed_resources: string[];
    client_secret_hash: string | null;
  }>(
    `SELECT client_id, client_name, client_type, redirect_uris, allowed_resources, client_secret_hash
     FROM oauth_clients WHERE client_id = $1`,
    [clientId],
  );
  if (!r.rowCount) return null;
  const row = r.rows[0];
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    clientType: row.client_type as "public" | "confidential",
    redirectUris: row.redirect_uris,
    allowedResources: row.allowed_resources,
    clientSecretHash: row.client_secret_hash,
  };
}

export async function verifyClientSecret(
  client: OAuthClient,
  secret: string | undefined,
): Promise<boolean> {
  if (client.clientType === "public") return true;
  if (!secret || !client.clientSecretHash) return false;
  const { verifyPassword } = await import("../credential/password.js");
  return verifyPassword(secret, client.clientSecretHash);
}

export async function setClientSecretHash(
  pool: pg.Pool,
  clientId: string,
  plainSecret: string,
): Promise<void> {
  const h = await hashPassword(plainSecret);
  await pool.query(
    `UPDATE oauth_clients SET client_secret_hash = $2 WHERE client_id = $1`,
    [clientId, h],
  );
}
