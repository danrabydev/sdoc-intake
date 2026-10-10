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
  assert.deepEqual(peerIds(d.incoming.satisfies), [
    "CAP-BROWSE-UI-REQS",
    "CAP-CATALOGS-API",
    "CAP-READ-CONTRACTS",
    "CAP-READ-HIERARCHY",
    "CAP-RELATIONS-API",
  ]);
  const browse = d.incoming.satisfies?.find((l) => !("restricted" in l) && vis(l).peer.id === "CAP-BROWSE-UI-REQS");
  assert.ok(browse);
  assert.equal(vis(browse!).peer_version_id, "CAP-BROWSE-UI-REQS.1");
  for (const link of Object.values(d.outgoing).flat().concat(Object.values(d.incoming).flat())) {
    assert.ok(!("restricted" in link) && vis(link).relation_kind);
  }
  assert.equal(vis(d.outgoing.satisfies!.find((l) => vis(l).peer.id === "C08")!).peer.title, "Search requirements in client/project");
}

describe("requirements relations API", () => {
  it("visible peers include project_id; restricted stubs stay minimal", async () => {
    const d = dataOf(await inject(REL("reqalm", "CAP-READ-REQS")));
    for (const link of Object.values(d.outgoing).flat().concat(Object.values(d.incoming).flat())) {
      if ("restricted" in link) {
        assert.deepEqual(Object.keys(link).sort(), ["direction", "relation_kind", "restricted"]);
        continue;
      }
      const p = vis(link).peer;
      assert.equal(typeof p.project_id, "string");
      assert.ok(p.project_id.length > 0);
    }
    const c08 = vis(d.outgoing.satisfies!.find((l) => vis(l).peer.id === "C08")!);
    assert.equal(c08.peer.project_id, "reqalm");
  });

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
      assert.equal((unknown.json() as { detail: string }).detail, "Requirement not found");
      assert.deepEqual(stripReqId(other.json() as Record<string, unknown>), stripReqId(unknown.json() as Record<string, unknown>));
    } finally {
      await q(`DELETE FROM requirement_versions WHERE base_uid = 'REL-P2-ONLY'`);
      await q(`DELETE FROM requirement_lines WHERE base_uid = 'REL-P2-ONLY'`);
      await q(`DELETE FROM projects WHERE id = 'rel-p2'`);
    }
  });
  it("cross-project redaction, missing peer (LEAK1), KC vs Reader", async () => {
    const stubUses = { restricted: true, relation_kind: "uses", direction: "outgoing" as const };
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('rel-secret-p2', 'reqalm-client', 'S') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('REL-SECRET-PEER', 'rel-secret-p2', 'requirement', 'secret title'), ('REL-NOVER', 'rel-secret-p2', 'requirement', 'line only') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title) VALUES ('REL-SECRET-PEER', 'REL-SECRET-PEER', 'rel-secret-p2', 0, 'active', 's', 'secret title') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_project_id, to_uid, kind) VALUES ('reqalm', 'CAP-READ-REQS', 'rel-secret-p2', 'REL-SECRET-PEER', 'uses'), ('reqalm', 'CAP-READ-REQS', 'rel-secret-p2', 'REL-MISSING-PEER', 'uses'), ('reqalm', 'CAP-READ-REQS', 'rel-secret-p2', 'REL-NOVER', 'uses') ON CONFLICT DO NOTHING`);
    try {
      for (const [grantId, role] of [
        [null, null],
        ["grant-kc-rel-secret", "Key custodian"],
        ["grant-r-rel-secret", "Reader"],
      ] as const) {
        if (grantId) await ctx.pool.query(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, 'rel-secret-p2', 'casey-reader', $2) ON CONFLICT DO NOTHING`, [grantId, role]);
        const raw = await inject(REL("reqalm", "CAP-READ-REQS"));
        const uses = dataOf(raw).outgoing.uses ?? [];
        if (role === "Reader") {
          const open = uses.filter((l) => !("restricted" in l));
          assert.deepEqual(open.map((l) => [vis(l).peer.id, vis(l).peer.title]).sort(), [
            ["REL-MISSING-PEER", null],
            ["REL-NOVER", "line only"],
            ["REL-SECRET-PEER", "secret title"],
          ]);
          assert.equal(vis(open.find((l) => vis(l).peer.id === "REL-MISSING-PEER")!).peer.project_id, "rel-secret-p2");
        } else {
          const text = raw.payload as string;
          assert.ok(!text.includes("REL-SECRET-PEER") && !text.includes("secret title") && !text.includes("REL-MISSING-PEER"));
          const stubs = uses.filter((l) => "restricted" in l);
          assert.equal(stubs.length, 3);
          for (const l of stubs) assert.deepEqual(l, stubUses);
        }
        if (grantId) await ctx.pool.query(`DELETE FROM project_grants WHERE id = $1`, [grantId]);
      }
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_project_id = 'reqalm' AND to_project_id = 'rel-secret-p2'`);
      await q(`DELETE FROM requirement_versions WHERE base_uid = 'REL-SECRET-PEER'`);
      await q(`DELETE FROM requirement_lines WHERE base_uid IN ('REL-SECRET-PEER','REL-NOVER')`);
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
      assert.equal(vis(twin.outgoing.satisfies![0]!).peer.project_id, "twin-b");
      const twinIn = twin.incoming.refines?.find((l) => !("restricted" in l) && vis(l).peer.id === "TWIN-IN-SRC");
      assert.ok(twinIn);
      assert.equal(vis(twinIn!).peer.project_id, "reqalm");
    } finally {
      await teardown();
    }
  });
  it("A01 version pins, latest title, incoming dedupe, suspect dedupe", async () => {
    const a01 = dataOf(await inject(REL("reqalm", "A01")));
    const ac3 = a01.outgoing.conforms_to?.find((l) => vis(l).peer.id === "AC-3")!;
    assert.match(vis(ac3).peer.title!, /Access Enforcement/);
    assert.equal(vis(ac3).catalog_imprint_id, "nist-800-53@rev5-dogfood-20261006");
    assert.equal(vis(ac3).peer.project_id, "reqalm");
    const refIn = a01.incoming.refines ?? [];
    const devenv = refIn.filter((l) => vis(l).peer.id === "ARCH-DEVENV-IDENTITY");
    assert.equal(devenv.length, 1);
    assert.equal(vis(devenv[0]!).peer_version_id, "ARCH-DEVENV-IDENTITY.1");
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
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('DEDUP-PEER', 'reqalm', 'requirement', 'd'), ('SUS-PEER', 'reqalm', 'requirement', 's'), ('SUS2-PEER', 'reqalm', 'requirement', 's2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('DEDUP-PEER', 'DEDUP-PEER', 'reqalm', 0, 'active', 'x'), ('SUS-PEER', 'SUS-PEER', 'reqalm', 0, 'active', 's'), ('SUS2-PEER', 'SUS2-PEER', 'reqalm', 0, 'active', 's2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_project_id, to_uid, kind, trace_suspect) VALUES
      ('reqalm', 'DEDUP-PEER', 'reqalm', 'FIX-SUCC-2HOP.1', 'uses', false), ('reqalm', 'DEDUP-PEER', 'reqalm', 'FIX-SUCC-2HOP.2', 'uses', false),
      ('reqalm', 'FIX-SUCC-2HOP', 'reqalm', 'SUS-PEER', 'uses', false), ('reqalm', 'FIX-SUCC-2HOP.1', 'reqalm', 'SUS-PEER', 'uses', true),
      ('reqalm', 'SUS2-PEER', 'reqalm', 'FIX-SUCC-2HOP.1', 'uses', true), ('reqalm', 'SUS2-PEER', 'reqalm', 'FIX-SUCC-2HOP.2', 'uses', false) ON CONFLICT DO NOTHING`);
    try {
      const hop = dataOf(await inject(REL("reqalm", "FIX-SUCC-2HOP")));
      const cm3 = hop.outgoing.conforms_to?.filter((l) => vis(l).peer.id === "CM-3") ?? [];
      assert.equal(cm3.length, 1);
      assert.equal(vis(cm3[0]!).self_version_id, "FIX-SUCC-2HOP.2");
      const ded = hop.incoming.uses?.filter((l) => vis(l).peer.id === "DEDUP-PEER") ?? [];
      assert.equal(ded.length, 1);
      assert.equal(vis(ded[0]!).self_version_id, "FIX-SUCC-2HOP.2");
      const sus = hop.outgoing.uses?.filter((l) => vis(l).peer.id === "SUS-PEER") ?? [];
      assert.deepEqual(sus.map((l) => [vis(l).self_version_id, vis(l).trace_suspect]).sort(), [["FIX-SUCC-2HOP", false], ["FIX-SUCC-2HOP.1", true]]);
      const inc = hop.incoming.uses?.find((l) => vis(l).peer.id === "FIX-CONTRACT-DOC-NOCTX")!;
      assert.equal(vis(inc).trace_suspect, true);
      assert.equal(vis(inc).self_version_id, "FIX-SUCC-2HOP.1");
      const sus2 = hop.incoming.uses?.filter((l) => vis(l).peer.id === "SUS2-PEER") ?? [];
      assert.deepEqual(sus2.map((l) => [vis(l).self_version_id, vis(l).trace_suspect]).sort(), [
        ["FIX-SUCC-2HOP.1", true],
        ["FIX-SUCC-2HOP.2", false],
      ]);
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_uid IN ('DEDUP-PEER','FIX-SUCC-2HOP','FIX-SUCC-2HOP.1','SUS2-PEER') AND to_uid IN ('FIX-SUCC-2HOP.1','FIX-SUCC-2HOP.2','SUS-PEER')`);
      await q(`DELETE FROM requirement_versions WHERE base_uid IN ('DEDUP-PEER','SUS-PEER','SUS2-PEER')`);
      await q(`DELETE FROM requirement_lines WHERE base_uid IN ('DEDUP-PEER','SUS-PEER','SUS2-PEER')`);
    }
  });

  it("readable private-catalog peer uses catalog owner project_id", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('rel-cat-p2', 'reqalm-client', 'Cat P2') ON CONFLICT DO NOTHING;
      INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-casey-rel-cat-p2', 'rel-cat-p2', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING;
      INSERT INTO catalog_defs (id, is_standard, project_id) VALUES ('cat-test-private', false, 'rel-cat-p2') ON CONFLICT DO NOTHING;
      INSERT INTO catalog_imprints (id, catalog_id) VALUES ('imprint-live-cc-PRIVATE', 'cat-test-private') ON CONFLICT DO NOTHING;
      INSERT INTO catalog_item_labels (catalog_id, item_uid, title) VALUES ('cat-test-private', 'PRIV-CTL-1', 'Private ctl') ON CONFLICT DO NOTHING;
      INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id) VALUES ('reqalm', 'CAP-READ-REQS', 'PRIV-CTL-1', 'conforms_to', 'imprint-live-cc-PRIVATE') ON CONFLICT DO NOTHING`);
    try {
      const link = dataOf(await inject(REL("reqalm", "CAP-READ-REQS"))).outgoing.conforms_to?.find(
        (l) => !("restricted" in l) && vis(l).peer.id === "PRIV-CTL-1",
      );
      assert.equal(vis(link!).peer.project_id, "rel-cat-p2");
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_uid = 'CAP-READ-REQS' AND to_uid = 'PRIV-CTL-1';
        DELETE FROM catalog_item_labels WHERE catalog_id = 'cat-test-private';
        DELETE FROM catalog_imprints WHERE id = 'imprint-live-cc-PRIVATE';
        DELETE FROM catalog_defs WHERE id = 'cat-test-private';
        DELETE FROM project_grants WHERE id = 'grant-casey-rel-cat-p2';
        DELETE FROM projects WHERE id = 'rel-cat-p2'`);
    }
  });

  it("keeps restricted stub alongside visible row for the same peer line id", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('rel-shared-p2', 'reqalm-client', 'Shared P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES
      ('SHARED-PEER-LINE', 'reqalm', 'requirement', 'Visible shared title'),
      ('SHARED-PEER-LINE', 'rel-shared-p2', 'requirement', 'Secret shared title') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title) VALUES
      ('SHARED-PEER-LINE', 'SHARED-PEER-LINE', 'reqalm', 0, 'active', 'open', 'Visible shared title'),
      ('SHARED-PEER-LINE-p2', 'SHARED-PEER-LINE', 'rel-shared-p2', 0, 'active', 'secret', 'Secret shared title') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_project_id, to_uid, kind) VALUES
      ('reqalm', 'CAP-READ-REQS', 'reqalm', 'SHARED-PEER-LINE', 'uses'),
      ('reqalm', 'CAP-READ-REQS', 'rel-shared-p2', 'SHARED-PEER-LINE-p2', 'uses') ON CONFLICT DO NOTHING`);
    try {
      const raw = await inject(REL("reqalm", "CAP-READ-REQS"));
      const uses = dataOf(raw).outgoing.uses ?? [];
      const visible = uses.filter((l) => !("restricted" in l));
      const stubs = uses.filter((l) => "restricted" in l);
      assert.equal(visible.length, 1);
      assert.equal(stubs.length, 1);
      assert.equal(vis(visible[0]!).peer.id, "SHARED-PEER-LINE");
      assert.equal(vis(visible[0]!).peer.title, "Visible shared title");
      assert.deepEqual(stubs[0], { restricted: true, relation_kind: "uses", direction: "outgoing" });
      const text = raw.payload as string;
      assert.ok(!text.includes("Secret shared title"));
      assert.ok(!text.includes("SHARED-PEER-LINE-p2"));
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_uid = 'CAP-READ-REQS' AND to_uid IN ('SHARED-PEER-LINE','SHARED-PEER-LINE-p2')`);
      await q(`DELETE FROM requirement_versions WHERE uid IN ('SHARED-PEER-LINE','SHARED-PEER-LINE-p2')`);
      await q(`DELETE FROM requirement_lines WHERE base_uid = 'SHARED-PEER-LINE' AND project_id IN ('reqalm','rel-shared-p2')`);
      await q(`DELETE FROM projects WHERE id = 'rel-shared-p2'`);
    }
  });

  it("dedupes same peer line to active tip; keeps cross-project and QZ vs QZ.7 separate", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('dedupe-p2', 'reqalm-client', 'Dedupe P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-casey-dedupe-p2', 'dedupe-p2', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES
      ('CAP-BROWSE-UI-REQS', 'dedupe-p2', 'capability', 'Remote browse'),
      ('QZ', 'reqalm', 'requirement', 'QZ line'),
      ('QZ.7', 'reqalm', 'requirement', 'QZ.7 line') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES
      ('CAP-BROWSE-UI-REQS-dedupe-p2', 'CAP-BROWSE-UI-REQS', 'dedupe-p2', 0, 'active', 'remote'),
      ('QZ', 'QZ', 'reqalm', 0, 'active', 'qz'),
      ('QZ.7', 'QZ.7', 'reqalm', 0, 'active', 'qz7') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_project_id, to_uid, kind) VALUES
      ('dedupe-p2', 'CAP-BROWSE-UI-REQS-dedupe-p2', 'reqalm', 'CAP-READ-REQS', 'satisfies'),
      ('reqalm', 'QZ', 'reqalm', 'CAP-READ-REQS', 'satisfies'),
      ('reqalm', 'QZ.7', 'reqalm', 'CAP-READ-REQS', 'satisfies') ON CONFLICT DO NOTHING`);
    try {
      const d = dataOf(await inject(REL("reqalm", "CAP-READ-REQS")));
      const inc = (d.incoming.satisfies ?? []).filter((l) => !("restricted" in l));
      const browse = inc.find((l) => vis(l).peer.id === "CAP-BROWSE-UI-REQS");
      assert.ok(browse);
      assert.equal(vis(browse!).peer_version_id, "CAP-BROWSE-UI-REQS.1");
      assert.equal(vis(browse!).peer.project_id, "reqalm");
      const remote = inc.find((l) => vis(l).peer.id === "CAP-BROWSE-UI-REQS" && vis(l).peer.project_id === "dedupe-p2");
      assert.ok(remote);
      assert.equal(vis(remote!).peer.project_id, "dedupe-p2");
      assert.deepEqual(
        inc.filter((l) => vis(l).peer.id === "QZ" || vis(l).peer.id === "QZ.7").map((l) => vis(l).peer.id).sort(),
        ["QZ", "QZ.7"],
      );
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_uid IN ('CAP-BROWSE-UI-REQS-dedupe-p2','QZ','QZ.7') AND to_uid = 'CAP-READ-REQS'`);
      await q(`DELETE FROM workflow_approval_records WHERE base_uid IN ('CAP-BROWSE-UI-REQS','QZ','QZ.7') AND project_id IN ('dedupe-p2','reqalm')`);
      await q(`DELETE FROM requirement_versions WHERE uid IN ('CAP-BROWSE-UI-REQS-dedupe-p2','QZ','QZ.7')`);
      await q(`DELETE FROM requirement_lines WHERE base_uid IN ('CAP-BROWSE-UI-REQS','QZ','QZ.7') AND project_id IN ('dedupe-p2','reqalm')`);
      await q(`DELETE FROM project_grants WHERE id = 'grant-casey-dedupe-p2'`);
      await q(`DELETE FROM projects WHERE id = 'dedupe-p2'`);
    }
  });

  it("private catalog stub, authz, audit", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('rel-cat-p2', 'reqalm-client', 'Rel cat P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_defs (id, is_standard, project_id) VALUES ('cat-test-private', false, 'rel-cat-p2') ON CONFLICT DO NOTHING; INSERT INTO catalog_imprints (id, catalog_id) VALUES ('imprint-live-cc-PRIVATE', 'cat-test-private') ON CONFLICT DO NOTHING; INSERT INTO catalog_item_labels (catalog_id, item_uid, title) VALUES ('cat-test-private', 'PRIV-CTL-1', 'Secret control title') ON CONFLICT DO NOTHING; INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id, trace_suspect) VALUES ('reqalm', 'CAP-READ-REQS', 'PRIV-CTL-1', 'conforms_to', 'imprint-live-cc-PRIVATE', true) ON CONFLICT DO NOTHING`);
    try {
      const raw = await inject(REL("reqalm", "CAP-READ-REQS"));
      const text = raw.payload as string;
      assert.ok(!text.includes("imprint-live-cc-PRIVATE") && !text.includes("PRIV-CTL-1") && !text.includes("Secret control title"));
      const priv = dataOf(raw).outgoing.conforms_to!.find((l) => "restricted" in l)!;
      stub(priv, "conforms_to", "outgoing");
      await q(`DELETE FROM catalog_item_labels WHERE catalog_id = 'cat-nist-global' AND item_uid = 'UNLAB-CTL-1'`);
      await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id) VALUES ('reqalm', 'CAP-READ-REQS', 'UNLAB-CTL-1', 'conforms_to', 'nist-800-53@rev5-dogfood-20261006') ON CONFLICT DO NOTHING`);
      const conforms = dataOf(await inject(REL("reqalm", "CAP-READ-REQS"))).outgoing.conforms_to ?? [];
      assert.equal(conforms.indexOf(conforms.find((l) => "restricted" in l)!), conforms.length - 1);
      assert.equal(vis(conforms.find((l) => !("restricted" in l) && (l as VisibleRelationLink).peer.id === "UNLAB-CTL-1")!).peer.title, null);
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_uid = 'CAP-READ-REQS' AND to_uid IN ('PRIV-CTL-1','UNLAB-CTL-1')`);
      await q(`DELETE FROM catalog_item_labels WHERE catalog_id = 'cat-test-private'; DELETE FROM catalog_imprints WHERE id = 'imprint-live-cc-PRIVATE'; DELETE FROM catalog_defs WHERE id = 'cat-test-private'; DELETE FROM projects WHERE id = 'rel-cat-p2'`);
    }
    await q(`INSERT INTO identities (id, display_name) VALUES ('no-grant-user', 'No Grant') ON CONFLICT DO NOTHING; INSERT INTO local_credentials (identity_id, username, password_hash, is_dev_seeded) SELECT 'no-grant-user', 'no-grant@dev.local', password_hash, true FROM local_credentials WHERE identity_id = 'casey-reader' LIMIT 1 ON CONFLICT (identity_id) DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash`);
    assert.equal((await inject(REL("reqalm", "A01"), { authorization: `Bearer ${await issueTestAccessToken(ctx.app, "no-grant@dev.local")}` })).statusCode, 404);
    const saved = (await ctx.pool.query<{ id: string; role: string }>(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm' AND revoked_at IS NULL`)).rows;
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-rel', 'reqalm', 'casey-reader', 'Key custodian')`);
    assert.equal((await inject(REL("reqalm", "A01"))).statusCode, 403);
    await q(`DELETE FROM project_grants WHERE id = 'grant-kc-rel'`);
    for (const g of saved) await ctx.pool.query(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, 'reqalm', 'casey-reader', $2) ON CONFLICT DO NOTHING`, [g.id, g.role]);
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
