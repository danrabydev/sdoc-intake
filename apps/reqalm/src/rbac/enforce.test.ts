import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

  it("still allows platform-scoped permissions from platform_grants", async () => {
    const fixture = await createMigratedPglitePool();
    try {
      const { pool } = fixture;
      await pool.query(`INSERT INTO identities (id, display_name) VALUES ('rbac-kc', 'kc') ON CONFLICT DO NOTHING`);
      await pool.query(
        `INSERT INTO platform_grants (id, identity_id, role)
         VALUES ('pgrant-rbac-kc-only', 'rbac-kc', 'Key custodian') ON CONFLICT DO NOTHING`,
      );
      for (const permission of PERMISSIONS_WITHOUT_PROJECT) {
        assert.equal(await authorize(pool, "rbac-kc", permission), true, permission);
      }
      assert.equal(await authorize(pool, "rbac-kc", "requirement:read"), false);
    } finally {
      await fixture.close();
    }
  });
});
