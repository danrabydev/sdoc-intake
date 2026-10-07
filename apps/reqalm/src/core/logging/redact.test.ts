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
});
