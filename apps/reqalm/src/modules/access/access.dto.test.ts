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
  "email",
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
  "@therabyfamily.com",
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

function assertExactKeys(obj: Record<string, unknown>, expected: string[], label: string): void {
  assert.deepEqual(Object.keys(obj).sort(), [...expected].sort(), label);
}

export function assertAccessPersonDto(item: unknown): void {
  assertExactKeys(item as Record<string, unknown>, ["display_name", "roles"], "AccessPerson");
}

export function assertAccessGrantDto(item: unknown): void {
  const row = item as { id: string; role: string; person: Record<string, unknown> };
  assertExactKeys(row, ["id", "role", "person"], "AccessGrant");
  assertExactKeys(row.person, ["display_name"], "AccessGrant.person");
}

export function assertPlatformGrantDto(item: unknown): void {
  assertAccessGrantDto(item);
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

export function assertAccessPeoplePage(payload: unknown): void {
  assertAccessDtoHygiene(payload);
  const page = payload as { items: unknown[] };
  for (const item of page.items) assertAccessPersonDto(item);
}

export function assertAccessGrantPage(payload: unknown): void {
  assertAccessDtoHygiene(payload);
  const page = payload as { items: unknown[] };
  for (const item of page.items) assertAccessGrantDto(item);
}

export function assertPlatformGrantPage(payload: unknown): void {
  assertAccessDtoHygiene(payload);
  const page = payload as { items: unknown[] };
  for (const item of page.items) assertPlatformGrantDto(item);
}

describe("access DTO hygiene", () => {
  it("rejects payloads that echo credential, identity, or email fields", () => {
    assertAccessPeoplePage({
      items: [{ display_name: "Casey Reader", roles: ["Reader"] }],
    });
    assert.throws(() => assertAccessDtoHygiene({ password_hash: "x" }));
    assert.throws(() => assertAccessDtoHygiene({ person: { external_sub: "oidc:x" } }));
    assert.throws(() => assertAccessDtoHygiene({ identity_id: "casey-reader" }));
    assert.throws(() => assertAccessPeoplePage({ items: [{ id: "x", display_name: "x", roles: [] }] }));
    assert.throws(() =>
      assertAccessGrantPage({
        items: [{ id: "g1", role: "Reader", person: { id: "x", display_name: "x", email: "a@b.c" } }],
      }),
    );
  });
});
