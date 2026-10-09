import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestApp, issueTestAccessToken, type TestApp } from "../../test/harness.js";
import type { RelationLinkDto, RequirementRelationsDto, VisibleRelationLink } from "./requirements-relations.js";

let ctx: TestApp;
let bearer: Record<string, string>;
const REL = (p: string, id: string) => `/api/v1/projects/${p}/requirements/${id}/relations`;
const q = (sql: string) => ctx.pool.query(sql);
const inject = (url: string, headers = bearer) =>
  ctx.app.inject({ method: "GET", url, remoteAddress: "203.0.113.50", headers: { host: "localhost:3000", ...headers } } as never);
const vis = (l: RelationLinkDto): VisibleRelationLink => (assert.ok(!("restricted" in l)), l);
const stub = (l: RelationLinkDto, kind: string, dir: "incoming" | "outgoing") =>
  assert.deepEqual(l, { restricted: true, relation_kind: kind, direction: dir });
const dataOf = (res: { statusCode: number; json: () => unknown }) => (assert.equal(res.statusCode, 200), (res.json() as { data: RequirementRelationsDto }).data);
const stripReqId = (b: Record<string, unknown>) => (({ request_id: _, ...r }) => r)(b);
const peerIds = (links?: RelationLinkDto[]) => (links ?? []).map((l) => ("restricted" in l ? "restricted" : vis(l).peer.id)).sort();

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
});
after(async () => ctx.close());

function assertCapReadReqsStable(d: RequirementRelationsDto) {
  assert.deepEqual(Object.keys(d.outgoing).sort(), ["satisfies"]);
  assert.deepEqual(Object.keys(d.incoming).sort(), ["satisfies"]);
  assert.deepEqual(peerIds(d.outgoing.satisfies), ["ARCH-API-RBAC", "C08", "CAP-RBAC", "CAP-SVC-OPERATION-ROUTE", "D06"]);
  assert.deepEqual(peerIds(d.incoming.satisfies), ["CAP-BROWSE-UI-REQS", "CAP-READ-HIERARCHY", "CAP-RELATIONS-API"]);
  for (const link of Object.values(d.outgoing).flat().concat(Object.values(d.incoming).flat())) {
    assert.ok(!("restricted" in link) && vis(link).relation_kind);
  }
  assert.equal(vis(d.outgoing.satisfies!.find((l) => vis(l).peer.id === "C08")!).peer.title, "Search requirements in client/project");
}

