import type { AppConfig } from "../config.js";
import { isProduction } from "../config.js";
import { probeOpenBao, TRANSIT_KEK_NAME } from "./openbao.js";

export type KeyProvider = {
  wrapSecret(plaintext: Buffer, purpose: string): Promise<string>;
  unwrapSecret(ciphertext: string, purpose: string): Promise<Buffer>;
  ensureReady(): Promise<void>;
};

function normalizeAddr(addr: string): string {
  return addr.replace(/\/$/, "");
}

async function transitEncrypt(
  config: AppConfig,
  plaintextB64: string,
  keyName: string,
): Promise<string> {
  const base = normalizeAddr(config.OPENBAO_ADDR!);
  const res = await fetch(`${base}/v1/transit/encrypt/${keyName}`, {
    method: "POST",
    headers: {
      "X-Vault-Token": config.OPENBAO_TOKEN!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ plaintext: plaintextB64 }),
    signal: AbortSignal.timeout(config.REQAML_READY_PROBE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Transit encrypt failed HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data?: { ciphertext?: string } };
  if (!body.data?.ciphertext) {
    throw new Error("Transit encrypt returned no ciphertext");
  }
  return body.data.ciphertext;
}

async function transitDecrypt(
  config: AppConfig,
  ciphertext: string,
  keyName: string,
): Promise<string> {
  const base = normalizeAddr(config.OPENBAO_ADDR!);
  const res = await fetch(`${base}/v1/transit/decrypt/${keyName}`, {
    method: "POST",
    headers: {
      "X-Vault-Token": config.OPENBAO_TOKEN!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ciphertext }),
    signal: AbortSignal.timeout(config.REQAML_READY_PROBE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Transit decrypt failed HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data?: { plaintext?: string } };
  if (!body.data?.plaintext) {
    throw new Error("Transit decrypt returned no plaintext");
  }
  return body.data.plaintext;
}

export function createOpenBaoKeyProvider(config: AppConfig): KeyProvider {
  return {
    async ensureReady() {
      const status = await probeOpenBao(config);
      if (!status.ok) {
        const msg = status.detail ?? "KeyProvider unavailable";
        if (isProduction(config)) {
          throw new Error(`${msg} (FIX-DENY-KEK-UNREACHABLE-PROD)`);
        }
        throw new Error(msg);
      }
    },
    async wrapSecret(plaintext, purpose) {
      const dekKey = `reqaml-dek-${purpose}`;
      const b64 = plaintext.toString("base64");
      return transitEncrypt(config, b64, dekKey).catch(async () => {
        // Fall back to shared KEK if purpose-specific DEK key not created yet.
        return transitEncrypt(config, b64, TRANSIT_KEK_NAME);
      });
    },
    async unwrapSecret(ciphertext, purpose) {
      const dekKey = `reqaml-dek-${purpose}`;
      let b64: string;
      try {
        b64 = await transitDecrypt(config, ciphertext, dekKey);
      } catch {
        b64 = await transitDecrypt(config, ciphertext, TRANSIT_KEK_NAME);
      }
      return Buffer.from(b64, "base64");
    },
  };
}
