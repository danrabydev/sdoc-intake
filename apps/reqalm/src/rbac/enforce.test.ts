import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestApp, issueTestAccessToken, type TestApp } from "../test/harness.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";
import { authorize, listActiveRoles, PERMISSIONS_WITHOUT_PROJECT } from "./enforce.js";

describe("listActiveRoles", () => {
  it("without projectId includes only platform grants, not every project grant", async () => {
    const fixture = await createMigratedPglitePool();
    try {
      const { pool } = fixture;
      await pool.query(`INSERT INTO identities (id, display_name) VALUES ('rbac-p2-only', 'p2') ON CONFLICT DO NOTHING`);
      await pool.query(
        `INSERT INTO clients (id, name) VALUES ('rbac-client', 'C') ON CONFLICT DO NOTHING`,
      );
      await pool.query(
        `INSERT INTO projects (id, client_id, name) VALUES ('rbac-p2', 'rbac-client', 'P2') ON CONFLICT DO NOTHING`,
      );
      await pool.query(
        `INSERT INTO project_grants (id, project_id, identity_id, role)
         VALUES ('grant-rbac-p2-reader', 'rbac-p2', 'rbac-p2-only', 'Reader') ON CONFLICT DO NOTHING`,
      );
      await pool.query(
        `INSERT INTO platform_grants (id, identity_id, role)
         VALUES ('pgrant-rbac-kc', 'rbac-p2-only', 'Key custodian') ON CONFLICT DO NOTHING`,
      );
      const roles = await listActiveRoles(pool, "rbac-p2-only");
      assert.deepEqual(roles.sort(), ["Key custodian"]);
      const scoped = await listActiveRoles(pool, "rbac-p2-only", "rbac-p2");
      assert.deepEqual(scoped.sort(), ["Key custodian", "Reader"]);
    } finally {
      await fixture.close();
    }
  });
});

describe("authorize without projectId", () => {
  it("pins the exact no-project permission allowlist", () => {
    assert.deepEqual([...PERMISSIONS_WITHOUT_PROJECT].sort(), ["audit:read", "key:manage"]);
  });

  it("denies project-bound permissions for a Reader granted only on p2", async () => {
    const fixture = await createMigratedPglitePool();
    try {
      const { pool } = fixture;
      await pool.query(`INSERT INTO identities (id, display_name) VALUES ('rbac-p2-only', 'p2') ON CONFLICT DO NOTHING`);
      await pool.query(`INSERT INTO clients (id, name) VALUES ('rbac-client', 'C') ON CONFLICT DO NOTHING`);
      await pool.query(
        `INSERT INTO projects (id, client_id, name) VALUES ('rbac-p2', 'rbac-client', 'P2') ON CONFLICT DO NOTHING`,
      );
      await pool.query(
        `INSERT INTO project_grants (id, project_id, identity_id, role)
         VALUES ('grant-rbac-p2-reader', 'rbac-p2', 'rbac-p2-only', 'Reader') ON CONFLICT DO NOTHING`,
      );
      for (const permission of ["requirement:read", "contract:read"] as const) {
        assert.equal(await authorize(pool, "rbac-p2-only", permission), false, permission);
      }
      assert.equal(await authorize(pool, "rbac-p2-only", "requirement:read", "rbac-p2"), true);
    } finally {
      await fixture.close();
    }
  });

  it("denies requirement:read without projectId when Reader is granted via platform_grants only", async () => {
    const fixture = await createMigratedPglitePool();
    try {
      const { pool } = fixture;
      await pool.query(`INSERT INTO identities (id, display_name) VALUES ('rbac-plat-reader', 'pr') ON CONFLICT DO NOTHING`);
      await pool.query(`INSERT INTO clients (id, name) VALUES ('rbac-client', 'C') ON CONFLICT DO NOTHING`);
      await pool.query(
        `INSERT INTO projects (id, client_id, name) VALUES ('rbac-p1', 'rbac-client', 'P1') ON CONFLICT DO NOTHING`,
      );
      await pool.query(
        `INSERT INTO platform_grants (id, identity_id, role)
         VALUES ('pgrant-rbac-plat-reader', 'rbac-plat-reader', 'Reader') ON CONFLICT DO NOTHING`,
      );
      assert.equal(await authorize(pool, "rbac-plat-reader", "requirement:read"), false);
      await pool.query(
        `INSERT INTO project_grants (id, project_id, identity_id, role)
         VALUES ('grant-rbac-p1-reader', 'rbac-p1', 'rbac-plat-reader', 'Reader') ON CONFLICT DO NOTHING`,
      );
      assert.equal(await authorize(pool, "rbac-plat-reader", "requirement:read", "rbac-p1"), true);
    } finally {
      await fixture.close();
    }
  });

  it("allows Key custodian key:manage and audit:read from platform_grants without projectId", async () => {
    const fixture = await createMigratedPglitePool();
    try {
      const { pool } = fixture;
      await pool.query(`INSERT INTO identities (id, display_name) VALUES ('rbac-kc', 'kc') ON CONFLICT DO NOTHING`);
      await pool.query(
        `INSERT INTO platform_grants (id, identity_id, role)
         VALUES ('pgrant-rbac-kc-only', 'rbac-kc', 'Key custodian') ON CONFLICT DO NOTHING`,
      );
      assert.equal(await authorize(pool, "rbac-kc", "key:manage"), true);
      assert.equal(await authorize(pool, "rbac-kc", "audit:read"), true);
      assert.equal(await authorize(pool, "rbac-kc", "requirement:read"), false);
    } finally {
      await fixture.close();
    }
  });
});

