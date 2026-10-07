import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestApp, type TestApp } from "../test/harness.js";
import { assertAllApiRoutesDeclared, listRoutesForSecurityAudit } from "./route-security.js";

let ctx: TestApp;

before(async () => {
  ctx = await createTestApp();
});

after(async () => {
  await ctx.close();
});

describe("route security registration", () => {
  it("every registered route declares public, authenticated, or permission", () => {
    const routes = listRoutesForSecurityAudit(ctx.app);
    // Guard against a vacuous pass (capture not installed or registered too late).
    const seen = new Map(routes.map((r) => [`${r.method} ${r.url}`, r.security?.kind]));
    assert.equal(seen.get("GET /api/v1/projects/:projectId"), "permission");
    assert.equal(seen.get("GET /api/v1/me"), "authenticated");
    assert.equal(seen.get("GET /api/v1/auth/upstream/connectors"), "authenticated");
    assert.equal(seen.get("POST /oauth/token"), "public");
    const missing = assertAllApiRoutesDeclared(routes);
    assert.deepEqual(
      missing,
      [],
      `Routes missing reqalmSecurity: ${missing.join(", ")}`,
    );
  });
});
