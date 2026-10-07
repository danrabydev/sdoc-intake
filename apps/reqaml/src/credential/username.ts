import { createHash } from "node:crypto";

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function hashUsernameForAudit(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
