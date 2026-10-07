import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type pg from "pg";
import { runOperation } from "./operation.js";
import type { RequestContext } from "./request-context.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";

function minimalCtx(pool: pg.Pool, requestId = "op-test"): RequestContext {
  return {
    requestId,
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
    const { pool } = await createMigratedPglitePool();
    const ctx = minimalCtx(pool);
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
    const r = await pool.query<{ outcome: string }>(
      `SELECT outcome FROM audit_events WHERE request_id = $1`,
      ["op-test"],
    );
    assert.equal(r.rows[0]?.outcome, "error");
    await pool.end();
  });
});
