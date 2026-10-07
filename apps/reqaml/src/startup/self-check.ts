import type pg from "pg";
import type { AppConfig } from "../config.js";
import { isProduction } from "../config.js";
import { isDevMarkedOpenBaoAddr, probeOpenBao } from "../key/openbao.js";

/** Policy checks that do not substitute for live /ready probes (ARCH-DEVENV-IDENTITY.1). */
export async function runStartupSelfCheck(
  config: AppConfig,
  pool: pg.Pool,
): Promise<void> {
  const errors: string[] = [];

  if (isProduction(config)) {
    const issuer = process.env.REQAML_ISSUER_URL?.trim();
    if (!issuer) {
      errors.push("REQAML_ISSUER_URL must be set in production");
    } else if (!issuer.startsWith("https://")) {
      errors.push("REQAML_ISSUER_URL must use https in production");
    }
    if (!process.env.REQAML_SESSION_SECRET?.trim()) {
      errors.push("REQAML_SESSION_SECRET must be set in production");
    }
    if (config.REQAML_SEED_ON_START) {
      errors.push("REQAML_SEED_ON_START must be off in production");
    }
    if (config.REQAML_DEV_ACCOUNT_PASSWORD) {
      errors.push(
        "REQAML_DEV_ACCOUNT_PASSWORD must not be set in production (FIX-DENY-DEVENV-PROD-LOGIN.1)",
      );
    }

    const devAccounts = await pool.query(
      "SELECT count(*)::int AS c FROM local_credentials WHERE is_dev_seeded = true",
    );
    if ((devAccounts.rows[0]?.c as number) > 0) {
      errors.push(
        "Seeded dev local accounts exist in database; refuse production startup",
      );
    }

    if (
      config.REQAML_OPENBAO_DEV_MARKED ||
      isDevMarkedOpenBaoAddr(config.OPENBAO_ADDR)
    ) {
      errors.push(
        "Dev-marked OpenBao configuration refused in production (FIX-DENY-DEV-KEK-IN-PROD)",
      );
    } else if (config.OPENBAO_ADDR) {
      // Non-dev address: still refuse a dev-marked Transit mount (marker set by the peripherals init).
      const bao = await probeOpenBao(config, {
        timeoutMs: config.REQAML_READY_PROBE_TIMEOUT_MS,
      });
      if (bao.devMarked) {
        errors.push(bao.detail ?? "Dev-marked OpenBao refused in production");
      }
    }
  }

  if (errors.length) {
    throw new Error(`Startup self-check failed:\n- ${errors.join("\n- ")}`);
  }
}
