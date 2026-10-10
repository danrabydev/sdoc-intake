import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_AUDIT_RANGE_MS,
  redactInvalidAuditQueryParams,
  resolveAuditTimeBounds,
} from "./audit-api-schemas.js";

describe("redactInvalidAuditQueryParams", () => {
  it("redacts invalid filter values on audit list URLs", () => {
    const raw = "/api/v1/projects/reqalm/audit-events?actor=!!bad!!&limit=5";
    const out = redactInvalidAuditQueryParams(raw);
    assert.ok(out.includes("audit-events"));
    assert.ok(!out.includes("!!bad!!"));
    assert.ok(out.includes("actor=%5Binvalid%5D") || out.includes("actor=[invalid]"));
    assert.ok(out.includes("limit=5"));
  });

  it("leaves non-audit URLs unchanged", () => {
    assert.equal(redactInvalidAuditQueryParams("/api/v1/projects/reqalm/grants?actor=!!bad!!"), "/api/v1/projects/reqalm/grants?actor=!!bad!!");
  });
});

describe("resolveAuditTimeBounds", () => {
  const t0 = Date.parse("2026-06-01T12:00:00Z");

  it("allows exactly 90 days and rejects 90 days plus one second", () => {
    const from = "2026-01-01T00:00:00Z";
    const toOk = "2026-04-01T00:00:00.000Z";
    assert.equal(Date.parse(toOk) - Date.parse(from), MAX_AUDIT_RANGE_MS);
    assert.ok(resolveAuditTimeBounds(from, toOk, t0).ok);
    const toBad = "2026-04-01T00:00:01Z";
    const wide = resolveAuditTimeBounds(from, toBad, t0);
    assert.equal(wide.ok, false);
    if (!wide.ok) assert.equal(wide.message, "time range too wide");
  });

  it("defaults to the last 90 days when neither bound is given", () => {
    const r = resolveAuditTimeBounds(undefined, undefined, t0);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.to, new Date(t0).toISOString());
      assert.equal(r.from, new Date(t0 - MAX_AUDIT_RANGE_MS).toISOString());
      assert.equal(Date.parse(r.to) - Date.parse(r.from), MAX_AUDIT_RANGE_MS);
    }
  });

  it("caps an open-ended from at now or from plus 90 days", () => {
    const r = resolveAuditTimeBounds("2026-05-01T00:00:00Z", undefined, t0);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.to, new Date(t0).toISOString());
      assert.equal(r.from, "2026-05-01T00:00:00Z");
    }
  });

  it("extends to backward from a lone to", () => {
    const r = resolveAuditTimeBounds(undefined, "2026-06-01T00:00:00Z", t0);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.to, "2026-06-01T00:00:00Z");
      assert.equal(Date.parse(r.to) - Date.parse(r.from), MAX_AUDIT_RANGE_MS);
    }
  });
});
