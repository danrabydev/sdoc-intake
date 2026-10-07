import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactForLog } from "./redact.js";

describe("redactForLog", () => {
  it("redacts sensitive keys", () => {
    const out = redactForLog({
      username: "casey",
      password: "secret123",
      refresh_token: "abc",
      nested: { client_secret: "x", ok: true },
    }) as Record<string, unknown>;
    assert.equal(out.password, "[REDACTED]");
    assert.equal(out.refresh_token, "[REDACTED]");
    assert.equal((out.nested as Record<string, unknown>).client_secret, "[REDACTED]");
    assert.equal((out.nested as Record<string, unknown>).ok, true);
    assert.equal(out.username, "casey");
  });

  it("redacts every sensitive key family, including inside nested arrays", () => {
    const keys = [
      "password",
      "client_secret",
      "access_token",
      "Authorization",
      "refresh",
      "csrf",
      "mfa_code",
      "credential",
      "api_key",
      "apiKey",
    ];
    for (const key of keys) {
      const out = redactForLog({ [key]: "v", items: [{ [key]: "v" }] }) as Record<string, unknown>;
      assert.equal(out[key], "[REDACTED]", key);
      assert.equal((out.items as Array<Record<string, unknown>>)[0][key], "[REDACTED]", `items[].${key}`);
    }
  });
});

