import { createHash, timingSafeEqual } from "node:crypto";

export function verifyPkceS256(
  codeVerifier: string,
  codeChallenge: string,
): boolean {
  const digest = createHash("sha256").update(codeVerifier).digest();
  const computed = digest
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (computed.length !== codeChallenge.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(codeChallenge));
}

export function validateAuthorizePkce(
  method: string | undefined,
  challenge: string | undefined,
): string | null {
  if (!challenge) return "code_challenge required";
  if (method !== "S256") return "only S256 PKCE is supported";
  return null;
}
