import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createTestApp,
  issueTestAccessToken,
  TEST_PASSWORD,
  type TestApp,
} from "../../test/harness.js";
import { hashPassword } from "../../credential/password.js";

let ctx: TestApp;
let bearer: Record<string, string>;

const REL = (id: string) => `/api/v1/projects/reqalm/requirements/${id}/relations`;

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  const token = await issueTestAccessToken(ctx.app);
  bearer = { authorization: `Bearer ${token}` };
});

after(async () => {
  await ctx.close();
});

const inject = (opts: { method: string; url: string; headers?: Record<string, string> }) =>
  ctx.app.inject({
    ...opts,
    remoteAddress: "203.0.113.50",
    headers: { host: "localhost:3000", ...opts.headers },
  } as never);

describe("requirements relations API", () => {
  it("groups outgoing and incoming links by kind with resolved peers", async () => {
    const res = await inject({ method: "GET", url: REL("CAP-READ-REQS"), headers: bearer });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { data: RequirementRelationsPayload; request_id: string };
    assert.ok(body.request_id.length > 0);
    assert.equal(body.data.id, "CAP-READ-REQS");
    assert.equal(body.data.project_id, "reqalm");
    const outSat = body.data.outgoing.satisfies ?? [];
    assert.equal(outSat.length, 5);
    const targets = outSat.map((l) => (l.peer as VisiblePeer).id).sort();
    assert.deepEqual(targets, ["ARCH-API-RBAC", "C08", "CAP-RBAC", "CAP-SVC-OPERATION-ROUTE", "D06"]);
    assert.ok(outSat.every((l) => l.relation_kind === "satisfies" && l.trace_suspect === false));
    assert.ok(
      outSat.every(
        (l) =>
          "title" in l.peer &&
          ["requirement", "capability"].includes((l.peer as VisiblePeer).kind),
      ),
    );
    const inSat = body.data.incoming.satisfies ?? [];
    assert.deepEqual(
      inSat.map((l) => (l.peer as VisiblePeer).id).sort(),
      ["CAP-BROWSE-UI-REQS", "CAP-READ-HIERARCHY", "CAP-RELATIONS-API"],
    );
    assert.deepEqual(Object.keys(body.data.outgoing).sort(), ["satisfies"]);
    assert.deepEqual(Object.keys(body.data.incoming).sort(), ["satisfies"]);
  });

  it("resolves catalog conforms_to peers with titles", async () => {
    const res = await inject({ method: "GET", url: REL("A01"), headers: bearer });
    assert.equal(res.statusCode, 200);
    const conforms = (res.json() as { data: RequirementRelationsPayload }).data.outgoing.conforms_to ?? [];
    const ac3 = conforms.find((l) => (l.peer as VisiblePeer).id === "AC-3");
    assert.ok(ac3, "expected AC-3 conforms_to");
    assert.equal(ac3!.catalog_imprint_id, "nist-800-53@rev5-dogfood-20261006");
    assert.match((ac3!.peer as VisiblePeer).title, /Access Enforcement/);
    assert.equal((ac3!.peer as VisiblePeer).type, "catalog_control");
  });

  it("includes version-pinned edge endpoints when querying the line base_uid", async () => {
    await ctx.pool.query(
      `INSERT INTO trace_edges (from_uid, to_uid, kind, catalog_imprint_id)
       VALUES ('FIX-SUCC-2HOP', 'FIX-SUCC-2HOP.1', 'uses', '')
       ON CONFLICT DO NOTHING`,
    );
    const res = await inject({ method: "GET", url: REL("FIX-SUCC-2HOP"), headers: bearer });
    assert.equal(res.statusCode, 200);
    const uses = (res.json() as { data: RequirementRelationsPayload }).data.outgoing.uses ?? [];
    assert.ok(uses.some((l) => (l.peer as VisiblePeer).id === "FIX-SUCC-2HOP"));
    await ctx.pool.query(
      `DELETE FROM trace_edges WHERE from_uid = 'FIX-SUCC-2HOP' AND to_uid = 'FIX-SUCC-2HOP.1'`,
    );
  });

  it("returns 404 for unknown requirement id in project", async () => {
    const res = await inject({ method: "GET", url: REL("NO-SUCH-REQ-XYZ"), headers: bearer });
    assert.equal(res.statusCode, 404);
    assert.equal((res.json() as { code: string }).code, "not_found");
  });

  it("returns 404 when the line lives in another project", async () => {
    await ctx.pool.query(
      `INSERT INTO projects (id, client_id, name) VALUES ('rel-p2', 'reqalm-client', 'Rel P2') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, kind, title)
       VALUES ('REL-P2-ONLY', 'rel-p2', 'requirement', 'other') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement)
       VALUES ('REL-P2-ONLY', 'REL-P2-ONLY', 'rel-p2', 0, 'active', 'x') ON CONFLICT DO NOTHING`,
    );
    try {
      const res = await inject({ method: "GET", url: REL("REL-P2-ONLY"), headers: bearer });
      assert.equal(res.statusCode, 404);
    } finally {
      await ctx.pool.query(`DELETE FROM requirement_versions WHERE base_uid = 'REL-P2-ONLY'`);
      await ctx.pool.query(`DELETE FROM requirement_lines WHERE base_uid = 'REL-P2-ONLY'`);
      await ctx.pool.query(`DELETE FROM projects WHERE id = 'rel-p2'`);
    }
  });

  it("denies Key custodian without requirement:read", async () => {
    const saved = (
      await ctx.pool.query<{ id: string; role: string }>(
        `SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm' AND revoked_at IS NULL`,
      )
    ).rows;
    await ctx.pool.query(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role)
       VALUES ('grant-kc-rel', 'reqalm', 'casey-reader', 'Key custodian')`,
    );
    try {
      assert.equal(
        (await inject({ method: "GET", url: REL("CAP-READ-REQS"), headers: bearer })).statusCode,
        403,
      );
    } finally {
      await ctx.pool.query(`DELETE FROM project_grants WHERE id = 'grant-kc-rel'`);
      for (const g of saved) {
        await ctx.pool.query(
          `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, 'reqalm', 'casey-reader', $2) ON CONFLICT DO NOTHING`,
          [g.id, g.role],
        );
      }
    }
  });

  it("denies callers without project grants", async () => {
    const hash = await hashPassword(TEST_PASSWORD);
    await ctx.pool.query(
      `INSERT INTO local_credentials (identity_id, username, password_hash, is_dev_seeded)
       VALUES ('no-grant-user', 'nogrant@dev.local', $1, true)
       ON CONFLICT (identity_id) DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash`,
      [hash],
    );
    const token = await issueTestAccessToken(ctx.app, "nogrant@dev.local");
    const res = await inject({
      method: "GET",
      url: REL("CAP-READ-REQS"),
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 404);
    assert.equal((res.json() as { code: string }).code, "not_found");
  });

  it("does not leak cross-project peer ids (restricted stub)", async () => {
    await ctx.pool.query(
      `INSERT INTO projects (id, client_id, name) VALUES ('rel-secret-p2', 'reqalm-client', 'Secret') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, kind, title)
       VALUES ('REL-SECRET-PEER', 'rel-secret-p2', 'requirement', 'secret title') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title)
       VALUES ('REL-SECRET-PEER', 'REL-SECRET-PEER', 'rel-secret-p2', 0, 'active', 's', 'secret title') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO trace_edges (from_uid, to_uid, kind, catalog_imprint_id)
       VALUES ('CAP-READ-REQS', 'REL-SECRET-PEER', 'uses', '') ON CONFLICT DO NOTHING`,
    );
    try {
      const raw = await inject({ method: "GET", url: REL("CAP-READ-REQS"), headers: bearer });
      assert.equal(raw.statusCode, 200);
      const text = raw.payload as string;
      assert.ok(!text.includes("REL-SECRET-PEER"), "cross-project peer id must not appear in payload");
      assert.ok(!text.includes("secret title"));
      const uses = (raw.json() as { data: RequirementRelationsPayload }).data.outgoing.uses ?? [];
      const stub = uses.find((l) => l.relation_kind === "uses" && "restricted" in l.peer);
      assert.ok(stub, "expected a restricted uses link");
      assert.deepEqual(stub!.peer, { restricted: true });
    } finally {
      await ctx.pool.query(
        `DELETE FROM trace_edges WHERE from_uid = 'CAP-READ-REQS' AND to_uid = 'REL-SECRET-PEER'`,
      );
      await ctx.pool.query(`DELETE FROM requirement_versions WHERE base_uid = 'REL-SECRET-PEER'`);
      await ctx.pool.query(`DELETE FROM requirement_lines WHERE base_uid = 'REL-SECRET-PEER'`);
      await ctx.pool.query(`DELETE FROM projects WHERE id = 'rel-secret-p2'`);
    }
  });

  it("hides private catalog peers from readers without catalog project access", async () => {
    await ctx.pool.query(
      `INSERT INTO catalog_defs (id, is_standard, project_id)
       VALUES ('cat-test-private', false, 'rel-cat-p2') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO catalog_imprints (id, catalog_id)
       VALUES ('imprint-test-private', 'cat-test-private') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO catalog_item_labels (catalog_id, item_uid, title)
       VALUES ('cat-test-private', 'PRIV-CTL-1', 'Secret control title') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO trace_edges (from_uid, to_uid, kind, catalog_imprint_id)
       VALUES ('CAP-READ-REQS', 'PRIV-CTL-1', 'conforms_to', 'imprint-test-private') ON CONFLICT DO NOTHING`,
    );
    try {
      const raw = await inject({ method: "GET", url: REL("CAP-READ-REQS"), headers: bearer });
      assert.equal(raw.statusCode, 200);
      const text = raw.payload as string;
      assert.ok(!text.includes("PRIV-CTL-1"));
      assert.ok(!text.includes("Secret control title"));
      const conforms = (raw.json() as { data: RequirementRelationsPayload }).data.outgoing.conforms_to ?? [];
      assert.ok(conforms.some((l) => "restricted" in l.peer));
    } finally {
      await ctx.pool.query(
        `DELETE FROM trace_edges WHERE from_uid = 'CAP-READ-REQS' AND to_uid = 'PRIV-CTL-1'`,
      );
      await ctx.pool.query(`DELETE FROM catalog_item_labels WHERE catalog_id = 'cat-test-private'`);
      await ctx.pool.query(`DELETE FROM catalog_imprints WHERE id = 'imprint-test-private'`);
      await ctx.pool.query(`DELETE FROM catalog_defs WHERE id = 'cat-test-private'`);
    }
  });
});

type VisiblePeer = { id: string; title: string; kind: string; type: string };
type RequirementRelationsPayload = {
  id: string;
  project_id: string;
  outgoing: Record<
    string,
    Array<{
      relation_kind: string;
      peer: VisiblePeer | { restricted: true };
      catalog_imprint_id?: string | null;
      trace_suspect: boolean;
    }>
  >;
  incoming: Record<string, Array<{ relation_kind: string; peer: VisiblePeer | { restricted: true } }>>;
};
