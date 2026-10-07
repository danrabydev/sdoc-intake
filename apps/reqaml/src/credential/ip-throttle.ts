import { createHash } from "node:crypto";
import type pg from "pg";

export const IP_LOCKOUT_THRESHOLD = 20;
export const IP_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const IP_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

/** True while this source IP is throttled. Does not count the attempt. */
export async function isIpThrottled(pool: pg.Pool, ip: string | undefined): Promise<boolean> {
  if (!ip) return false;
  const r = await pool.query(
    `SELECT 1 FROM auth_ip_throttle WHERE ip_hash = $1 AND locked_until > now()`,
    [hashIp(ip)],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Count a *failed* login (unknown user, wrong password, wrong MFA code) for the source IP.
 * Successful logins are not counted: behind Docker port publishing every host client shares the
 * bridge gateway IP, so counting all attempts would lock out normal use after 20 sign-ins.
 */
export async function recordIpLoginFailure(
  pool: pg.Pool,
  ip: string | undefined,
): Promise<{ blocked: boolean }> {
  if (!ip) return { blocked: false };
  const ipHash = hashIp(ip);
  const r = await pool.query<{ failed_attempts: number; locked_until: Date | null }>(
    `
    INSERT INTO auth_ip_throttle (ip_hash, failed_attempts, last_failed_at)
    VALUES ($1, 1, now())
    ON CONFLICT (ip_hash) DO UPDATE SET
      failed_attempts = CASE
        WHEN auth_ip_throttle.last_failed_at IS NULL
          OR auth_ip_throttle.last_failed_at < now() - ($2::int * interval '1 millisecond')
        THEN 1 ELSE auth_ip_throttle.failed_attempts + 1 END,
      last_failed_at = now(),
      locked_until = CASE
        WHEN (CASE
          WHEN auth_ip_throttle.last_failed_at IS NULL
            OR auth_ip_throttle.last_failed_at < now() - ($2::int * interval '1 millisecond')
          THEN 1 ELSE auth_ip_throttle.failed_attempts + 1 END) >= $3
        THEN now() + ($4::int * interval '1 millisecond') ELSE auth_ip_throttle.locked_until END
    RETURNING failed_attempts, locked_until
  `,
    [ipHash, IP_LOCKOUT_WINDOW_MS, IP_LOCKOUT_THRESHOLD, IP_LOCKOUT_DURATION_MS],
  );
  const row = r.rows[0];
  if (row.locked_until && row.locked_until.getTime() > Date.now()) {
    return { blocked: true };
  }
  return { blocked: false };
}
