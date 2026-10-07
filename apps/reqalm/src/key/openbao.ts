import type { AppConfig } from "../config.js";
import { isProduction } from "../config.js";

export type KeyProviderStatus = {
  ok: boolean;
  devMarked: boolean;
  transitEnabled: boolean;
  sealed?: boolean;
  initialized?: boolean;
  transitKekUsable?: boolean;
  detail?: string;
};

export const DEV_TRANSIT_MARKER = "reqalm_dev=true";
/** Mount description written by pre-rename dev stacks (still dev-only; refused in production). */
export const LEGACY_DEV_TRANSIT_MARKER = "reqaml_dev=true";
/**
 * Persisted OpenBao Transit key name. Keeps the legacy ReqAML spelling: existing ciphertexts
 * (signing keys, MFA secrets, web sessions) are bound to this key and Transit keys cannot be renamed.
 */
export const TRANSIT_KEK_NAME = "reqaml-kek";
const READINESS_PLAINTEXT = Buffer.from("reqalm-readiness-probe").toString(
  "base64",
);

const DEV_ADDR_MARKERS = [
  "peripherals:8200",
  "localhost:8200",
  "127.0.0.1:8200",
];

export function isDevMarkedOpenBaoAddr(addr: string | undefined): boolean {
  if (!addr) return false;
  return DEV_ADDR_MARKERS.some((m) => addr.includes(m));
}

export type OpenBaoProbeOptions = {
  timeoutMs?: number;
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function normalizeAddr(addr: string): string {
  return addr.replace(/\/$/, "");
}

/** Live OpenBao / Transit probe (readiness + startup wait). */
export async function probeOpenBao(
  config: AppConfig,
  options: OpenBaoProbeOptions = {},
): Promise<KeyProviderStatus> {
  const timeoutMs = options.timeoutMs ?? 3_000;
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

  const base = normalizeAddr(addr);
  const devMarked =
    config.REQALM_OPENBAO_DEV_MARKED === true || isDevMarkedOpenBaoAddr(addr);

  if (isProduction(config) && devMarked) {
    return {
      ok: false,
      devMarked: true,
      transitEnabled: false,
      detail:
        "Dev-marked OpenBao refused in production (FIX-DENY-DEV-KEK-IN-PROD)",
    };
  }

  try {
    const healthRes = await fetchWithTimeout(
      `${base}/v1/sys/health`,
      { headers: { "X-Vault-Token": token } },
      timeoutMs,
    );

    let sealed = healthRes.status === 503;
    let initialized = healthRes.status !== 501;
    try {
      const healthBody = (await healthRes.json()) as {
        sealed?: boolean;
        initialized?: boolean;
      };
      if (typeof healthBody.sealed === "boolean") sealed = healthBody.sealed;
      if (typeof healthBody.initialized === "boolean") {
        initialized = healthBody.initialized;
      }
    } catch {
      /* non-JSON health is still informative via status code */
    }

    if (!initialized) {
      return {
        ok: false,
        devMarked,
        transitEnabled: false,
        sealed,
        initialized: false,
        detail: "OpenBao not initialized",
      };
    }

    if (sealed) {
      return {
        ok: false,
        devMarked,
        transitEnabled: false,
        sealed: true,
        initialized: true,
        detail: "OpenBao sealed",
      };
    }

    if (!healthRes.ok && healthRes.status !== 472 && healthRes.status !== 473) {
      return {
        ok: false,
        devMarked,
        transitEnabled: false,
        sealed,
        initialized,
        detail: `OpenBao health HTTP ${healthRes.status}`,
      };
    }

    const mountsRes = await fetchWithTimeout(
      `${base}/v1/sys/mounts/transit`,
      { headers: { "X-Vault-Token": token } },
      timeoutMs,
    );
    const transitEnabled = mountsRes.ok;

    let kekDev = false;
    if (transitEnabled) {
      const mount = (await mountsRes.json()) as {
        description?: string;
        data?: { description?: string };
      };
      const description = mount.description ?? mount.data?.description ?? "";
      kekDev =
        description.includes(DEV_TRANSIT_MARKER) || description.includes(LEGACY_DEV_TRANSIT_MARKER);
    }

    if (isProduction(config) && kekDev) {
      return {
        ok: false,
        devMarked: true,
        transitEnabled,
        detail:
          "Dev-marked Transit mount refused in production (FIX-DENY-DEV-KEK-IN-PROD)",
      };
    }

    let transitKekUsable = false;
    if (transitEnabled) {
      const encRes = await fetchWithTimeout(
        `${base}/v1/transit/encrypt/${TRANSIT_KEK_NAME}`,
        {
          method: "POST",
          headers: {
            "X-Vault-Token": token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ plaintext: READINESS_PLAINTEXT }),
        },
        timeoutMs,
      );
      if (!encRes.ok) {
        return {
          ok: false,
          devMarked: devMarked || kekDev,
          transitEnabled: true,
          sealed: false,
          initialized: true,
          transitKekUsable: false,
          detail: `Transit encrypt failed HTTP ${encRes.status}`,
        };
      }
      const encBody = (await encRes.json()) as {
        data?: { ciphertext?: string };
      };
      const ciphertext = encBody.data?.ciphertext;
      if (!ciphertext) {
        return {
          ok: false,
          devMarked: devMarked || kekDev,
          transitEnabled: true,
          transitKekUsable: false,
          detail: "Transit encrypt returned no ciphertext",
        };
      }

      const decRes = await fetchWithTimeout(
        `${base}/v1/transit/decrypt/${TRANSIT_KEK_NAME}`,
        {
          method: "POST",
          headers: {
            "X-Vault-Token": token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ciphertext }),
        },
        timeoutMs,
      );
      if (!decRes.ok) {
        return {
          ok: false,
          devMarked: devMarked || kekDev,
          transitEnabled: true,
          transitKekUsable: false,
          detail: `Transit decrypt failed HTTP ${decRes.status}`,
        };
      }
      const decBody = (await decRes.json()) as {
        data?: { plaintext?: string };
      };
      transitKekUsable = decBody.data?.plaintext === READINESS_PLAINTEXT;
      if (!transitKekUsable) {
        return {
          ok: false,
          devMarked: devMarked || kekDev,
          transitEnabled: true,
          transitKekUsable: false,
          detail: "Transit decrypt round-trip mismatch",
        };
      }
    }

    const ok = transitEnabled && transitKekUsable;
    return {
      ok,
      devMarked: devMarked || kekDev,
      transitEnabled,
      sealed: false,
      initialized: true,
      transitKekUsable,
      detail: ok ? undefined : "Transit engine not mounted or KEK unusable",
    };
  } catch (err) {
    const detail =
      err instanceof Error && err.name === "TimeoutError"
        ? "OpenBao probe timed out"
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      ok: false,
      devMarked,
      transitEnabled: false,
      detail,
    };
  }
}

/** @deprecated use probeOpenBao — kept for imports during transition */
export async function checkOpenBao(
  config: AppConfig,
  options?: OpenBaoProbeOptions,
): Promise<KeyProviderStatus> {
  return probeOpenBao(config, options);
}
