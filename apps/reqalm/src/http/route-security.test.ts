import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Fastify from "fastify";
import { createTestApp, type TestApp } from "../test/harness.js";
import {
  assertAllApiRoutesDeclared,
  assertBusinessApiRoutesCompliant,
  installRouteCapture,
  listRoutesForSecurityAudit,
  type RegisteredRouteSecurity,
} from "./route-security.js";

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

  it("every /api/ business route uses defineOperationRoute with matching security", () => {
    const routes = listRoutesForSecurityAudit(ctx.app);
    const violations = assertBusinessApiRoutesCompliant(routes);
    assert.deepEqual(
      violations,
      [],
      `Business route violations: ${violations.join("; ")}`,
    );
    for (const r of routes) {
      if (r.url.startsWith("/api/v1/") && r.url.includes("projects")) {
        assert.equal(r.operationRoute, true, r.url);
      }
    }
  });
});

describe("assertBusinessApiRoutesCompliant (mutation cases)", () => {
  it("rejects hand-wired permission marker without the operation helper", () => {
    const routes: RegisteredRouteSecurity[] = [
      {
        method: "GET",
        url: "/api/v1/evil",
        security: { kind: "permission", permission: "requirement:read" },
        operationRoute: false,
      },
    ];
    const violations = assertBusinessApiRoutesCompliant(routes);
    assert.ok(violations.some((v) => v.includes("defineOperationRoute")));
  });

  it("rejects security marker that disagrees with the operation ref", () => {
    const routes: RegisteredRouteSecurity[] = [
      {
        method: "GET",
        url: "/api/v1/projects/:projectId",
        security: { kind: "permission", permission: "grant:manage" },
        operationRoute: true,
        operationRef: {
          name: "projects.get",
          permission: "requirement:read",
          projectScoped: true,
        },
      },
    ];
    const violations = assertBusinessApiRoutesCompliant(routes);
    assert.ok(violations.some((v) => v.includes("disagrees with operation")));
  });

  const hand = (method: string, url: string, security?: RegisteredRouteSecurity["security"]) =>
    [{ method, url, security, operationRoute: false }] as RegisteredRouteSecurity[];

  it("allowlist is exact on method and path", () => {
    assert.deepEqual(assertBusinessApiRoutesCompliant(hand("GET", "/api/v1/auth/session", { kind: "public" })), []);
    assert.deepEqual(assertBusinessApiRoutesCompliant(hand("HEAD", "/api/v1/seed/summary", { kind: "public" })), []);
    for (const [method, url] of [
      ["DELETE", "/api/v1/auth/session"],
      ["POST", "/api/v1/seed/summary"],
      ["GET", "/api/v1/auth/session/extra"],
      ["GET", "/api/v1/auth/upstream/connectors/:id"],
      ["GET", "/api/v1/auth"],
    ]) {
      assert.equal(
        assertBusinessApiRoutesCompliant(hand(method, url, { kind: "authenticated" })).length,
        1,
        `${method} ${url} must not be exempt`,
      );
    }
  });

  it("covers every /api/ version, and permission markers anywhere", () => {
    assert.equal(assertBusinessApiRoutesCompliant(hand("GET", "/api/v2/x", { kind: "authenticated" })).length, 1);
    assert.equal(
      assertBusinessApiRoutesCompliant(hand("POST", "/admin", { kind: "permission", permission: "grant:manage" })).length,
      1,
    );
    // Outside /api/, a non-permission route is left to the all-routes declaration check.
    assert.deepEqual(assertBusinessApiRoutesCompliant(hand("GET", "/admin", { kind: "authenticated" })), []);
    assert.deepEqual(assertAllApiRoutesDeclared(hand("GET", "/admin")), ["GET /admin"]);
  });

  it("detects a live hand-registered business route on a throwaway app", async () => {
    const app = Fastify();
    installRouteCapture(app);
    app.get(
      "/api/v1/bypass",
      { config: { reqalmSecurity: { kind: "permission", permission: "requirement:read" } } },
      async () => ({ hacked: true }),
    );
    await app.ready();
    const violations = assertBusinessApiRoutesCompliant(listRoutesForSecurityAudit(app));
    assert.ok(violations.length >= 1);
    await app.close();
  });
});
