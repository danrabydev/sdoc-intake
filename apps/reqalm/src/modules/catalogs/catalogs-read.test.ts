import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestApp, issueTestAccessToken, type TestApp } from "../../test/harness.js";

let ctx: TestApp;
let bearer: Record<string, string>;
const NIST = "nist-800-53@rev5-dogfood-20261006";
const CAT = "cat-nist-global";
const CATS = (p: string) => `/api/v1/projects/${p}/catalogs`;
const CTRLS = (p: string, cat: string, imp: string) =>
  `/api/v1/projects/${p}/catalogs/${cat}/imprints/${imp}/controls`;
const CTRL = (p: string, cat: string, imp: string, ctl: string) => `${CTRLS(p, cat, imp)}/${ctl}`;
const q = (sql: string) => ctx.pool.query(sql);
const inject = (url: string, headers = bearer) =>
  ctx.app.inject({ method: "GET", url, remoteAddress: "203.0.113.50", headers: { host: "localhost:3000", ...headers } } as never);
const stripReqId = (b: Record<string, unknown>) => (({ request_id: _, ...r }) => r)(b);
const dataOf = (res: { statusCode: number; json: () => unknown }) => (assert.equal(res.statusCode, 200), (res.json() as { data: unknown }).data);

async function listCount(project: string, controlId: string): Promise<number> {
  let offset = 0;
  for (;;) {
    const page = dataOf(await inject(`${CTRLS(project, CAT, NIST)}?limit=100&offset=${offset}`)) as {
      items: { id: string; conforming_count: number }[];
      total: number;
    };
    const hit = page.items.find((i) => i.id === controlId);
    if (hit) return hit.conforming_count;
    offset += 100;
    if (offset >= page.total) throw new Error(`control ${controlId} not in catalog list`);
  }
}

async function controlDetail(project: string, controlId: string) {
  return dataOf(await inject(CTRL(project, CAT, NIST, controlId))) as {
    conforming_lines: { id: string; title: string | null; pins: { edge_uid: string; version_id: string; trace_suspect: boolean }[] }[];
  };
}

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
});
after(async () => ctx.close());

