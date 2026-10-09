import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestApp, issueTestAccessToken, type TestApp } from "../../test/harness.js";

let ctx: TestApp;
let bearer: Record<string, string>;

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
});
after(async () => {
  await ctx.close();
});

const inject = (opts: { method: string; url: string; headers?: Record<string, string> }) =>
  ctx.app.inject({ ...opts, remoteAddress: "203.0.113.50", headers: { host: "localhost:3000", ...opts.headers } } as never);
const getJson = async (url: string, headers: Record<string, string> = bearer) => {
  const res = await inject({ method: "GET", url, headers });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};
const P = "/api/v1/projects/reqalm/releases";
const SUMMARY_KEYS = ["delivered_capability_count", "id", "name", "planned_on", "shipped_on", "status"];
const DETAIL_KEYS = [...SUMMARY_KEYS, "delivered_capabilities", "notes", "project_id"].sort();

describe("releases read API: verifier gap tests", () => {
  it("null planned_on sorts last, ties by id asc (R06)", async () => {
    await ctx.pool.query(
      `INSERT INTO releases (id, project_id, name, status, position) VALUES
       ('zz-null-rel', 'reqalm', 'null z', 'planned', 0), ('aa-null-rel', 'reqalm', 'null a', 'planned', 0)`,
    );
    try {
      const { body } = await getJson(`${P}?limit=100`);
      const data = body.data as { items: Array<{ id: string }> };
      const ids = data.items.map((i) => i.id);
      assert.deepEqual(ids.slice(-2), ["aa-null-rel", "zz-null-rel"]);
    } finally {
      await ctx.pool.query(`DELETE FROM releases WHERE id IN ('zz-null-rel', 'aa-null-rel')`);
    }
  });

  it("offset pages through the same order and total is the full count (R09, R10)", async () => {
    const all = ((await getJson(`${P}?limit=100`)).body.data as { items: Array<{ id: string }> }).items.map(
      (i) => i.id,
    );
    const page = (await getJson(`${P}?limit=5&offset=5`)).body.data as { items: Array<{ id: string }>; total: number };
    assert.deepEqual(page.items.map((i) => i.id), all.slice(5, 10));
    assert.equal(((await getJson(`${P}?limit=1`)).body.data as { total: number }).total, all.length);
    assert.equal(((await getJson(`${P}?status=shipped&limit=1`)).body.data as { total: number }).total, 26);
  });

  it("unknown release id is 404 not_found (R22)", async () => {
    const { status, body } = await getJson(`${P}/no-such-release`);
    assert.equal(status, 404);
    assert.equal(body.code, "not_found");
    assert.equal(body.detail, "Release not found");
  });

  it("reader can list releases of a second granted project (R21)", async () => {
    await ctx.pool.query(`INSERT INTO clients (id, name) VALUES ('gap-client', 'Gap') ON CONFLICT DO NOTHING`);
    await ctx.pool.query(`INSERT INTO projects (id, client_id, name) VALUES ('gap-proj', 'gap-client', 'Gap') ON CONFLICT DO NOTHING`);
    await ctx.pool.query(
      `INSERT INTO releases (id, project_id, name, status, position) VALUES ('gap-rel', 'gap-proj', 'Gap rel', 'planned', 0)`,
    );
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-casey-gap', 'gap-proj', 'casey-reader', 'Reader')`,
    );
    try {
      const { status, body } = await getJson("/api/v1/projects/gap-proj/releases");
      assert.equal(status, 200);
      assert.deepEqual(
        (body.data as { items: Array<{ id: string }> }).items.map((i) => i.id),
        ["gap-rel"],
      );
    } finally {
      await ctx.pool.query(`DELETE FROM project_grants WHERE id = 'grant-casey-gap'`);
      await ctx.pool.query(`DELETE FROM releases WHERE id = 'gap-rel'`);
      await ctx.pool.query(`DELETE FROM projects WHERE id = 'gap-proj'`);
      await ctx.pool.query(`DELETE FROM clients WHERE id = 'gap-client'`);
    }
  });

  it("counts and lists capability delivers only, in delivery order (R23, R24, R25)", async () => {
    const items = ((await getJson(`${P}?limit=100`)).body.data as { items: Array<{ id: string; delivered_capability_count: number }> })
      .items;
    const count = (id: string) => items.find((i) => i.id === id)?.delivered_capability_count;
    assert.equal(count("rel-r0-sequences"), 3);
    assert.equal(count("rel-r1-platform-followups"), 0);
    const detail = (await getJson(`${P}/rel-r0-sequences`)).body.data as {
      delivered_capability_count: number;
      delivered_capabilities: Array<{ uid: string }>;
    };
    assert.equal(detail.delivered_capability_count, 3);
    assert.deepEqual(detail.delivered_capabilities.map((c) => c.uid), ["CAP-SSO", "CAP-SCOPED-VIEW", "CAP-RBAC"]);
  });

  it("delivered capabilities follow release_delivers.position, not uid sort", async () => {
    await ctx.pool.query(
      `INSERT INTO releases (id, project_id, name, status, position)
       VALUES ('order-bed-rel', 'reqalm', 'Order bed', 'planned', 9999) ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(`DELETE FROM release_delivers WHERE release_id = 'order-bed-rel'`);
    await ctx.pool.query(
      `INSERT INTO release_delivers (release_id, version_uid, position) VALUES
       ('order-bed-rel', 'CAP-RBAC', 0),
       ('order-bed-rel', 'CAP-SSO', 1),
       ('order-bed-rel', 'CAP-SCOPED-VIEW', 2)`,
    );
    try {
      const detail = (await getJson(`${P}/order-bed-rel`)).body.data as {
        delivered_capabilities: Array<{ uid: string }>;
      };
      assert.deepEqual(detail.delivered_capabilities.map((c) => c.uid), ["CAP-RBAC", "CAP-SSO", "CAP-SCOPED-VIEW"]);
    } finally {
      await ctx.pool.query(`DELETE FROM release_delivers WHERE release_id = 'order-bed-rel'`);
      await ctx.pool.query(`DELETE FROM releases WHERE id = 'order-bed-rel'`);
    }
  });

  it("delivered capabilities ignore version UIDs from other projects", async () => {
    await ctx.pool.query(
      `INSERT INTO projects (id, client_id, name) VALUES ('cap-leak-proj', 'reqalm-client', 'Leak') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, kind, title)
       VALUES ('foreign-cap', 'cap-leak-proj', 'capability', 'Foreign cap') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title)
       VALUES ('foreign-cap', 'foreign-cap', 'cap-leak-proj', 0, 'active', 'x', 'Foreign cap') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO releases (id, project_id, name, status, position)
       VALUES ('cap-leak-rel', 'reqalm', 'leak bed', 'planned', 0) ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO release_delivers (release_id, version_uid, position) VALUES ('cap-leak-rel', 'foreign-cap', 0)
       ON CONFLICT DO NOTHING`,
    );
    try {
      const detail = (await getJson(`${P}/cap-leak-rel`)).body.data as {
        delivered_capability_count: number;
        delivered_capabilities: unknown[];
      };
      assert.equal(detail.delivered_capability_count, 0);
      assert.deepEqual(detail.delivered_capabilities, []);
      const listItem = (
        ((await getJson(`${P}?limit=100`)).body.data as { items: Array<{ id: string; delivered_capability_count: number }> })
          .items.find((i) => i.id === "cap-leak-rel")
      );
      assert.equal(listItem?.delivered_capability_count, 0);
    } finally {
      await ctx.pool.query(`DELETE FROM release_delivers WHERE release_id = 'cap-leak-rel'`);
      await ctx.pool.query(`DELETE FROM releases WHERE id = 'cap-leak-rel'`);
      await ctx.pool.query(`DELETE FROM requirement_versions WHERE uid = 'foreign-cap'`);
      await ctx.pool.query(`DELETE FROM requirement_lines WHERE base_uid = 'foreign-cap'`);
      await ctx.pool.query(`DELETE FROM projects WHERE id = 'cap-leak-proj'`);
    }
  });

  it("DTOs have exact key sets; cyber_gate / gate_signoffs never appear (R27, R28, R29)", async () => {
    const list = ((await getJson(`${P}?limit=100`)).body.data as { items: Array<Record<string, unknown>> }).items;
    for (const i of list) assert.deepEqual(Object.keys(i).sort(), SUMMARY_KEYS, String(i.id));
    const d = (await getJson(`${P}/rel-r1-core-alm`)).body.data as Record<string, unknown>;
    assert.deepEqual(Object.keys(d).sort(), DETAIL_KEYS);
    for (const c of d.delivered_capabilities as Array<Record<string, unknown>>) {
      assert.deepEqual(Object.keys(c).sort(), ["status", "title", "uid"]);
    }
  });

  it("release id must be a lowercase slug of at most 64 chars (R31, R32)", async () => {
    for (const id of ["Rel-Upper", "rel.dot", "a".repeat(65)]) {
      assert.equal((await getJson(`${P}/${id}`)).status, 400, id);
    }
    assert.equal((await getJson(`${P}/${"a".repeat(64)}`)).status, 404);
  });

  it("audits release reads with target type and id (R33, R34)", async () => {
    await inject({ method: "GET", url: `${P}/rel-r0-sequences`, headers: { ...bearer, "x-request-id": "gap-aud-get" } });
    await inject({ method: "GET", url: `${P}?limit=1`, headers: { ...bearer, "x-request-id": "gap-aud-list" } });
    const rows = (
      await ctx.pool.query<{ request_id: string; operation: string; outcome: string; target_type: string; target_id: string | null }>(
        `SELECT request_id, operation, outcome, target_type, target_id FROM audit_events
         WHERE request_id IN ('gap-aud-get', 'gap-aud-list') ORDER BY request_id`,
      )
    ).rows;
    assert.deepEqual(rows, [
      { request_id: "gap-aud-get", operation: "releases.get", outcome: "allow", target_type: "release", target_id: "rel-r0-sequences" },
      { request_id: "gap-aud-list", operation: "releases.list", outcome: "allow", target_type: "release", target_id: null },
    ]);
  });
});
