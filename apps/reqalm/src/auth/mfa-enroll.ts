import type pg from "pg";
import type { KeyProvider } from "../key/provider.js";
import { createTotpSecret, verifyTotpNoReplay } from "../credential/mfa.js";
import { randomToken } from "../credential/password.js";

const TICKET_TTL_MS = 10 * 60 * 1000;

export async function startMfaEnrollment(
  pool: pg.Pool,
  keyProvider: KeyProvider,
  identityId: string,
  label: string,
): Promise<{ ticketId: string; otpauthUri: string }> {
  const { secret, uri } = createTotpSecret(label);
  const wrapped = await keyProvider.wrapSecret(Buffer.from(secret, "utf8"), "mfa-pending");
  const ticketId = randomToken(16);
  await pool.query(
    `
    INSERT INTO mfa_enrollment_tickets (id, identity_id, secret_ciphertext, expires_at)
    VALUES ($1, $2, $3, $4)
  `,
    [ticketId, identityId, wrapped, new Date(Date.now() + TICKET_TTL_MS)],
  );
  return { ticketId, otpauthUri: uri };
}

export async function confirmMfaEnrollment(
  pool: pg.Pool,
  keyProvider: KeyProvider,
  ticketId: string,
  code: string,
): Promise<{ ok: true; identityId: string } | { ok: false }> {
  const r = await pool.query<{
    identity_id: string;
    secret_ciphertext: string;
    expires_at: Date;
    consumed_at: Date | null;
  }>(
    `SELECT * FROM mfa_enrollment_tickets WHERE id = $1 FOR UPDATE`,
    [ticketId],
  );
  if (!r.rowCount || r.rows[0].consumed_at || r.rows[0].expires_at.getTime() < Date.now()) {
    return { ok: false };
  }
  const plain = (
    await keyProvider.unwrapSecret(r.rows[0].secret_ciphertext, "mfa-pending")
  ).toString("utf8");
  const valid = await verifyTotpNoReplay(pool, r.rows[0].identity_id, plain, code);
  if (!valid) return { ok: false };
  const { storeMfaSecret } = await import("../credential/mfa.js");
  await storeMfaSecret(pool, keyProvider, r.rows[0].identity_id, plain);
  await pool.query(
    `UPDATE mfa_enrollment_tickets SET consumed_at = now() WHERE id = $1`,
    [ticketId],
  );
  return { ok: true, identityId: r.rows[0].identity_id };
}
