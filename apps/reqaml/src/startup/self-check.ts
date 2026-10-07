import type pg from "pg";
import type { AppConfig } from "../config.js";
import { isProduction } from "../config.js";
import { checkOpenBao } from "../key/openbao.js";

export async function runStartupSelfCheck(
  config: AppConfig,
  pool: pg.Pool,
): Promise<void> {
  const errors: string[] = [];

  if (isProduction(config)) {
    if (config.REQAML_SEED_ON_START) {
      errors.push("REQAML_SEED_ON_START must be off in production");
    }
    if (config.REQAML_DEV_ACCOUNT_PASSWORD) {
      errors.push(
        "REQAML_DEV_ACCOUNT_PASSWORD must not be set in production (FIX-DENY-DEVENV-PROD-LOGIN.1)",
      );
    }

    const devAccounts = await pool.query(
      "SELECT count(*)::int AS c FROM dev_local_accounts WHERE is_dev_seeded = true",
    );
    if ((devAccounts.rows[0]?.c as number) > 0) {
      errors.push(
        "Seeded dev local accounts exist in database; refuse production startup",
      );
    }
  }

  const openbao = await checkOpenBao(config);
  if (isProduction(config)) {
    if (!openbao.ok) {
      errors.push(`KeyProvider not ready: ${openbao.detail ?? "unknown"}`);
    }
    if (openbao.devMarked) {
      errors.push(
        openbao.detail ??
          "Dev-marked OpenBao configuration refused in production",
      );
    }
  } else if (config.OPENBAO_ADDR && !openbao.ok) {
    errors.push(`Dev OpenBao not ready: ${openbao.detail ?? "unknown"}`);
  }

  if (errors.length) {
    throw new Error(`Startup self-check failed:\n- ${errors.join("\n- ")}`);
  }
}
