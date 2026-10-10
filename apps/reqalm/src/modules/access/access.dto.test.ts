import assert from "node:assert/strict";
import { describe, it } from "node:test";

const FORBIDDEN_KEYS = new Set([
  "password_hash",
  "mfa_secret_encrypted",
  "mfa_enabled",
  "external_sub",
  "private_key_ciphertext",
  "public_jwk",
  "dek_ciphertext",
  "session",
  "refresh_token",
  "access_token",
  "signing_keys",
  "client_secret_hash",
  "wrapped_dek",
  "storage_key",
  "identity_id",
  "sub",
  "jti",
]);

const FORBIDDEN_SUBSTRINGS = [
  "password_hash",
  "mfa_secret",
  "oauth_refresh",
  "auth_sessions",
  "signing_key",
  "BEGIN PRIVATE",
  "argon2",
  "external_sub",
  "oidc:",
];

function collectKeys(value: unknown, keys: Set<string>): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, keys);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    keys.add(k);
    collectKeys(v, keys);
  }
}

export function assertAccessDtoHygiene(payload: unknown): void {
  const keys = new Set<string>();
  collectKeys(payload, keys);
  for (const k of keys) {
    assert.ok(!FORBIDDEN_KEYS.has(k), `forbidden key ${k}`);
    assert.ok(!k.includes("cyber_gate") && !k.includes("gate_signoffs"), k);
  }
  const raw = JSON.stringify(payload);
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    assert.ok(!raw.includes(needle), needle);
  }
}

describe("access DTO hygiene", () => {
  it("rejects payloads that echo credential or session fields", () => {
    assertAccessDtoHygiene({
      items: [
        {
          id: "casey-reader",
          display_name: "Casey Reader",
          email: "casey.reader@therabyfamily.com",
          roles: ["Reader"],
        },
      ],
    });
    assert.throws(() =>
      assertAccessDtoHygiene({ password_hash: "x" }),
    );
    assert.throws(() =>
      assertAccessDtoHygiene({ person: { external_sub: "oidc:x" } }),
    );
    assert.throws(() =>
      assertAccessDtoHygiene({ identity_id: "casey-reader" }),
    );
  });
});
