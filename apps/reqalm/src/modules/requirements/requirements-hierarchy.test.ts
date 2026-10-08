import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createTestApp,
  issueTestAccessToken,
  TEST_AGENT_SECRET,
  TEST_API_RESOURCE,
  type TestApp,
} from "../../test/harness.js";

let ctx: TestApp;
let bearer: Record<string, string>;
let readerToken: string;

const FIX_PARENT = "FIX-HIER-P";
const FIX_C1 = "FIX-HIER-C1";
const FIX_C2 = "FIX-HIER-C2";
const FIX_C3 = "FIX-HIER-C3";
const FIX_LEAF = "FIX-HIER-LEAF";

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  readerToken = await issueTestAccessToken(ctx.app);
  bearer = { authorization: `Bearer ${readerToken}` };
  await ctx.pool.query(
    `INSERT INTO projects (id, client_id, name) VALUES ('hier-p2', 'reqalm-client', 'Hier P2') ON CONFLICT DO NOTHING`,
  );
  await ctx.pool.query(
    `INSERT INTO project_grants (id, project_id, identity_id, role)
     VALUES ('grant-casey-hier-read', 'hier-p2', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`,
  );
  await ctx.pool.query(
    `INSERT INTO requirement_lines (base_uid, project_id, parent, kind, title, sibling_order)
     VALUES
       ($1, 'reqalm', 'SEC-DEVENV', 'section', 'Hier parent', 99),
       ($2, 'reqalm', $1, 'requirement', 'Child one', 0),
       ($3, 'reqalm', $1, 'requirement', 'Child two', 1),
       ($4, 'reqalm', $1, 'capability', 'Child three', 2),
       ($5, 'reqalm', $2, 'requirement', 'Leaf', 0)
     ON CONFLICT (project_id, base_uid) DO UPDATE SET
       parent = EXCLUDED.parent, sibling_order = EXCLUDED.sibling_order, title = EXCLUDED.title`,
    [FIX_PARENT, FIX_C1, FIX_C2, FIX_C3, FIX_LEAF],
  );
  await ctx.pool.query(
    `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title, mint_kind)
     VALUES
       ($1, $1, 'reqalm', 0, 'active', 'p', 'Hier parent', NULL),
       ($2, $2, 'reqalm', 0, 'draft', 'c1', 'Child one', NULL),
       ($3, $3, 'reqalm', 0, 'active', 'c2', 'Child two', 'content'),
       ($4, $4, 'reqalm', 0, 'active', 'c3', 'Cap three', NULL),
       ($5, $5, 'reqalm', 0, 'active', 'leaf', 'Leaf', NULL)
     ON CONFLICT (uid) DO NOTHING`,
    [FIX_PARENT, FIX_C1, FIX_C2, FIX_C3, FIX_LEAF],
  );
  await ctx.pool.query(
    `INSERT INTO requirement_lines (base_uid, project_id, parent, kind, title, sibling_order)
     VALUES ('HIER-P2-ONLY', 'hier-p2', NULL, 'requirement', 'P2 root', 0)
     ON CONFLICT DO NOTHING`,
  );
  await ctx.pool.query(
    `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement)
     VALUES ('HIER-P2-ONLY', 'HIER-P2-ONLY', 'hier-p2', 0, 'active', 'p2')
     ON CONFLICT DO NOTHING`,
  );
});

after(async () => {
  await ctx.pool.query(
    `DELETE FROM requirement_versions WHERE base_uid = ANY($1::text[])`,
    [[FIX_PARENT, FIX_C1, FIX_C2, FIX_C3, FIX_LEAF, "HIER-P2-ONLY"]],
  );
  await ctx.pool.query(
    `DELETE FROM requirement_lines WHERE base_uid = ANY($1::text[])`,
    [[FIX_PARENT, FIX_C1, FIX_C2, FIX_C3, FIX_LEAF, "HIER-P2-ONLY"]],
  );
  await ctx.pool.query(`DELETE FROM project_grants WHERE id = 'grant-casey-hier-read'`);
  await ctx.pool.query(`DELETE FROM projects WHERE id = 'hier-p2'`);
  await ctx.close();
});

