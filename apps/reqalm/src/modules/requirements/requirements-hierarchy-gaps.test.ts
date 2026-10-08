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

const get = async (url: string, headers: Record<string, string> = bearer) => {
  const res = await ctx.app.inject({
    method: "GET",
    url,
    remoteAddress: "203.0.113.50",
    headers: { host: "localhost:3000", ...headers },
  } as never);
  return { status: res.statusCode, body: res.json() as { data: unknown; code?: string } };
};

const TREE = "/api/v1/projects/reqalm/requirements/tree";

const lines = async (rows: [string, string, string | null, string, number][]) => {
  for (const [uid, project, parent, title, order] of rows) {
    await ctx.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, parent, kind, title, sibling_order) VALUES ($1, $2, $3, 'requirement', $4, $5)`,
      [uid, project, parent, title, order],
    );
    await ctx.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title) VALUES ($1 || '@' || $2, $1, $2, 0, 'active', 's', $3)`,
      [uid, project, title],
    );
  }
};

const drop = async (uids: string[]) => {
  await ctx.pool.query(`DELETE FROM requirement_versions WHERE base_uid = ANY($1::text[])`, [uids]);
  await ctx.pool.query(`DELETE FROM requirement_lines WHERE base_uid = ANY($1::text[])`, [uids]);
};

describe("requirements tree: gap tests", () => {
  it("sibling_order wins over uid; ties break by uid asc", async () => {
    await lines([
      ["GAP-P", "reqalm", "SEC-CP", "p", 0],
      ["GAP-Z", "reqalm", "GAP-P", "z", 0],
      ["GAP-M", "reqalm", "GAP-P", "m", 1],
      ["GAP-A", "reqalm", "GAP-P", "a", 1],
    ]);
    try {
      const { body } = await get(`${TREE}?parent=GAP-P`);
      const data = body.data as { items: Array<{ uid: string }> };
      assert.deepEqual(
        data.items.map((i) => i.uid),
        ["GAP-Z", "GAP-A", "GAP-M"],
      );
    } finally {
      await drop(["GAP-P", "GAP-Z", "GAP-M", "GAP-A"]);
    }
  });

  it("child_count and ancestors ignore same-uid rows in other projects", async () => {
    await ctx.pool.query(`INSERT INTO projects (id, client_id, name) VALUES ('gap-p2', 'reqalm-client', 'Gap P2')`);
    await lines([
      ["GAP-ROOT", "reqalm", "SEC-CP", "root", 0],
      ["GAP-KID", "reqalm", "GAP-ROOT", "kid", 0],
      ["GAP-X2", "gap-p2", null, "p2 root", 0],
      ["GAP-ROOT", "gap-p2", "GAP-X2", "imposter", 0],
      ["GAP-FOREIGN", "gap-p2", "GAP-KID", "f", 0],
    ]);
    try {
      const kids = (await get(`${TREE}?parent=GAP-ROOT`)).body.data as {
        items: Array<{ uid: string; child_count: number }>;
      };
      assert.deepEqual(
        kids.items.map((i) => [i.uid, i.child_count]),
        [["GAP-KID", 0]],
      );
      const d = (await get("/api/v1/projects/reqalm/requirements/GAP-KID")).body.data as {
        ancestors: Array<{ uid: string }>;
      };
      assert.deepEqual(
        d.ancestors.map((a) => a.uid),
        ["SEC-CP", "GAP-ROOT"],
      );
    } finally {
      await drop(["GAP-ROOT", "GAP-KID", "GAP-X2", "GAP-FOREIGN"]);
      await ctx.pool.query(`DELETE FROM projects WHERE id = 'gap-p2'`);
    }
  });

  it("tree node title/status come from the latest version", async () => {
    await lines([["GAP-V", "reqalm", "SEC-CP", "line title", 0]]);
    await ctx.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title) VALUES ('GAP-V.1', 'GAP-V', 'reqalm', 1, 'draft', 's', 'v1 title')`,
    );
    try {
      const list = (await get(`${TREE}?parent=SEC-CP&limit=100`)).body.data as {
        items: Array<{ uid: string; title: string; status: string }>;
      };
      const node = list.items.find((i) => i.uid === "GAP-V");
      assert.deepEqual([node?.title, node?.status], ["v1 title", "draft"]);
    } finally {
      await drop(["GAP-V"]);
    }
  });

  it("tree paging caps and parent validation", async () => {
    for (const q of ["limit=101", "limit=0", "offset=100001", `parent=${"A".repeat(129)}`, "parent=a%20b"]) {
      assert.equal((await get(`${TREE}?${q}`)).status, 400, q);
    }
    assert.equal((await get(`${TREE}?parent=${"A".repeat(128)}`)).status, 404);
  });

  it("tree requires authentication", async () => {
    const r = await get(TREE, {});
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "unauthenticated");
  });

  it("ancestors terminate on a corrupt parent cycle (self and 2-node)", async () => {
    await lines([
      ["GAP-SELF", "reqalm", "GAP-SELF", "self", 0],
      ["GAP-C1", "reqalm", "GAP-C2", "c1", 0],
      ["GAP-C2", "reqalm", "GAP-C1", "c2", 0],
    ]);
    try {
      const self = await get("/api/v1/projects/reqalm/requirements/GAP-SELF");
      assert.equal(self.status, 200);
      assert.deepEqual((self.body.data as { ancestors: unknown[] }).ancestors, []);
      const c1 = await get("/api/v1/projects/reqalm/requirements/GAP-C1");
      assert.equal(c1.status, 200);
      assert.deepEqual(
        (c1.body.data as { ancestors: Array<{ uid: string }> }).ancestors.map((a) => a.uid),
        ["GAP-C2"],
      );
    } finally {
      await drop(["GAP-SELF", "GAP-C1", "GAP-C2"]);
    }
  });
});
