import { TOTP, Secret } from "otpauth";
import type pg from "pg";
import type { KeyProvider } from "../key/provider.js";

export const PRIVILEGED_ROLES = new Set([
  "Security",
  "Project admin",
  "Client admin",
  "AO",
  "Key custodian",
]);

export async function identityHasPrivilegedRole(
  pool: pg.Pool,
  identityId: string,
): Promise<boolean> {
  const r = await pool.query<{ role: string }>(
    `
    SELECT role FROM project_grants
    WHERE identity_id = $1 AND revoked_at IS NULL
    UNION
    SELECT role FROM platform_grants WHERE identity_id = $1
  `,
    [identityId],
  );
  return r.rows.some((row) => PRIVILEGED_ROLES.has(row.role));
}

export function createTotpSecret(label: string): { secret: string; uri: string } {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: "ReqAML",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  return { secret: secret.base32, uri: totp.toString() };
}

export function totpTimeStep(secretBase32: string, token: string): number | null {
  const totp = new TOTP({ secret: Secret.fromBase32(secretBase32) });
  const delta = totp.validate({ token, window: 1 });
  if (delta === null) return null;
  // The step the code belongs to (current step + drift). Recording the *current* step instead
  // would let the same code be replayed once the clock moves into the next step.
  return Math.floor(Date.now() / 1000 / totp.period) + delta;
}

export function verifyTotp(secretBase32: string, token: string): boolean {
  return totpTimeStep(secretBase32, token) !== null;
}

export async function verifyTotpNoReplay(
  pool: pg.Pool,
  identityId: string,
  secretBase32: string,
  token: string,
): Promise<boolean> {
  const step = totpTimeStep(secretBase32, token);
  if (step === null) return false;
  const ins = await pool.query(
    `
    INSERT INTO mfa_totp_replay (identity_id, time_step)
    VALUES ($1, $2)
    ON CONFLICT (identity_id, time_step) DO NOTHING
    RETURNING identity_id
  `,
    [identityId, step],
  );
  return ins.rowCount === 1;
}

export async function storeMfaSecret(
  pool: pg.Pool,
  keyProvider: KeyProvider,
  identityId: string,
  secretBase32: string,
): Promise<void> {
  const wrapped = await keyProvider.wrapSecret(Buffer.from(secretBase32, "utf8"), "mfa");
  await pool.query(
    `
    UPDATE local_credentials
    SET mfa_secret_encrypted = $2, mfa_enabled = true, updated_at = now()
    WHERE identity_id = $1
  `,
    [identityId, wrapped],
  );
}

export async function loadMfaSecret(
  pool: pg.Pool,
  keyProvider: KeyProvider,
  identityId: string,
): Promise<string | null> {
  const r = await pool.query<{ mfa_secret_encrypted: string | null }>(
    `SELECT mfa_secret_encrypted FROM local_credentials WHERE identity_id = $1`,
    [identityId],
  );
  if (!r.rowCount || !r.rows[0].mfa_secret_encrypted) return null;
  const plain = await keyProvider.unwrapSecret(
    r.rows[0].mfa_secret_encrypted,
    "mfa",
  );
  return plain.toString("utf8");
}