describe("requirements relations API", () => {
  it("404 unknown vs foreign-project line; baseline CAP-READ-REQS", async () => {
    assertCapReadReqsStable(dataOf(await inject(REL("reqalm", "CAP-READ-REQS"))));
    const unknown = await inject(REL("reqalm", "NO-SUCH-REQ-XYZ"));
    assert.equal(unknown.statusCode, 404);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('rel-p2', 'reqalm-client', 'P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('REL-P2-ONLY', 'rel-p2', 'requirement', 'x') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('REL-P2-ONLY', 'REL-P2-ONLY', 'rel-p2', 0, 'active', 'x') ON CONFLICT DO NOTHING`);
    try {
      const other = await inject(REL("reqalm", "REL-P2-ONLY"));
      assert.equal(other.statusCode, 404);
      assert.deepEqual(stripReqId(other.json() as Record<string, unknown>), stripReqId(unknown.json() as Record<string, unknown>));
    } finally {
      await q(`DELETE FROM requirement_versions WHERE base_uid = 'REL-P2-ONLY'`);
      await q(`DELETE FROM requirement_lines WHERE base_uid = 'REL-P2-ONLY'`);
      await q(`DELETE FROM projects WHERE id = 'rel-p2'`);
    }
  });

  it("cross-project line peer redaction without grant and as Key custodian", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('rel-secret-p2', 'reqalm-client', 'S') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('REL-SECRET-PEER', 'rel-secret-p2', 'requirement', 'secret title') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title) VALUES ('REL-SECRET-PEER', 'REL-SECRET-PEER', 'rel-secret-p2', 0, 'active', 's', 'secret title') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_project_id, to_uid, kind) VALUES ('reqalm', 'CAP-READ-REQS', 'rel-secret-p2', 'REL-SECRET-PEER', 'uses') ON CONFLICT DO NOTHING`);
    try {
      for (const grant of [null, `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-rel-secret', 'rel-secret-p2', 'casey-reader', 'Key custodian') ON CONFLICT DO NOTHING`]) {
        if (grant) await q(grant);
        const raw = await inject(REL("reqalm", "CAP-READ-REQS"));
        const text = raw.payload as string;
        assert.ok(!text.includes("REL-SECRET-PEER") && !text.includes("secret title"));
        const uses = dataOf(raw).outgoing.uses ?? [];
        const s = uses.find((l) => l.relation_kind === "uses" && "restricted" in l)!;
        stub(s, "uses", "outgoing");
        assert.equal(uses.indexOf(s), uses.length - 1);
        if (grant) await q(`DELETE FROM project_grants WHERE id = 'grant-kc-rel-secret'`);
      }
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_project_id = 'reqalm' AND to_uid = 'REL-SECRET-PEER'`);
      await q(`DELETE FROM requirement_versions WHERE base_uid = 'REL-SECRET-PEER'`);
      await q(`DELETE FROM requirement_lines WHERE base_uid = 'REL-SECRET-PEER'`);
      await q(`DELETE FROM projects WHERE id = 'rel-secret-p2'`);
    }
  });

  it("twin project grant on/off, incoming edge, distinct C08 title", async () => {
    const setup = async (grant: boolean) => {
      await q(`INSERT INTO projects (id, client_id, name) VALUES ('twin-b', 'reqalm-client', 'Twin B') ON CONFLICT DO NOTHING`);
      if (grant) await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-casey-twin-b', 'twin-b', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`);
      await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('CAP-READ-REQS', 'twin-b', 'capability', 'TWIN-SECRET'), ('C08', 'twin-b', 'requirement', 'TWIN-C08-TITLE'), ('TWIN-IN-SRC', 'reqalm', 'requirement', 'in') ON CONFLICT (project_id, base_uid) DO UPDATE SET title = EXCLUDED.title`);
      await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title) VALUES ('CAP-READ-REQS-twinb', 'CAP-READ-REQS', 'twin-b', 0, 'active', 'x', 'T'), ('C08-twinb', 'C08', 'twin-b', 0, 'active', 'x', 'TWIN-C08-TITLE'), ('TWIN-IN-SRC', 'TWIN-IN-SRC', 'reqalm', 0, 'active', 'x', 'in') ON CONFLICT (uid) DO UPDATE SET title = EXCLUDED.title, project_id = EXCLUDED.project_id`);
      await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_project_id, to_uid, kind) VALUES ('twin-b', 'CAP-READ-REQS', 'twin-b', 'C08', 'satisfies'), ('reqalm', 'TWIN-IN-SRC', 'twin-b', 'CAP-READ-REQS', 'refines') ON CONFLICT DO NOTHING`);
    };
    const teardown = async () => {
      await q(`DELETE FROM trace_edges WHERE from_project_id = 'twin-b' OR to_project_id = 'twin-b'`);
      await q(`DELETE FROM trace_edges WHERE from_uid = 'TWIN-IN-SRC' AND to_project_id = 'twin-b'`);
      await q(`DELETE FROM requirement_versions WHERE uid IN ('CAP-READ-REQS-twinb', 'C08-twinb')`);
      await q(`DELETE FROM requirement_lines WHERE project_id = 'twin-b'`);
      await q(`DELETE FROM project_grants WHERE id = 'grant-casey-twin-b'`);
      await q(`DELETE FROM projects WHERE id = 'twin-b'`);
    };
    try {
      await setup(false);
      assertCapReadReqsStable(dataOf(await inject(REL("reqalm", "CAP-READ-REQS"))));
      assert.equal((await inject(REL("twin-b", "CAP-READ-REQS"))).statusCode, 404);
      await teardown();
      await setup(true);
      assertCapReadReqsStable(dataOf(await inject(REL("reqalm", "CAP-READ-REQS"))));
      const twin = dataOf(await inject(REL("twin-b", "CAP-READ-REQS")));
      assert.deepEqual(peerIds(twin.outgoing.satisfies), ["C08"]);
      assert.equal(vis(twin.outgoing.satisfies![0]!).peer.title, "TWIN-C08-TITLE");
      assert.ok(twin.incoming.refines?.some((l) => vis(l).peer.id === "TWIN-IN-SRC"));
    } finally {
      await teardown();
    }
  });

  it("A01 version pins, latest title, incoming dedupe, suspect dedupe", async () => {
    const refIn = dataOf(await inject(REL("reqalm", "A01"))).incoming.refines ?? [];
    const devenv = refIn.filter((l) => vis(l).peer.id === "ARCH-DEVENV-IDENTITY");
    assert.deepEqual(devenv.map((l) => [vis(l).peer_version_id, vis(l).relation_kind, vis(l).peer.id]).sort(), [
      ["ARCH-DEVENV-IDENTITY", "refines", "ARCH-DEVENV-IDENTITY"],
      ["ARCH-DEVENV-IDENTITY.1", "refines", "ARCH-DEVENV-IDENTITY"],
    ]);
    await q(`UPDATE requirement_versions SET title = 'LATEST-DEVENV-TITLE' WHERE uid = 'ARCH-DEVENV-IDENTITY.1'`);
    try {
      const dev2 = (dataOf(await inject(REL("reqalm", "A01"))).incoming.refines ?? []).filter((l) => vis(l).peer.id === "ARCH-DEVENV-IDENTITY");
      assert.ok(dev2.every((l) => vis(l).peer.title === "LATEST-DEVENV-TITLE"));
    } finally {
      await q(`UPDATE requirement_versions SET title = NULL WHERE uid = 'ARCH-DEVENV-IDENTITY.1'`);
    }
    for (const id of ["ARCH-AUTH-LOCAL.1", "MC01.1"]) {
      const l = refIn.find((x) => vis(x).peer_version_id === id)!;
      assert.equal(vis(l).relation_kind, "refines");
      assert.equal(vis(l).peer.id, id.replace(/\.1$/, ""));
      assert.ok(vis(l).peer.title);
    }
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('DEDUP-PEER', 'reqalm', 'requirement', 'd'), ('SUS-PEER', 'reqalm', 'requirement', 's') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('DEDUP-PEER', 'DEDUP-PEER', 'reqalm', 0, 'active', 'x'), ('SUS-PEER', 'SUS-PEER', 'reqalm', 0, 'active', 's') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_project_id, to_uid, kind, trace_suspect) VALUES
      ('reqalm', 'DEDUP-PEER', 'reqalm', 'FIX-SUCC-2HOP.1', 'uses', false), ('reqalm', 'DEDUP-PEER', 'reqalm', 'FIX-SUCC-2HOP.2', 'uses', false),
      ('reqalm', 'FIX-SUCC-2HOP', 'reqalm', 'SUS-PEER', 'uses', false), ('reqalm', 'FIX-SUCC-2HOP.1', 'reqalm', 'SUS-PEER', 'uses', true) ON CONFLICT DO NOTHING`);
    try {
      const hop = dataOf(await inject(REL("reqalm", "FIX-SUCC-2HOP")));
      const ded = hop.incoming.uses?.filter((l) => vis(l).peer.id === "DEDUP-PEER") ?? [];
      assert.equal(ded.length, 1);
      assert.equal(vis(ded[0]!).self_version_id, "FIX-SUCC-2HOP.2");
      assert.equal(vis(ded[0]!).relation_kind, "uses");
      const sus = hop.outgoing.uses?.filter((l) => vis(l).peer.id === "SUS-PEER") ?? [];
      assert.deepEqual(sus.map((l) => [vis(l).self_version_id, vis(l).trace_suspect, vis(l).relation_kind]).sort(), [
        ["FIX-SUCC-2HOP", false, "uses"],
        ["FIX-SUCC-2HOP.1", true, "uses"],
      ]);
      const inc = hop.incoming.uses?.find((l) => vis(l).peer.id === "FIX-CONTRACT-DOC-NOCTX")!;
      assert.equal(vis(inc).trace_suspect, true);
      assert.equal(vis(inc).self_version_id, "FIX-SUCC-2HOP.1");
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_uid IN ('DEDUP-PEER','FIX-SUCC-2HOP','FIX-SUCC-2HOP.1') AND to_uid IN ('FIX-SUCC-2HOP.1','FIX-SUCC-2HOP.2','SUS-PEER')`);
      await q(`DELETE FROM requirement_versions WHERE base_uid IN ('DEDUP-PEER','SUS-PEER')`);
      await q(`DELETE FROM requirement_lines WHERE base_uid IN ('DEDUP-PEER','SUS-PEER')`);
    }
  });

  it("private catalog stub, authz, audit", async () => {
    await q(`INSERT INTO catalog_defs (id, is_standard, project_id) VALUES ('cat-test-private', false, 'rel-cat-p2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_imprints (id, catalog_id) VALUES ('imprint-live-cc-PRIVATE', 'cat-test-private') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_item_labels (catalog_id, item_uid, title) VALUES ('cat-test-private', 'PRIV-CTL-1', 'Secret control title') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id, trace_suspect) VALUES ('reqalm', 'CAP-READ-REQS', 'PRIV-CTL-1', 'conforms_to', 'imprint-live-cc-PRIVATE', true) ON CONFLICT DO NOTHING`);
    try {
      stub((dataOf(await inject(REL("reqalm", "CAP-READ-REQS"))).outgoing.conforms_to ?? []).find((l) => "restricted" in l)!, "conforms_to", "outgoing");
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_uid = 'CAP-READ-REQS' AND to_uid = 'PRIV-CTL-1'`);
      await q(`DELETE FROM catalog_item_labels WHERE catalog_id = 'cat-test-private'`);
      await q(`DELETE FROM catalog_imprints WHERE id = 'imprint-live-cc-PRIVATE'`);
      await q(`DELETE FROM catalog_defs WHERE id = 'cat-test-private'`);
    }
    await q(`INSERT INTO identities (id, display_name) VALUES ('no-grant-user', 'No Grant') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO local_credentials (identity_id, username, password_hash, is_dev_seeded) SELECT 'no-grant-user', 'no-grant@dev.local', password_hash, true FROM local_credentials WHERE identity_id = 'casey-reader' LIMIT 1 ON CONFLICT (identity_id) DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash`);
    assert.equal((await inject(REL("reqalm", "A01"), { authorization: `Bearer ${await issueTestAccessToken(ctx.app, "no-grant@dev.local")}` })).statusCode, 404);
    const saved = (await ctx.pool.query<{ id: string; role: string }>(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm' AND revoked_at IS NULL`)).rows;
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-rel', 'reqalm', 'casey-reader', 'Key custodian')`);
    assert.equal((await inject(REL("reqalm", "A01"))).statusCode, 403);
    await q(`DELETE FROM project_grants WHERE id = 'grant-kc-rel'`);
    for (const g of saved) await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('${g.id}', 'reqalm', 'casey-reader', '${g.role}') ON CONFLICT DO NOTHING`);
    const res = await inject(REL("reqalm", "CAP-READ-REQS"), { ...bearer, "x-request-id": "rel-audit-allowed" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual((await ctx.pool.query(`SELECT operation, outcome, project_id, target_id FROM audit_events WHERE request_id = 'rel-audit-allowed' ORDER BY id DESC LIMIT 1`)).rows[0], {
      operation: "requirements.get_relations",
      outcome: "allow",
      project_id: "reqalm",
      target_id: "CAP-READ-REQS",
    });
  });
});
