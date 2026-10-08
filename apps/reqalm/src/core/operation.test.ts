import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type pg from "pg";
import { runOperation, type OperationDef } from "./operation.js";
import type { PageQuery, PageResult } from "./paging.js";
import type { RequestContext } from "./request-context.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";
import { createTestApp } from "../test/harness.js";
import { ok } from "./service-result.js";
import { resetTelemetrySpans, finishedSpans } from "../test/otel-testing.js";
import { trace } from "@opentelemetry/api";
import { setSpanError } from "../telemetry/trace-context.js";

function minimalCtx(pool: pg.Pool, requestId = "op-test"): RequestContext {
  return {
    requestId,
    traceId: null,
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
    agentName: null,
    tokenRole: null,
    actingFor: null,
  };
}

describe("runOperation", () => {
  it("audits error when execute throws", async () => {
    resetTelemetrySpans();
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
    const opSpan = finishedSpans().find((s) => s.name === "operation test.throw");
    assert.ok(opSpan);
    assert.equal(opSpan!.status.message, "operation failed");
    assert.equal(opSpan!.attributes["reqalm.error_kind"], "internal");
    assert.doesNotMatch(JSON.stringify([opSpan!.status, opSpan!.events, opSpan!.attributes]), /boom/);
    await fixture.close();
  });

  it("setSpanError itself writes only the generic message and the error kind (before export)", () => {
    trace.getTracer("op-test").startActiveSpan("raw-span", (span) => {
      setSpanError(span, "validation");
      const raw = span as unknown as { status: { message?: string }; attributes: Record<string, unknown>; events: unknown[] };
      assert.equal(raw.status.message, "operation failed");
      assert.equal(raw.attributes["reqalm.error_kind"], "validation");
      assert.deepEqual(JSON.parse(JSON.stringify(raw.events)).map((e: { attributes: unknown }) => e.attributes), [
        { "exception.type": "validation", "exception.message": "operation failed" },
      ]);
      span.end();
    });
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

  it("refuses listScope combined with projectScoped in runPipeline", async () => {
    const fixture = await createMigratedPglitePool();
    const ctx = minimalCtx(fixture.pool, "op-listscope-conflict");
    const res = await runOperation(
      ctx,
      {
        name: "test.bad_combo",
        permission: "project:list",
        listScope: true,
        projectScoped: true,
        projectIdFromInput: () => "reqalm",
        execute: async () => ok("leak"),
      },
      { projectId: "reqalm" } as never,
    );
    assert.equal(!res.ok && res.error.code, "internal");
    const r = await fixture.pool.query<{ outcome: string }>(
      `SELECT outcome FROM audit_events WHERE request_id = 'op-listscope-conflict'`,
    );
    assert.equal(r.rows[0]?.outcome, "error");
    await fixture.close();
  });

  it("listScope skips union authorize and filters via allowedProjectIds", async () => {
    const fixture = await createMigratedPglitePool();
    const ctx = minimalCtx(fixture.pool, "op-listscope-skip");
    ctx.projectGrants = [{ project_id: "reqalm", role: "Key custodian" }];
    ctx.effectiveRoles = ["Key custodian"];
    let captured: readonly string[] | undefined;
    const listOp: OperationDef<PageQuery, PageResult<{ id: string }>> = {
      name: "test.listscope",
      permission: "project:list",
      listScope: true,
      execute: async (c, input) => {
        captured = c.allowedProjectIds;
        return ok({ items: [], limit: input.limit, offset: input.offset, total: 0 });
      },
    };
    const res = await runOperation(ctx, listOp, { limit: 20, offset: 0 });
    assert.equal(res.ok, true);
    assert.deepEqual(captured, []);
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
