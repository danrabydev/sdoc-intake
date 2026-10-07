import type { AppConfig } from "../config.js";
import { isProduction } from "../config.js";
import { probeOpenBao } from "../key/openbao.js";
import { checkDatabase } from "../readiness/checks/database.js";
import type pg from "pg";

export type WaitOptions = {
  maxWaitMs: number;
  initialDelayMs: number;
  backoffFactor: number;
  probeTimeoutMs: number;
};

const defaultWaitOptions: WaitOptions = {
  maxWaitMs: 120_000,
  initialDelayMs: 1_000,
  backoffFactor: 1.5,
  probeTimeoutMs: 3_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveWaitOptions(config: AppConfig): WaitOptions {
  return {
    maxWaitMs: config.REQALM_STARTUP_MAX_WAIT_MS ?? defaultWaitOptions.maxWaitMs,
    initialDelayMs:
      config.REQALM_STARTUP_INITIAL_DELAY_MS ??
      defaultWaitOptions.initialDelayMs,
    backoffFactor: defaultWaitOptions.backoffFactor,
    probeTimeoutMs:
      config.REQALM_READY_PROBE_TIMEOUT_MS ?? defaultWaitOptions.probeTimeoutMs,
  };
}

async function waitForCheck(
  label: string,
  probe: () => Promise<{ ok: boolean; detail?: string }>,
  options: WaitOptions,
  production: boolean,
): Promise<void> {
  const deadline = Date.now() + options.maxWaitMs;
  let delay = options.initialDelayMs;
  let lastDetail = "unknown";

  while (Date.now() < deadline) {
    const result = await probe();
    if (result.ok) {
      return;
    }
    lastDetail = result.detail ?? "not ready";
    console.warn(`[startup] waiting for ${label}: ${lastDetail}`);
    await sleep(delay);
    delay = Math.min(Math.floor(delay * options.backoffFactor), 15_000);
  }

  const msg = `Timed out after ${options.maxWaitMs}ms waiting for ${label}: ${lastDetail}`;
  if (production) {
    throw new Error(msg);
  }
  throw new Error(msg);
}

/** Backoff wait for Postgres + OpenBao so Compose does not crash-loop on unseal race. */
export async function waitForPeripherals(
  config: AppConfig,
  pool: pg.Pool,
): Promise<void> {
  const options = resolveWaitOptions(config);
  const production = isProduction(config);

  await waitForCheck(
    "database",
    () => checkDatabase(pool, options.probeTimeoutMs),
    options,
    production,
  );

  if (!config.OPENBAO_ADDR) {
    return;
  }

  await waitForCheck(
    "OpenBao",
    async () => {
      const status = await probeOpenBao(config, {
        timeoutMs: options.probeTimeoutMs,
      });
      // A dev-marked OpenBao in production is a policy refusal, not a transient outage: stop
      // waiting so runStartupSelfCheck fails fast with the explicit FIX-DENY-DEV-KEK-IN-PROD error.
      if (production && status.devMarked) {
        return { ok: true };
      }
      return { ok: status.ok, detail: status.detail };
    },
    options,
    production,
  );
}
