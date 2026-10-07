import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type pg from "pg";
import { runOperation } from "./operation.js";
import type { RequestContext } from "./request-context.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";
import { createTestApp } from "../test/harness.js";
import { ok } from "./service-result.js";

function minimalCtx(pool: pg.Pool, requestId = "op-test"): RequestContext {
  return {
    requestId,
    traceId: null,
    spanId: null,
    ip: "127.0.0.1",
    userAgent: null,
    pool,
    config: {} as RequestContext["config"],
    keyProvider: {} as RequestContext["keyProvider"],
    logger: {
      info() {},
      error() {},
      warn() {},
      debug() {},
      trace() {},
      fatal() {},
      silent() {},
      level: "info",
      child() {
        return this;
      },
    } as RequestContext["logger"],
    clock: { now: () => 0 },
    auth: {
      accessToken: { sub: "casey-reader", client_id: "reqalm-web", aud: "http://localhost/api" },
      rawAccessToken: "x",
      fromSession: false,
    },
    identityId: "casey-reader",
    projectGrants: [{ project_id: "reqalm", role: "Reader" }],
    projectIds: new Set(["reqalm"]),
    effectiveRoles: ["Reader"],
    permissions: new Set(["requirement:read"]),
    agentName: null,
    tokenRole: null,
    actingFor: null,
  };
}

describe("runOperation", () => {
  it("audits error when execute throws", async () => {
    const fixture = await createMigratedPglitePool();
    const ctx = minimalCtx(fixture.pool);
    await runOperation(
      ctx,
      {
        name: "test.throw",
        execute: async () => {
          throw new Error("boom");
        },
      },
      {},
    );
    const r = await fixture.pool.query<{ outcome: string }>(
      `SELECT outcome FROM audit_events WHERE request_id = $1`,
      ["op-test"],
    );
    assert.equal(r.rows[0]?.outcome, "error");
    await fixture.close();
  });

  it("project-scoped op without a project id fails closed (not_found, audited deny)", async () => {
    const fixture = await createMigratedPglitePool();
    const ctx = minimalCtx(fixture.pool, "op-noproj");
    const res = await runOperation(
      ctx,
      {
        name: "test.noproj",
        permission: "requirement:read",
        projectScoped: true,
        projectIdFromInput: () => undefined,
        execute: async () => ok("leak"),
      },
      {},
    );
    assert.equal(!res.ok && res.error.code, "not_found");
    const r = await fixture.pool.query<{ outcome: string }>(
      `SELECT outcome FROM audit_events WHERE request_id = 'op-noproj'`,
    );
    assert.equal(r.rows[0]?.outcome, "deny");
    await fixture.close();
  });

  it("authorizes with the token-bound agent role, not the identity's wider grants", async () => {
    const app = await createTestApp();
    try {
      const grants = await app.pool.query<{ role: string }>(
        `SELECT role FROM project_grants WHERE identity_id = 'agent-cursor-cloud'
           AND project_id = 'reqalm' AND revoked_at IS NULL`,
      );
      const roles = grants.rows.map((g) => g.role);
      assert.ok(roles.includes("Author") && roles.includes("Reader"), `seed grants: ${roles}`);
      const op = {
        name: "test.write",
        permission: "requirement:write",
        projectScoped: true,
        projectIdFromInput: () => "reqalm",
        execute: async () => ok("written"),
      };
      const agentCtx = (role: string): RequestContext => ({
        ...minimalCtx(app.pool, `op-agent-${role}`),
        auth: {
          accessToken: {
            sub: "agent-cursor-cloud",
            aud: "http://localhost/api",
            client_id: "reqalm-agent-dev",
            agent_name: "cursor-cloud",
            reqalm_role: role,
          },
          rawAccessToken: "x",
          fromSession: false,
        },
        identityId: "agent-cursor-cloud",
        projectIds: new Set(["reqalm"]),
      });
      const asReader = await runOperation(agentCtx("Reader"), op, {});
      assert.equal(!asReader.ok && asReader.error.code, "forbidden");
      const asAuthor = await runOperation(agentCtx("Author"), op, {});
      assert.equal(asAuthor.ok, true);
    } finally {
      await app.close();
    }
  });
});
