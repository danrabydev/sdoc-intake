import type { AppConfig } from "../../config.js";
import { probeOpenBao } from "../../key/openbao.js";
import type { CheckResult } from "../types.js";

export function openBaoStatusToCheck(status: {
  ok: boolean;
  detail?: string;
  sealed?: boolean;
  transitKekUsable?: boolean;
}): CheckResult {
  if (status.ok) {
    return { ok: true };
  }
  const parts: string[] = [];
  if (status.sealed) parts.push("sealed");
  if (status.transitKekUsable === false) parts.push("transit_kek_unusable");
  if (status.detail) parts.push(status.detail);
  return {
    ok: false,
    detail: parts.join("; ") || "OpenBao not ready",
  };
}

export async function checkOpenBaoLive(
  config: AppConfig,
  timeoutMs: number,
): Promise<CheckResult> {
  if (!config.OPENBAO_ADDR) {
    return { ok: true, detail: "OpenBao not configured (skipped)" };
  }
  const status = await probeOpenBao(config, { timeoutMs });
  return openBaoStatusToCheck(status);
}
