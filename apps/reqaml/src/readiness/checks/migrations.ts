import type pg from "pg";
import { getMigrationStatus } from "../../db/migrate.js";
import type { CheckResult } from "../types.js";

export async function checkMigrationsCurrent(
  pool: pg.Pool,
): Promise<CheckResult> {
  try {
    const status = await getMigrationStatus(pool);
    if (status.upToDate) {
      return { ok: true };
    }
    return {
      ok: false,
      detail: `Pending migrations: ${status.pending.join(", ")}`,
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
