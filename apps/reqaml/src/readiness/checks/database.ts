import type pg from "pg";
import type { CheckResult } from "../types.js";

export async function checkDatabase(pool: pg.Pool): Promise<CheckResult> {
  try {
    await pool.query("SELECT 1");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