const inject = (opts: { method: string; url: string; headers?: Record<string, string>; payload?: string }) =>
  ctx.app.inject({
    ...opts,
    remoteAddress: "203.0.113.50",
    headers: { host: "localhost:3000", ...opts.headers },
  } as never);

async function agentToken(role?: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: "reqalm-agent-dev",
    client_secret: TEST_AGENT_SECRET,
    agent_name: "cursor-cloud",
    resource: TEST_API_RESOURCE,
  });
  if (role) params.set("role", role);
  const res = await inject({
    method: "POST",
    url: "/oauth/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: params.toString(),
  });
  assert.equal(res.statusCode, 200);
  return (res.json() as { access_token: string }).access_token;
}

const TREE_NODE_KEYS = ["uid", "title", "kind", "type", "status", "child_count"] as const;

describe("requirements tree read API", () => {
  it("returns section and requirement nodes; roots have null parent in DB", async () => {
    const roots = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements/tree?limit=100", headers: bearer })
    ).json() as { data: { items: Array<{ uid: string; kind: string }>; total: number } };
    assert.equal(roots.data.total, 20);
    assert.ok(roots.data.items.every((i) => i.kind === "section"));
    assert.ok(roots.data.items.some((i) => i.uid === "SEC-CP"));
    const secCpKids = (
      await inject({
        method: "GET",
        url: "/api/v1/projects/reqalm/requirements/tree?parent=SEC-CP&limit=20",
        headers: bearer,
      })
    ).json() as { data: { items: Array<{ uid: string; kind: string }> } };
    assert.ok(secCpKids.data.items.some((i) => i.uid === "B01" && i.kind === "requirement"));
    assert.ok(secCpKids.data.items.some((i) => i.kind === "capability"));
    const reqParent = (
      await inject({
        method: "GET",
        url: "/api/v1/projects/reqalm/requirements/tree?parent=ARCH-CP-HIER&limit=10",
        headers: bearer,
      })
    ).json() as { data: { items: Array<{ kind: string }> } };
    assert.ok(reqParent.data.items.length > 0);
    assert.ok(reqParent.data.items.every((i) => i.kind === "requirement"));
  });

  it("returns roots and children in sibling_order with exact DTO keys and child_count", async () => {
    const roots = (
      await inject({
        method: "GET",
        url: `/api/v1/projects/reqalm/requirements/tree?limit=5`,
        headers: bearer,
      })
    ).json() as { data: { items: Record<string, unknown>[]; total: number } };
    assert.ok(roots.data.total >= 1);
    for (const item of roots.data.items) {
      assert.deepEqual(Object.keys(item).sort(), [...TREE_NODE_KEYS].sort());
    }

    const children = (
      await inject({
        method: "GET",
        url: `/api/v1/projects/reqalm/requirements/tree?parent=${FIX_PARENT}&limit=10`,
        headers: bearer,
      })
    ).json() as { data: { items: Array<{ uid: string; child_count: number; status: string; type: string }>; total: number } };
    assert.equal(children.data.total, 3);
    assert.deepEqual(
      children.data.items.map((i) => i.uid),
      [FIX_C1, FIX_C2, FIX_C3],
    );
    assert.equal(children.data.items[0]?.child_count, 1);
    assert.equal(children.data.items[0]?.status, "draft");
    assert.equal(children.data.items[1]?.type, "content");
    assert.equal(children.data.items[2]?.child_count, 0);
    for (const item of children.data.items) {
      assert.deepEqual(Object.keys(item).sort(), [...TREE_NODE_KEYS].sort());
    }
  });

  it("pages children with offset and total", async () => {
    const page = (
      await inject({
        method: "GET",
        url: `/api/v1/projects/reqalm/requirements/tree?parent=${FIX_PARENT}&limit=1&offset=1`,
        headers: bearer,
      })
    ).json() as { data: { items: Array<{ uid: string }>; total: number; offset: number } };
    assert.equal(page.data.total, 3);
    assert.equal(page.data.offset, 1);
    assert.deepEqual(page.data.items.map((i) => i.uid), [FIX_C2]);
  });

  it("404 for unknown parent, cross-project parent, and cross-project roots leak", async () => {
    const nf = async (url: string) => (await inject({ method: "GET", url, headers: bearer })).statusCode;
    assert.equal(await nf(`/api/v1/projects/reqalm/requirements/tree?parent=NO-SUCH`), 404);
    assert.equal(await nf(`/api/v1/projects/reqalm/requirements/tree?parent=HIER-P2-ONLY`), 404);
    const p2Roots = (
      await inject({ method: "GET", url: "/api/v1/projects/hier-p2/requirements/tree?limit=50", headers: bearer })
    ).json() as { data: { items: Array<{ uid: string }>; total: number } };
    assert.equal(p2Roots.data.total, 1);
    assert.deepEqual(p2Roots.data.items.map((i) => i.uid), ["HIER-P2-ONLY"]);
    const reqalmRoots = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements/tree?limit=100", headers: bearer })
    ).json() as { data: { items: Array<{ uid: string }> } };
    assert.ok(!reqalmRoots.data.items.some((i) => i.uid === "HIER-P2-ONLY"));
  });

  it("400 for invalid parent query and detail adds parent_uid and ancestors", async () => {
    assert.equal(
      (await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements/tree?parent=!!bad!!", headers: bearer }))
        .statusCode,
      400,
    );
    const detail = (
      await inject({ method: "GET", url: `/api/v1/projects/reqalm/requirements/${FIX_LEAF}`, headers: bearer })
    ).json() as { data: Record<string, unknown> };
    assert.equal(detail.data.parent_uid, FIX_C1);
    assert.deepEqual(detail.data.ancestors, [
      { uid: "SEC-DEVENV", title: "Developer environment & deployment topology" },
      { uid: FIX_PARENT, title: "Hier parent" },
      { uid: FIX_C1, title: "Child one" },
    ]);
    const detailKeys = Object.keys(detail.data).sort();
    assert.deepEqual(detailKeys, [
      "ancestors",
      "attributes",
      "id",
      "kind",
      "parent_uid",
      "project_id",
      "statement",
      "status",
      "title",
      "type",
      "version_id",
      "version_n",
    ]);
  });

  it("Key custodian denied and agent Reader narrowing on tree", async () => {
    const saved = (
      await ctx.pool.query<{ id: string; role: string }>(
        `SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm' AND revoked_at IS NULL`,
      )
    ).rows;
    await ctx.pool.query(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-hier', 'reqalm', 'casey-reader', 'Key custodian')`,
    );
    try {
      assert.equal(
        (await inject({ method: "GET", url: `/api/v1/projects/reqalm/requirements/tree?parent=${FIX_PARENT}`, headers: bearer }))
          .statusCode,
        403,
      );
    } finally {
      await ctx.pool.query(`DELETE FROM project_grants WHERE id = 'grant-kc-hier'`);
      for (const g of saved) {
        await ctx.pool.query(
          `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, 'reqalm', 'casey-reader', $2) ON CONFLICT DO NOTHING`,
          [g.id, g.role],
        );
      }
    }

    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role)
       VALUES ('grant-agent-padmin-hier', 'hier-p2', 'agent-cursor-cloud', 'Project admin') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role)
       VALUES ('grant-casey-hier-p2', 'hier-p2', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`,
    );
    try {
      const narrowed = { authorization: `Bearer ${await agentToken("Reader")}` };
      assert.equal(
        (await inject({ method: "GET", url: "/api/v1/projects/hier-p2/requirements/tree", headers: narrowed })).statusCode,
        403,
      );
    } finally {
      await ctx.pool.query(`DELETE FROM project_grants WHERE id IN ('grant-agent-padmin-hier', 'grant-casey-hier-p2')`);
    }
  });

  it("writes audit target_type requirement for tree read", async () => {
    const res = await inject({
      method: "GET",
      url: `/api/v1/projects/reqalm/requirements/tree?parent=${FIX_PARENT}`,
      headers: { ...bearer, "x-request-id": "req-tree-audit" },
    });
    assert.equal(res.statusCode, 200);
    const row = (
      await ctx.pool.query(`SELECT target_type, target_id FROM audit_events WHERE request_id = 'req-tree-audit'`)
    ).rows[0];
    assert.equal(row?.target_type, "requirement");
    assert.equal(row?.target_id, FIX_PARENT);
  });
});
