import { hash, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";

const ARGON2_PARAMS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export type StoredPasswordHash = {
  algorithm: "argon2id";
  encoding: string;
};

export async function hashPassword(plain: string): Promise<string> {
  const digest = await hash(plain, {
    algorithm: 2, // Argon2id
    ...ARGON2_PARAMS,
  });
  return `argon2id:${digest}`;
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (stored.startsWith("argon2id:")) {
    return verify(stored.slice("argon2id:".length), plain, {
      algorithm: 2,
      ...ARGON2_PARAMS,
    });
  }
  // Legacy dev seed sha256:salt:digest — verify once, caller should rehash.
  if (stored.startsWith("sha256:")) {
    const [, salt, digest] = stored.split(":");
    if (!salt || !digest) return false;
    const { createHash } = await import("node:crypto");
    const check = createHash("sha256")
      .update(`${salt}:${plain}`)
      .digest("hex");
    return check === digest;
  }
  return false;
}

export function needsRehash(stored: string): boolean {
  return !stored.startsWith("argon2id:");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
