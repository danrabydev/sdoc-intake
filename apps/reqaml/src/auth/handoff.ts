import type pg from "pg";
import { randomToken } from "../credential/password.js";

export type LoginHandoff = {
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  scope?: string;
  state: string;
  codeVerifier: string | null;
};

const HANDOFF_TTL_MS = 10 * 60 * 1000;

export async function createLoginHandoff(
  pool: pg.Pool,
  input: Omit<LoginHandoff, "id"> & { id?: string; codeVerifier?: string | null },
): Promise<string> {
  const id = input.id ?? randomToken(16);
  const expires = new Date(Date.now() + HANDOFF_TTL_MS);
  await pool.query(
    `
    INSERT INTO oauth_login_handoffs
      (id, client_id, redirect_uri, code_challenge, code_challenge_method, resource, scope, state, code_verifier, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `,
    [
      id,
      input.clientId,
      input.redirectUri,
      input.codeChallenge,
      input.codeChallengeMethod,
      input.resource,
      input.scope ?? null,
      input.state,
      input.codeVerifier ?? null,
      expires,
    ],
  );
  return id;
}

export async function loadLoginHandoff(
  pool: pg.Pool,
  id: string,
): Promise<LoginHandoff | null> {
  const r = await pool.query<{
    id: string;
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    resource: string;
    scope: string | null;
    state: string;
    code_verifier: string;
    expires_at: Date;
  }>(
    `SELECT * FROM oauth_login_handoffs WHERE id = $1 AND expires_at > now()`,
    [id],
  );
  if (!r.rowCount) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    resource: row.resource,
    scope: row.scope ?? undefined,
    state: row.state,
    codeVerifier: row.code_verifier,
  };
}

export function handoffFromValidated(
  validated: {
    client: { clientId: string };
    redirectUri: string;
    codeChallenge: string;
    resource: { canonicalUri: string };
    scope?: string;
    state?: string;
  },
  codeVerifier: string | null,
): Omit<LoginHandoff, "id"> {
  return {
    clientId: validated.client.clientId,
    redirectUri: validated.redirectUri,
    codeChallenge: validated.codeChallenge,
    codeChallengeMethod: "S256",
    resource: validated.resource.canonicalUri,
    scope: validated.scope,
    state: validated.state ?? "",
    codeVerifier,
  };
}

export async function deleteLoginHandoff(pool: pg.Pool, id: string): Promise<void> {
  await pool.query(`DELETE FROM oauth_login_handoffs WHERE id = $1`, [id]);
}
