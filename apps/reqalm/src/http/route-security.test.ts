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
  it("every API route declares public, authenticated, or permission", () => {
    const routes = listRoutesForSecurityAudit(ctx.app);
    const missing = assertAllApiRoutesDeclared(routes);
    assert.deepEqual(
      missing,
      [],
      `Routes missing reqalmSecurity: ${missing.join(", ")}`,
    );
  });
});
