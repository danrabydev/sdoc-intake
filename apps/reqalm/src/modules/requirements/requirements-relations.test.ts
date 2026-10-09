import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createTestApp,
  issueTestAccessToken,
  type TestApp,
} from "../../test/harness.js";
import type { RelationLinkDto, VisibleRelationLink } from "./requirements-relations.js";

let ctx: TestApp;
let bearer: Record<string, string>;

const REL = (project: string, id: string) =>
  `/api/v1/projects/${project}/requirements/${id}/relations`;

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
});

after(async () => {
  await ctx.close();
});

const inject = (opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
}) =>
  ctx.app.inject({
    ...opts,
    remoteAddress: "203.0.113.50",
    headers: { host: "localhost:3000", ...opts.headers },
  } as never);

function vis(link: RelationLinkDto): VisibleRelationLink {
  assert.ok(!("restricted" in link));
  return link;
}

describe("requirements relations API", () => {
  it("groups outgoing/incoming by kind with version ids (project-scoped)", async () => {
    const res = await inject({ method: "GET", url: REL("reqalm", "CAP-READ-REQS"), headers: bearer });
    assert.equal(res.statusCode, 200);
    const data = (res.json() as { data: { outgoing: Record<string, RelationLinkDto[]> } }).data;
    const outSat = data.outgoing.satisfies ?? [];
    assert.equal(outSat.length, 5);
    assert.ok(outSat.every((l) => vis(l).self_version_id === "CAP-READ-REQS"));
  });

  it("dedupes same catalog pin across line version uids", async () => {
    const res = await inject({ method: "GET", url: REL("reqalm", "FIX-SUCC-2HOP"), headers: bearer });
    const conforms = (res.json() as { data: { outgoing: { conforms_to?: RelationLinkDto[] } } }).data.outgoing
      .conforms_to ?? [];
    const cm3 = conforms.filter((l) => vis(l).peer.id === "CM-3");
    assert.equal(cm3.length, 1);
    assert.equal(vis(cm3[0]!).self_version_id, "FIX-SUCC-2HOP.2");
  });

  it("incoming suspect edge keeps pinned peer version id", async () => {
    const res = await inject({ method: "GET", url: REL("reqalm", "FIX-SUCC-2HOP"), headers: bearer });
    const uses = (res.json() as { data: { incoming: { uses?: RelationLinkDto[] } } }).data.incoming.uses ?? [];
    const edge = uses.find((l) => vis(l).peer.id === "FIX-CONTRACT-DOC-NOCTX");
    assert.ok(edge);
    assert.equal(vis(edge!).peer_version_id, "FIX-CONTRACT-DOC-NOCTX");
    assert.equal(vis(edge!).self_version_id, "FIX-SUCC-2HOP.1");
    assert.equal(vis(edge!).trace_suspect, true);
    assert.equal(vis(edge!).peer.title, "Doc view no-context = {A01,A02}");
  });

  it("resolves catalog conforms_to when label exists", async () => {
    const conforms =
      (await inject({ method: "GET", url: REL("reqalm", "A01"), headers: bearer })).json() as {
        data: { outgoing: { conforms_to?: RelationLinkDto[] } };
      };
    const ac3 = conforms.data.outgoing.conforms_to?.find((l) => vis(l).peer.id === "AC-3");
    assert.ok(ac3);
    assert.match(vis(ac3!).peer.title, /Access Enforcement/);
    assert.equal(vis(ac3!).catalog_imprint_id, "nist-800-53@rev5-dogfood-20261006");
  });

  it("same base_uid in two projects does not mix edges or peers", async () => {
    await ctx.pool.query(`INSERT INTO projects (id, client_id, name) VALUES ('twin-b', 'reqalm-client', 'Twin B') ON CONFLICT DO NOTHING`);
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-casey-twin-b', 'twin-b', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('CAP-READ-REQS', 'twin-b', 'capability', 'TWIN-SECRET-TITLE') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title)
       VALUES ('CAP-READ-REQS', 'CAP-READ-REQS', 'twin-b', 0, 'active', 'x', 'TWIN-SECRET-TITLE') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO trace_edges (from_project_id, from_uid, to_project_id, to_uid, kind, catalog_imprint_id)
       VALUES ('twin-b', 'CAP-READ-REQS', 'twin-b', 'TWIN-PEER-ONLY-B', 'uses', '') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('TWIN-PEER-ONLY-B', 'twin-b', 'requirement', 'peer b') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('TWIN-PEER-ONLY-B', 'TWIN-PEER-ONLY-B', 'twin-b', 0, 'active', 'p') ON CONFLICT DO NOTHING`,
    );
    try {
      const reqalmRaw = await inject({ method: "GET", url: REL("reqalm", "CAP-READ-REQS"), headers: bearer });
      const twinRaw = await inject({ method: "GET", url: REL("twin-b", "CAP-READ-REQS"), headers: bearer });
      assert.equal(reqalmRaw.statusCode, 200);
      assert.equal(twinRaw.statusCode, 200);
      const reqalmText = reqalmRaw.payload as string;
      assert.ok(!reqalmText.includes("TWIN-SECRET-TITLE"));
      assert.ok(!reqalmText.includes("TWIN-PEER-ONLY-B"));
      const twinUses = (twinRaw.json() as { data: { outgoing: { uses?: RelationLinkDto[] } } }).data.outgoing.uses ?? [];
      assert.equal(twinUses.length, 1);
      assert.equal(vis(twinUses[0]!).peer.title, "peer b");
      const reqalmSat = (reqalmRaw.json() as { data: { outgoing: { satisfies?: RelationLinkDto[] } } }).data.outgoing
        .satisfies ?? [];
      assert.ok(reqalmSat.some((l) => vis(l).peer.id === "C08"));
    } finally {
      await ctx.pool.query(`DELETE FROM trace_edges WHERE from_project_id = 'twin-b' AND from_uid = 'CAP-READ-REQS'`);
      await ctx.pool.query(`DELETE FROM requirement_versions WHERE project_id = 'twin-b' AND base_uid = ANY('{CAP-READ-REQS,TWIN-PEER-ONLY-B}')`);
      await ctx.pool.query(`DELETE FROM requirement_lines WHERE project_id = 'twin-b' AND base_uid = ANY('{CAP-READ-REQS,TWIN-PEER-ONLY-B}')`);
      await ctx.pool.query(`DELETE FROM project_grants WHERE id = 'grant-casey-twin-b'`);
      await ctx.pool.query(`DELETE FROM projects WHERE id = 'twin-b'`);
    }
  });

  it("403/404 and permission cases", async () => {
    assert.equal((await inject({ method: "GET", url: REL("reqalm", "NO-SUCH"), headers: bearer })).statusCode, 404);
    await ctx.pool.query(
      `INSERT INTO identities (id, display_name) VALUES ('no-grant-user', 'No Grant') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO local_credentials (identity_id, username, password_hash, is_dev_seeded)
       SELECT 'no-grant-user', 'no-grant@dev.local', password_hash, true FROM local_credentials WHERE identity_id = 'casey-reader' LIMIT 1
       ON CONFLICT (identity_id) DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash`,
    );
    const nogrant = { authorization: `Bearer ${await issueTestAccessToken(ctx.app, "no-grant@dev.local")}` };
    assert.equal((await inject({ method: "GET", url: REL("reqalm", "A01"), headers: nogrant })).statusCode, 404);
    const saved = (
      await ctx.pool.query<{ id: string; role: string }>(
        `SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm' AND revoked_at IS NULL`,
      )
    ).rows;
    await ctx.pool.query(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-rel', 'reqalm', 'casey-reader', 'Key custodian')`,
    );
    assert.equal((await inject({ method: "GET", url: REL("reqalm", "A01"), headers: bearer })).statusCode, 403);
    await ctx.pool.query(`DELETE FROM project_grants WHERE id = 'grant-kc-rel'`);
    for (const g of saved) {
      await ctx.pool.query(
        `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, 'reqalm', 'casey-reader', $2) ON CONFLICT DO NOTHING`,
        [g.id, g.role],
      );
    }
  });

  it("restricted catalog peer exposes only restricted stub fields", async () => {
    await ctx.pool.query(
      `INSERT INTO catalog_defs (id, is_standard, project_id) VALUES ('cat-test-private', false, 'rel-cat-p2') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO catalog_imprints (id, catalog_id) VALUES ('imprint-live-cc-PRIVATE', 'cat-test-private') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO catalog_item_labels (catalog_id, item_uid, title) VALUES ('cat-test-private', 'PRIV-CTL-1', 'Secret control title') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO trace_edges (from_project_id, from_uid, to_project_id, to_uid, kind, catalog_imprint_id, trace_suspect)
       VALUES ('reqalm', 'CAP-READ-REQS', NULL, 'PRIV-CTL-1', 'conforms_to', 'imprint-live-cc-PRIVATE', true) ON CONFLICT DO NOTHING`,
    );
    try {
      const raw = await inject({ method: "GET", url: REL("reqalm", "CAP-READ-REQS"), headers: bearer });
      const text = raw.payload as string;
      assert.ok(!text.includes("imprint-live-cc-PRIVATE"));
      assert.ok(!text.includes("PRIV-CTL-1"));
      assert.ok(!text.includes("Secret control title"));
      const conforms = (raw.json() as { data: { outgoing: { conforms_to?: RelationLinkDto[] } } }).data.outgoing
        .conforms_to ?? [];
      const stub = conforms.find((l) => "restricted" in l);
      assert.deepEqual(stub, { restricted: true, relation_kind: "conforms_to", direction: "outgoing" });
      const idx = conforms.indexOf(stub!);
      assert.equal(idx, conforms.length - 1);
    } finally {
      await ctx.pool.query(
        `DELETE FROM trace_edges WHERE from_project_id = 'reqalm' AND from_uid = 'CAP-READ-REQS' AND to_uid = 'PRIV-CTL-1'`,
      );
      await ctx.pool.query(`DELETE FROM catalog_item_labels WHERE catalog_id = 'cat-test-private'`);
      await ctx.pool.query(`DELETE FROM catalog_imprints WHERE id = 'imprint-live-cc-PRIVATE'`);
      await ctx.pool.query(`DELETE FROM catalog_defs WHERE id = 'cat-test-private'`);
    }
  });

  it("writes audit row for allowed read", async () => {
    const res = await inject({
      method: "GET",
      url: REL("reqalm", "CAP-READ-REQS"),
      headers: { ...bearer, "x-request-id": "rel-audit-allowed" },
    });
    assert.equal(res.statusCode, 200);
    const row = (
      await ctx.pool.query<{
        operation: string;
        outcome: string;
        project_id: string | null;
        target_id: string | null;
      }>(`SELECT operation, outcome, project_id, target_id FROM audit_events WHERE request_id = 'rel-audit-allowed' ORDER BY id DESC LIMIT 1`)
    ).rows[0];
    assert.equal(row?.operation, "requirements.get_relations");
    assert.equal(row?.outcome, "allow");
    assert.equal(row?.project_id, "reqalm");
    assert.equal(row?.target_id, "CAP-READ-REQS");
  });
});
