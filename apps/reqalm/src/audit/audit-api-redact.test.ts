import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactAuditDetail } from "./audit-api-redact.js";

describe("redactAuditDetail", () => {
  it("redacts secrets and drops session ids from detail", () => {
    const out = redactAuditDetail({
      refresh_token: "rt-secret",
      session_id: "sess-abc",
      sessionId: "sess-def",
      note: "ok",
      nested: { api_key: "k", keep: 1 },
    });
    assert.equal(out.refresh_token, "[REDACTED]");
    assert.equal(out.note, "ok");
    assert.equal("session_id" in out, false);
    assert.equal("sessionId" in out, false);
    assert.deepEqual(out.nested, { api_key: "[REDACTED]", keep: 1 });
  });
});
