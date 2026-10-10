import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import type { ResolvedAuth } from "../../auth/request-auth.js";
import type { RequestContext } from "../../core/request-context.js";
import { loadConfig } from "../../config.js";
import { createMemoryKeyProvider } from "../../key/memory-provider.js";
import { createTestApp, testConfigEnv, type TestApp } from "../../test/harness.js";
import { listClientGrants, listPlatformGrants, listRoleCatalog } from "./access.service.js";

let ctx: TestApp;

async function serviceContext(identityId: string): Promise<RequestContext> {
  const grants = await ctx.pool.query<{ project_id: string; role: string }>(
    `SELECT project_id, role FROM project_grants WHERE identity_id = $1 AND revoked_at IS NULL`,
    [identityId],
  );
  const config = loadConfig(testConfigEnv());
  const auth = { accessToken: { sub: identityId } } as ResolvedAuth;
  return {
    requestId: "access-svc-test",
    traceId: null,
    ip: "203.0.113.50",
    userAgent: null,
    pool: ctx.pool,
    config,
    keyProvider: createMemoryKeyProvider(),
    logger: {
      info() {},
      error() {},
      warn() {},
      debug() {},
      trace() {},
      fatal() {},
      child() {
        return this;
      },
      silent: true,
      level: "silent",
    } as unknown as FastifyBaseLogger,
    clock: { now: () => Date.now() },
    auth,
    identityId,
    projectGrants: grants.rows,
    projectIds: new Set(grants.rows.map((g) => g.project_id)),
    effectiveRoles: grants.rows.map((g) => g.role),
    agentName: null,
    tokenRole: null,
    actingFor: null,
  };
}

before(async () => {
  ctx = await createTestApp({ dogfood: true });
});

after(async () => {
  await ctx.close();
});

describe("access.service gates", () => {
  it("listRoleCatalog denies without access:read (service-level gate)", async () => {
    const result = await listRoleCatalog(await serviceContext("casey-reader"), { limit: 20, offset: 0 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "not_found");
  });

  it("listRoleCatalog denies when caller has no project, client, or platform grant", async () => {
    const savedProject = (
      await ctx.pool.query(`SELECT id, project_id, role FROM project_grants WHERE identity_id = 'jordan-auditor'`)
    ).rows;
    const savedClient = (
      await ctx.pool.query(`SELECT id, client_id, identity_id, role FROM client_grants WHERE identity_id = 'jordan-auditor'`)
    ).rows;
    const savedPlatform = (
      await ctx.pool.query(`SELECT id, identity_id, role FROM platform_grants WHERE identity_id = 'jordan-auditor'`)
    ).rows;
    await ctx.pool.query(`DELETE FROM project_grants WHERE identity_id = 'jordan-auditor'`);
    await ctx.pool.query(`DELETE FROM client_grants WHERE identity_id = 'jordan-auditor'`);
    await ctx.pool.query(`DELETE FROM platform_grants WHERE identity_id = 'jordan-auditor'`);
    try {
      const result = await listRoleCatalog(await serviceContext("jordan-auditor"), { limit: 20, offset: 0 });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "not_found");
    } finally {
      for (const g of savedProject) {
        await ctx.pool.query(
          `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, $2, 'jordan-auditor', $3) ON CONFLICT DO NOTHING`,
          [g.id, g.project_id, g.role],
        );
      }
      for (const g of savedClient) {
        await ctx.pool.query(
          `INSERT INTO client_grants (id, client_id, identity_id, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [g.id, g.client_id, g.identity_id, g.role],
        );
      }
      for (const g of savedPlatform) {
        await ctx.pool.query(
          `INSERT INTO platform_grants (id, identity_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [g.id, g.identity_id, g.role],
        );
      }
    }
  });

  it("listClientGrants denies without access:read before client scope checks", async () => {
    const result = await listClientGrants(await serviceContext("casey-reader"), {
      clientId: "raby-family",
      limit: 10,
      offset: 0,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "not_found");
  });

  it("listPlatformGrants denies without access:read", async () => {
    await ctx.pool.query(
      `INSERT INTO platform_grants (id, identity_id, role) VALUES ('pgrant-casey-gate-test', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`,
    );
    try {
      const result = await listPlatformGrants(await serviceContext("casey-reader"), { limit: 10, offset: 0 });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "not_found");
    } finally {
      await ctx.pool.query(`DELETE FROM platform_grants WHERE id = 'pgrant-casey-gate-test'`);
    }
  });
});
