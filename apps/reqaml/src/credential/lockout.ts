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

/**
 * Atomically count a login attempt before the password is checked. Returns locked=true (and does
 * not count) while the account is locked. The row lock taken by UPDATE serializes concurrent
 * attempts, so parallel guesses cannot exceed the threshold. A successful login clears the count.
 */
export async function reserveLoginAttempt(
  pool: pg.Pool,
  identityId: string,
): Promise<LockoutState> {
  const r = await pool.query<{ failed_attempts: number; locked_until: Date | null }>(
    `
    WITH next AS (
      SELECT identity_id,
             CASE WHEN last_failed_at IS NULL
                       OR last_failed_at < now() - ($2::int * interval '1 millisecond')
                  THEN 1 ELSE failed_attempts + 1 END AS attempts
      FROM local_credentials
      WHERE identity_id = $1
        AND (locked_until IS NULL OR locked_until <= now())
      FOR UPDATE
    )
    UPDATE local_credentials lc
    SET failed_attempts = next.attempts,
        last_failed_at = now(),
        locked_until = CASE WHEN next.attempts >= $3
                            THEN now() + ($4::int * interval '1 millisecond') ELSE NULL END,
        updated_at = now()
    FROM next
    WHERE lc.identity_id = next.identity_id
    RETURNING lc.failed_attempts, lc.locked_until
  `,
    [identityId, LOCKOUT_WINDOW_MS, LOCKOUT_THRESHOLD, LOCKOUT_DURATION_MS],
  );
  if (!r.rowCount) return getLockoutState(pool, identityId);
  // This attempt was admitted (the lock, if just set, applies to the *next* attempt).
  return { locked: false, failedAttempts: r.rows[0].failed_attempts, lockedUntil: r.rows[0].locked_until };
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
