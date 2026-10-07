import type { AppConfig } from "../config.js";
import { isProduction } from "../config.js";

export type KeyProviderStatus = {
  ok: boolean;
  devMarked: boolean;
  transitEnabled: boolean;
  detail?: string;
};

const DEV_ADDR_MARKERS = ["peripherals:8200", "localhost:8200", "127.0.0.1:8200"];

export function isDevMarkedOpenBaoAddr(addr: string | undefined): boolean {
  if (!addr) return false;
  return DEV_ADDR_MARKERS.some((m) => addr.includes(m));
}

export async function checkOpenBao(
  config: AppConfig,
): Promise<KeyProviderStatus> {
  const addr = config.OPENBAO_ADDR;
  const token = config.OPENBAO_TOKEN;
  if (!addr || !token) {
    return {
      ok: false,
      devMarked: false,
      transitEnabled: false,
      detail: "OPENBAO_ADDR or OPENBAO_TOKEN not configured",
    };
  }

  const devMarked =
    config.REQAML_OPENBAO_DEV_MARKED === true || isDevMarkedOpenBaoAddr(addr);

  if (isProduction(config) && devMarked) {
    return {
      ok: false,
      devMarked: true,
      transitEnabled: false,
      detail: "Dev-marked OpenBao refused in production (FIX-DENY-DEV-KEK-IN-PROD)",
    };
  }

  try {
    const healthRes = await fetch(`${addr.replace(/\/$/, "")}/v1/sys/health`, {
      headers: { "X-Vault-Token": token },
    });
    if (!healthRes.ok && healthRes.status !== 472 && healthRes.status !== 473) {
      return {
        ok: false,
        devMarked,
        transitEnabled: false,
        detail: `OpenBao health HTTP ${healthRes.status}`,
      };
    }

    const mountsRes = await fetch(
      `${addr.replace(/\/$/, "")}/v1/sys/mounts/transit`,
      { headers: { "X-Vault-Token": token } },
    );
    const transitEnabled = mountsRes.ok;

    let kekDev = false;
    if (transitEnabled) {
      const keyRes = await fetch(
        `${addr.replace(/\/$/, "")}/v1/transit/keys/reqaml-kek`,
        { headers: { "X-Vault-Token": token } },
      );
      if (keyRes.ok) {
        const body = (await keyRes.json()) as {
          data?: { custom_metadata?: Record<string, string> };
        };
        kekDev = body.data?.custom_metadata?.reqaml_dev === "true";
      }
    }

    if (isProduction(config) && kekDev) {
      return {
        ok: false,
        devMarked: true,
        transitEnabled,
        detail: "Dev-marked Transit KEK refused in production",
      };
    }

    return {
      ok: transitEnabled,
      devMarked: devMarked || kekDev,
      transitEnabled,
      detail: transitEnabled ? undefined : "Transit engine not mounted",
    };
  } catch (err) {
    return {
      ok: false,
      devMarked,
      transitEnabled: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