describe("catalogs read API", () => {
  it("lists standard + project catalogs with imprints for reqalm", async () => {
    const data = dataOf(await inject(CATS("reqalm"))) as {
      project_id: string;
      catalogs: { id: string; imprints: { id: string; status: string }[] }[];
    };
    assert.equal(data.project_id, "reqalm");
    assert.deepEqual(
      data.catalogs.map((c) => c.id).sort(),
      ["cat-nist-global", "cat-reqalm-security", "cat-stig-asd-v6r4"],
    );
    assert.ok(data.catalogs.find((c) => c.id === CAT)!.imprints.some((i) => i.id === NIST && i.status === "published"));
  });

  it("CM-3 list count matches distinct resolved lines in detail (7)", async () => {
    const detail = await controlDetail("reqalm", "CM-3");
    assert.equal(detail.conforming_lines.length, 7);
    assert.equal(await listCount("reqalm", "CM-3"), 7);
    const hop = detail.conforming_lines.find((l) => l.id === "FIX-SUCC-2HOP")!;
    assert.equal(hop.pins.length, 3);
    assert.deepEqual(
      hop.pins.map((p) => p.version_id).sort(),
      ["FIX-SUCC-2HOP", "FIX-SUCC-2HOP.1", "FIX-SUCC-2HOP.2"],
    );
    assert.ok(hop.pins.some((p) => p.version_id === "FIX-SUCC-2HOP.2" && p.trace_suspect === false));
  });

  it("404 unknown vs invisible private catalog on list, controls, and detail (real control id)", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('cat-own-p2', 'reqalm-client', 'Cat P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_defs (id, is_standard, project_id, title) VALUES ('cat-invisible-private', false, 'cat-own-p2', 'Hidden') ON CONFLICT DO NOTHING`);
    try {
      for (const url of [
        CTRLS("reqalm", "no-such-catalog", NIST),
        CTRLS("reqalm", "cat-invisible-private", "imprint-x"),
        CTRL("reqalm", "cat-invisible-private", "imprint-x", "AC-3"),
        CTRL("reqalm", "no-such-catalog", NIST, "AC-3"),
      ]) {
        const a = await inject(url);
        const b = await inject(CTRLS("reqalm", "no-such-catalog", NIST));
        assert.equal(a.statusCode, 404);
        assert.deepEqual(stripReqId(a.json() as Record<string, unknown>), stripReqId(b.json() as Record<string, unknown>));
      }
    } finally {
      await q(`DELETE FROM catalog_defs WHERE id = 'cat-invisible-private'`);
      await q(`DELETE FROM projects WHERE id = 'cat-own-p2'`);
    }
  });

  it("private catalog only when route project is owner (grant on owner alone is insufficient)", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('cat-priv-p2', 'reqalm-client', 'Priv') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_defs (id, is_standard, project_id, title) VALUES ('cat-priv-visible', false, 'cat-priv-p2', 'Private stew') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_imprints (id, catalog_id, version_label, status) VALUES ('imprint-priv-only', 'cat-priv-visible', 'v1', 'published') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_item_labels (catalog_id, item_uid, title, family) VALUES ('cat-priv-visible', 'PRIV-ONLY-CTL', 'Private ctl', 'X') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-casey-cat-priv', 'cat-priv-p2', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`);
    try {
      assert.equal((await inject(CTRL("reqalm", "cat-priv-visible", "imprint-priv-only", "PRIV-ONLY-CTL"))).statusCode, 404);
      assert.ok(
        (dataOf(await inject(CATS("cat-priv-p2"))) as { catalogs: { id: string }[] }).catalogs.some((c) => c.id === "cat-priv-visible"),
      );
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-casey-cat-priv'`);
      await q(`DELETE FROM catalog_item_labels WHERE catalog_id = 'cat-priv-visible'`);
      await q(`DELETE FROM catalog_imprints WHERE id = 'imprint-priv-only'`);
      await q(`DELETE FROM catalog_defs WHERE id = 'cat-priv-visible'`);
      await q(`DELETE FROM projects WHERE id = 'cat-priv-p2'`);
    }
  });

  it("conforming_count ignores orphan edges and twin-project lines (A01 title scoped)", async () => {
    const before = await listCount("reqalm", "AC-3");
    const reqalmA01 = (await controlDetail("reqalm", "AC-3")).conforming_lines.find((l) => l.id === "A01")!;
    assert.equal(reqalmA01.title, "Sign in via SSO");
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id) VALUES ('reqalm', 'ORPHAN-NO-LINE', 'AC-3', 'conforms_to', '${NIST}') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('cat-twin-b', 'reqalm-client', 'Twin') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('A01', 'cat-twin-b', 'requirement', 'TWIN-A01-TITLE') ON CONFLICT (project_id, base_uid) DO UPDATE SET title = EXCLUDED.title`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title) VALUES ('A01-twin', 'A01', 'cat-twin-b', 0, 'active', 's', 'TWIN-A01-TITLE') ON CONFLICT (uid) DO UPDATE SET title = EXCLUDED.title`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id) VALUES ('cat-twin-b', 'A01-twin', 'AC-3', 'conforms_to', '${NIST}') ON CONFLICT DO NOTHING`);
    try {
      assert.equal(await listCount("reqalm", "AC-3"), before);
      assert.equal((await controlDetail("reqalm", "AC-3")).conforming_lines.find((l) => l.id === "A01")!.title, "Sign in via SSO");
      await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-casey-cat-twin', 'cat-twin-b', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`);
      assert.equal((await controlDetail("cat-twin-b", "AC-3")).conforming_lines.find((l) => l.id === "A01")!.title, "TWIN-A01-TITLE");
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_uid IN ('ORPHAN-NO-LINE','A01-twin') AND to_uid = 'AC-3'`);
      await q(`DELETE FROM requirement_versions WHERE uid = 'A01-twin'`);
      await q(`DELETE FROM requirement_lines WHERE project_id = 'cat-twin-b' AND base_uid = 'A01'`);
      await q(`DELETE FROM project_grants WHERE id = 'grant-casey-cat-twin'`);
      await q(`DELETE FROM projects WHERE id = 'cat-twin-b'`);
    }
  });

  it("imprint mismatch and unknown control/imprint 404; paging offset > 0", async () => {
    assert.equal((await inject(CTRLS("reqalm", CAT, "asd-stig@v6r4"))).statusCode, 404);
    assert.equal((await inject(CTRLS("reqalm", CAT, "no-such-imprint"))).statusCode, 404);
    assert.equal((await inject(CTRL("reqalm", CAT, NIST, "NO-SUCH-CONTROL"))).statusCode, 404);
    const p0 = dataOf(await inject(`${CTRLS("reqalm", CAT, NIST)}?limit=2&offset=0`)) as { items: { id: string }[] };
    const p1 = dataOf(await inject(`${CTRLS("reqalm", CAT, NIST)}?limit=2&offset=2`)) as { items: { id: string }[] };
    assert.equal(p0.items.length, 2);
    assert.equal(p1.items.length, 2);
    assert.notDeepEqual(p0.items.map((i) => i.id), p1.items.map((i) => i.id));
  });

  it("authz 401/403/404, key custodian blocked on controls, audits on list_controls and get_control", async () => {
    assert.equal((await inject(CATS("reqalm"), {})).statusCode, 401);
    await q(`INSERT INTO identities (id, display_name) VALUES ('cat-no-grant', 'No Grant') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO local_credentials (identity_id, username, password_hash, is_dev_seeded) SELECT 'cat-no-grant', 'cat-no-grant@dev.local', password_hash, true FROM local_credentials WHERE identity_id = 'casey-reader' LIMIT 1 ON CONFLICT (identity_id) DO UPDATE SET username = EXCLUDED.username`);
    assert.equal((await inject(CATS("reqalm"), { authorization: `Bearer ${await issueTestAccessToken(ctx.app, "cat-no-grant@dev.local")}` })).statusCode, 404);
    const saved = (await ctx.pool.query<{ id: string; role: string }>(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm' AND revoked_at IS NULL`)).rows;
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-cat', 'reqalm', 'casey-reader', 'Key custodian')`);
    assert.equal((await inject(CATS("reqalm"))).statusCode, 403);
    assert.equal((await inject(CTRLS("reqalm", CAT, NIST))).statusCode, 403);
    assert.equal((await inject(CTRL("reqalm", CAT, NIST, "AC-3"))).statusCode, 403);
    await q(`DELETE FROM project_grants WHERE id = 'grant-kc-cat'`);
    for (const g of saved) await ctx.pool.query(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, 'reqalm', 'casey-reader', $2) ON CONFLICT DO NOTHING`, [g.id, g.role]);
    await inject(CATS("reqalm"), { ...bearer, "x-request-id": "cat-audit-list" });
    await inject(CTRLS("reqalm", CAT, NIST), { ...bearer, "x-request-id": "cat-audit-ctrls" });
    await inject(CTRL("reqalm", CAT, NIST, "AC-3"), { ...bearer, "x-request-id": "cat-audit-detail" });
    assert.deepEqual((await ctx.pool.query(`SELECT operation, outcome, project_id, target_id FROM audit_events WHERE request_id = 'cat-audit-ctrls' ORDER BY id DESC LIMIT 1`)).rows[0], {
      operation: "catalogs.list_controls",
      outcome: "allow",
      project_id: "reqalm",
      target_id: NIST,
    });
    assert.deepEqual((await ctx.pool.query(`SELECT operation, outcome, project_id, target_id FROM audit_events WHERE request_id = 'cat-audit-detail' ORDER BY id DESC LIMIT 1`)).rows[0], {
      operation: "catalogs.get_control",
      outcome: "allow",
      project_id: "reqalm",
      target_id: "AC-3",
    });
  });
});