describe("authorize without projectId (HTTP)", () => {
  let ctx: TestApp;
  let bearer: Record<string, string>;

  before(async () => {
    ctx = await createTestApp({ dogfood: true });
    bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
  });

  after(async () => {
    await ctx.close();
  });

  it("returns 404 when Reader is granted only on p2 but requests a p1 requirements list", async () => {
    const saved = (
      await ctx.pool.query<{ id: string; project_id: string; role: string }>(
        `SELECT id, project_id, role FROM project_grants WHERE identity_id = 'casey-reader' AND revoked_at IS NULL`,
      )
    ).rows;
    await ctx.pool.query(`DELETE FROM project_grants WHERE identity_id = 'casey-reader'`);
    await ctx.pool.query(
      `INSERT INTO clients (id, name) VALUES ('rbac-http-client', 'C') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO projects (id, client_id, name) VALUES ('rbac-http-p1', 'rbac-http-client', 'P1'), ('rbac-http-p2', 'rbac-http-client', 'P2') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role)
       VALUES ('grant-casey-rbac-http-p2', 'rbac-http-p2', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`,
    );
    try {
      const denied = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/projects/rbac-http-p1/requirements?limit=1",
        remoteAddress: "203.0.113.50",
        headers: { host: "localhost:3000", ...bearer },
      } as never);
      assert.equal(denied.statusCode, 404);
      const allowed = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/projects/rbac-http-p2/requirements?limit=1",
        remoteAddress: "203.0.113.50",
        headers: { host: "localhost:3000", ...bearer },
      } as never);
      assert.equal(allowed.statusCode, 200);
    } finally {
      await ctx.pool.query(`DELETE FROM project_grants WHERE id = 'grant-casey-rbac-http-p2'`);
      await ctx.pool.query(`DELETE FROM projects WHERE id IN ('rbac-http-p1', 'rbac-http-p2')`);
      await ctx.pool.query(`DELETE FROM clients WHERE id = 'rbac-http-client'`);
      for (const g of saved) {
        await ctx.pool.query(
          `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, $2, 'casey-reader', $3) ON CONFLICT DO NOTHING`,
          [g.id, g.project_id, g.role],
        );
      }
    }
  });
});
