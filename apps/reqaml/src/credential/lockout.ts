import type pg from "pg";

export const LOCKOUT_THRESHOLD = 3;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export type LockoutState = {
  locked: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
};

export async function getLockoutState(
  pool: pg.Pool,
  identityId: string,
): Promise<LockoutState> {
  const r = await pool.query<{
    failed_attempts: number;
    locked_until: Date | null;
    last_failed_at: Date | null;
  }>(
    `SELECT failed_attempts, locked_until, last_failed_at FROM local_credentials WHERE identity_id = $1`,
    [identityId],
  );
  if (!r.rowCount) {
    return { locked: false, failedAttempts: 0, lockedUntil: null };
  }
  const row = r.rows[0];
  const now = Date.now();
  if (row.locked_until && row.locked_until.getTime() > now) {
    return {
      locked: true,
      failedAttempts: row.failed_attempts,
      lockedUntil: row.locked_until,
    };
  }
  if (
    row.last_failed_at &&
    now - row.last_failed_at.getTime() > LOCKOUT_WINDOW_MS
  ) {
    return { locked: false, failedAttempts: 0, lockedUntil: null };
  }
  return {
    locked: false,
    failedAttempts: row.failed_attempts,
    lockedUntil: null,
  };
}

export async function recordLoginFailure(
  pool: pg.Pool,
  identityId: string,
): Promise<LockoutState> {
  const now = new Date();
  const r = await pool.query<{
    failed_attempts: number;
    last_failed_at: Date | null;
  }>(
    `SELECT failed_attempts, last_failed_at FROM local_credentials WHERE identity_id = $1 FOR UPDATE`,
    [identityId],
  );
  if (!r.rowCount) {
    return { locked: false, failedAttempts: 0, lockedUntil: null };
  }
  let attempts = r.rows[0].failed_attempts;
  const last = r.rows[0].last_failed_at;
  if (last && now.getTime() - last.getTime() > LOCKOUT_WINDOW_MS) {
    attempts = 0;
  }
  attempts += 1;
  let lockedUntil: Date | null = null;
  if (attempts >= LOCKOUT_THRESHOLD) {
    lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
  }
  await pool.query(
    `
    UPDATE local_credentials
    SET failed_attempts = $2, last_failed_at = $3, locked_until = $4, updated_at = now()
    WHERE identity_id = $1
  `,
    [identityId, attempts, now, lockedUntil],
  );
  return {
    locked: lockedUntil !== null,
    failedAttempts: attempts,
    lockedUntil,
  };
}

export async function clearLoginFailures(
  pool: pg.Pool,
  identityId: string,
): Promise<void> {
  await pool.query(
    `
    UPDATE local_credentials
    SET failed_attempts = 0, locked_until = NULL, last_failed_at = NULL, updated_at = now()
    WHERE identity_id = $1
  `,
    [identityId],
  );
}
