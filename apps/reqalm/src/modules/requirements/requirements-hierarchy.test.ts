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

const TREE = "/api/v1/projects/reqalm/requirements/tree";
const inject = (opts: { method: string; url: string; headers?: Record<string, string>; payload?: string }) =>
  ctx.app.inject({
    ...opts,
    remoteAddress: "203.0.113.50",
    headers: { host: "localhost:3000", ...opts.headers },
  } as never);
const getJson = async (url: string, headers: Record<string, string> = bearer) =>
  inject({ method: "GET", url, headers }).then((r) => ({ status: r.statusCode, body: r.json() as { data: unknown; code?: string } }));
const gapLines = async (rows: [string, string, string | null, string, number][]) => {
  for (const [uid, project, parent, title, order] of rows) {
    await ctx.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, parent, kind, title, sibling_order) VALUES ($1,$2,$3,'requirement',$4,$5)`,
      [uid, project, parent, title, order],
    );
    await ctx.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title) VALUES ($1||'@'||$2,$1,$2,0,'active','s',$3)`,
      [uid, project, title],
    );
  }
};
const dropUids = async (uids: string[]) => {
  await ctx.pool.query(`DELETE FROM requirement_versions WHERE base_uid = ANY($1::text[])`, [uids]);
  await ctx.pool.query(`DELETE FROM requirement_lines WHERE base_uid = ANY($1::text[])`, [uids]);
};

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
      { uid: "SEC-DEVENV", title: "Developer environment & deployment topology", kind: "section" },
      { uid: FIX_PARENT, title: "Hier parent", kind: "section" },
      { uid: FIX_C1, title: "Child one", kind: "requirement" },
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
      url: `${TREE}?parent=${FIX_PARENT}`,
      headers: { ...bearer, "x-request-id": "req-tree-audit" },
    });
    assert.equal(res.statusCode, 200);
    const row = (
      await ctx.pool.query(`SELECT target_type, target_id FROM audit_events WHERE request_id = 'req-tree-audit'`)
    ).rows[0];
    assert.equal(row?.target_type, "requirement");
    assert.equal(row?.target_id, FIX_PARENT);
  });

  it("sibling_order wins over uid; ties break by uid asc", async () => {
    await gapLines([
      ["GAP-P", "reqalm", "SEC-CP", "p", 0],
      ["GAP-Z", "reqalm", "GAP-P", "z", 0],
      ["GAP-M", "reqalm", "GAP-P", "m", 1],
      ["GAP-A", "reqalm", "GAP-P", "a", 1],
    ]);
    try {
      const { body } = await getJson(`${TREE}?parent=GAP-P`);
      assert.deepEqual((body.data as { items: Array<{ uid: string }> }).items.map((i) => i.uid), [
        "GAP-Z",
        "GAP-A",
        "GAP-M",
      ]);
    } finally {
      await dropUids(["GAP-P", "GAP-Z", "GAP-M", "GAP-A"]);
    }
  });

  it("child_count and ancestors ignore same-uid rows in other projects", async () => {
    await ctx.pool.query(`INSERT INTO projects (id, client_id, name) VALUES ('gap-p2', 'reqalm-client', 'Gap P2')`);
    await gapLines([
      ["GAP-ROOT", "reqalm", "SEC-CP", "root", 0],
      ["GAP-KID", "reqalm", "GAP-ROOT", "kid", 0],
      ["GAP-X2", "gap-p2", null, "p2 root", 0],
      ["GAP-ROOT", "gap-p2", "GAP-X2", "imposter", 0],
      ["GAP-FOREIGN", "gap-p2", "GAP-KID", "f", 0],
    ]);
    try {
      const kids = (await getJson(`${TREE}?parent=GAP-ROOT`)).body.data as {
        items: Array<{ uid: string; child_count: number }>;
      };
      assert.deepEqual(kids.items.map((i) => [i.uid, i.child_count]), [["GAP-KID", 0]]);
      const d = (await getJson("/api/v1/projects/reqalm/requirements/GAP-KID")).body.data as {
        ancestors: Array<{ uid: string }>;
      };
      assert.deepEqual(d.ancestors.map((a) => a.uid), ["SEC-CP", "GAP-ROOT"]);
    } finally {
      await dropUids(["GAP-ROOT", "GAP-KID", "GAP-X2", "GAP-FOREIGN"]);
      await ctx.pool.query(`DELETE FROM projects WHERE id = 'gap-p2'`);
    }
  });

  it("tree node title/status come from the latest version", async () => {
    await gapLines([["GAP-V", "reqalm", "SEC-CP", "line title", 0]]);
    await ctx.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title) VALUES ('GAP-V.1','GAP-V','reqalm',1,'draft','s','v1 title')`,
    );
    try {
      const list = (await getJson(`${TREE}?parent=SEC-CP&limit=100`)).body.data as {
        items: Array<{ uid: string; title: string; status: string }>;
      };
      const node = list.items.find((i) => i.uid === "GAP-V");
      assert.deepEqual([node?.title, node?.status], ["v1 title", "draft"]);
    } finally {
      await dropUids(["GAP-V"]);
    }
  });

  it("tree paging caps and parent validation", async () => {
    for (const q of ["limit=101", "limit=0", "offset=100001", `parent=${"A".repeat(129)}`, "parent=a%20b"]) {
      assert.equal((await getJson(`${TREE}?${q}`)).status, 400, q);
    }
    assert.equal((await getJson(`${TREE}?parent=${"A".repeat(128)}`)).status, 404);
  });

  it("tree requires authentication", async () => {
    const r = await getJson(TREE, {});
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "unauthenticated");
  });

  it("ancestors terminate on a corrupt parent cycle (self and 2-node)", async () => {
    await gapLines([
      ["GAP-SELF", "reqalm", "GAP-SELF", "self", 0],
      ["GAP-C1", "reqalm", "GAP-C2", "c1", 0],
      ["GAP-C2", "reqalm", "GAP-C1", "c2", 0],
    ]);
    try {
      const self = await getJson("/api/v1/projects/reqalm/requirements/GAP-SELF");
      assert.equal(self.status, 200);
      assert.deepEqual((self.body.data as { ancestors: unknown[] }).ancestors, []);
      const c1 = await getJson("/api/v1/projects/reqalm/requirements/GAP-C1");
      assert.equal(c1.status, 200);
      assert.deepEqual((c1.body.data as { ancestors: Array<{ uid: string }> }).ancestors.map((a) => a.uid), ["GAP-C2"]);
    } finally {
      await dropUids(["GAP-SELF", "GAP-C1", "GAP-C2"]);
    }
  });

  it("caps ancestor depth at 32 on a deep chain", async () => {
    const uids = Array.from({ length: 41 }, (_, i) => `CAPD-${i}`);
    try {
      await gapLines([["CAPD-0", "reqalm", "SEC-CP", "c0", 0]]);
      for (let i = 1; i <= 40; i++) {
        await gapLines([[`CAPD-${i}`, "reqalm", `CAPD-${i - 1}`, `c${i}`, 0]]);
      }
      const res = await getJson("/api/v1/projects/reqalm/requirements/CAPD-40");
      assert.equal(res.status, 200);
      const anc = (res.body.data as { ancestors: Array<{ uid: string }> }).ancestors;
      assert.equal(anc.length, 32);
      assert.equal(anc[0]?.uid, "CAPD-8");
      assert.equal(anc[31]?.uid, "CAPD-39");
    } finally {
      await dropUids(uids);
    }
  });
});
