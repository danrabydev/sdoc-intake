import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestApp, issueTestAccessToken, type TestApp } from "../../test/harness.js";

let ctx: TestApp;
let bearer: Record<string, string>;
const NIST = "nist-800-53@rev5-dogfood-20261006";
const STIG = "asd-stig@v6r4";
const CAT = "cat-nist-global";
const STIG_CAT = "cat-stig-asd-v6r4";
const PRIV_CAT = "cat-priv-visible";
const PRIV_IMP = "imprint-priv-only";
const CATS = (p: string) => `/api/v1/projects/${p}/catalogs`;
const CTRLS = (p: string, cat: string, imp: string) =>
  `/api/v1/projects/${p}/catalogs/${cat}/imprints/${imp}/controls`;
const CTRL = (p: string, cat: string, imp: string, ctl: string) => `${CTRLS(p, cat, imp)}/${ctl}`;
const q = (sql: string) => ctx.pool.query(sql);
const inject = (url: string, headers = bearer) =>
  ctx.app.inject({ method: "GET", url, remoteAddress: "203.0.113.50", headers: { host: "localhost:3000", ...headers } } as never);
const stripReqId = (b: Record<string, unknown>) => (({ request_id: _, ...r }) => r)(b);
const dataOf = (res: { statusCode: number; json: () => unknown }) => (assert.equal(res.statusCode, 200), (res.json() as { data: unknown }).data);
const nf = async (url: string) => stripReqId((await inject(url)).json() as Record<string, unknown>);
const audit = (rid: string) =>
  ctx.pool.query(`SELECT operation, outcome, project_id, target_id FROM audit_events WHERE request_id = $1 ORDER BY id DESC LIMIT 1`, [rid]);

type Detail = { title: string; text: string | null; conforming_lines: { id: string; title: string | null; status: string; pins: { edge_uid: string; trace_suspect: boolean }[] }[] };

async function listCount(project: string, controlId: string): Promise<number> {
  for (let offset = 0; ; offset += 100) {
    const page = dataOf(await inject(`${CTRLS(project, CAT, NIST)}?limit=100&offset=${offset}`)) as {
      items: { id: string; conforming_count: number }[];
      total: number;
    };
    const hit = page.items.find((i) => i.id === controlId);
    if (hit) return hit.conforming_count;
    if (offset >= page.total) throw new Error(`missing ${controlId}`);
  }
}
const detail = async (p: string, ctl: string) => dataOf(await inject(CTRL(p, CAT, NIST, ctl))) as Detail;

async function seedPrivateCatalog() {
  await q(`INSERT INTO projects (id, client_id, name) VALUES ('cat-priv-p2', 'reqalm-client', 'Priv') ON CONFLICT DO NOTHING; INSERT INTO catalog_defs (id, is_standard, project_id, title) VALUES ('${PRIV_CAT}', false, 'cat-priv-p2', 'Private stew') ON CONFLICT DO NOTHING; INSERT INTO catalog_imprints (id, catalog_id, version_label, status) VALUES ('${PRIV_IMP}', '${PRIV_CAT}', 'v1', 'published') ON CONFLICT DO NOTHING; INSERT INTO catalog_item_labels (catalog_id, item_uid, title, family) VALUES ('${PRIV_CAT}', 'PRIV-ONLY-CTL', 'Private ctl', 'X') ON CONFLICT DO NOTHING; INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-casey-cat-priv', 'cat-priv-p2', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`);
}
async function dropPrivateCatalog() {
  await q(`DELETE FROM project_grants WHERE id = 'grant-casey-cat-priv'; DELETE FROM catalog_item_labels WHERE catalog_id = '${PRIV_CAT}'; DELETE FROM catalog_imprints WHERE id = '${PRIV_IMP}'; DELETE FROM catalog_defs WHERE id = '${PRIV_CAT}'; DELETE FROM projects WHERE id = 'cat-priv-p2'`);
}

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
});
after(async () => ctx.close());

describe("catalogs read API", () => {
  it("list imprints; CM-3 counts, hop pins, suspect pin", async () => {
    const cats = dataOf(await inject(CATS("reqalm"))) as { project_id: string; catalogs: { id: string; imprints: { id: string; status: string }[] }[] };
    assert.equal(cats.project_id, "reqalm");
    assert.deepEqual(cats.catalogs.map((c) => c.id).sort(), ["cat-nist-global", "cat-reqalm-security", "cat-stig-asd-v6r4"]);
    assert.ok(cats.catalogs.find((c) => c.id === CAT)!.imprints.some((i) => i.id === NIST && i.status === "published"));
    const cm3 = (await detail("reqalm", "CM-3")) as Detail;
    assert.equal(cm3.conforming_lines.length, 7);
    assert.equal(await listCount("reqalm", "CM-3"), 7);
    const hop = cm3.conforming_lines.find((l) => l.id === "FIX-SUCC-2HOP")!;
    assert.deepEqual(hop.pins.map((p) => p.edge_uid).sort(), ["FIX-SUCC-2HOP", "FIX-SUCC-2HOP.1", "FIX-SUCC-2HOP.2"]);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('CAT-SUS-PIN', 'reqalm', 'requirement', 's') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('CAT-SUS-PIN.1', 'CAT-SUS-PIN', 'reqalm', 1, 'active', 's') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id, trace_suspect) VALUES ('reqalm', 'CAT-SUS-PIN.1', 'CM-3', 'conforms_to', '${NIST}', true) ON CONFLICT DO NOTHING`);
    try {
      assert.deepEqual((await detail("reqalm", "CM-3")).conforming_lines.find((l) => l.id === "CAT-SUS-PIN")!.pins, [
        { edge_uid: "CAT-SUS-PIN.1", trace_suspect: true },
      ]);
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_uid = 'CAT-SUS-PIN.1'`);
      await q(`DELETE FROM requirement_versions WHERE uid = 'CAT-SUS-PIN.1'`);
      await q(`DELETE FROM requirement_lines WHERE base_uid = 'CAT-SUS-PIN'`);
    }
  });

  it("owner-only private catalog (PRIV-ONLY-CTL): list scope + reqalm 404", async () => {
    await seedPrivateCatalog();
    const base = await nf(CTRLS("reqalm", "no-such-catalog", NIST));
    try {
      assert.ok(!(dataOf(await inject(CATS("reqalm"))) as { catalogs: { id: string }[] }).catalogs.some((c) => c.id === PRIV_CAT));
      assert.ok((dataOf(await inject(CATS("cat-priv-p2"))) as { catalogs: { id: string }[] }).catalogs.some((c) => c.id === PRIV_CAT));
      for (const url of [
        CTRLS("reqalm", PRIV_CAT, PRIV_IMP),
        CTRL("reqalm", PRIV_CAT, PRIV_IMP, "PRIV-ONLY-CTL"),
      ]) {
        assert.equal((await inject(url)).statusCode, 404);
        assert.deepEqual(await nf(url), base);
      }
    } finally {
      await dropPrivateCatalog();
    }
  });

  it("null-owner + invisible private 404 like unknown", async () => {
    await q(`INSERT INTO catalog_defs (id, is_standard, project_id, title) VALUES ('cat-null-owner', false, NULL, 'Null') ON CONFLICT DO NOTHING; INSERT INTO catalog_imprints (id, catalog_id, version_label, status) VALUES ('imprint-null-owner', 'cat-null-owner', 'v0', 'draft') ON CONFLICT DO NOTHING; INSERT INTO catalog_item_labels (catalog_id, item_uid, title) VALUES ('cat-null-owner', 'AC-3', 'x') ON CONFLICT DO NOTHING; INSERT INTO projects (id, client_id, name) VALUES ('cat-own-p2', 'reqalm-client', 'P2') ON CONFLICT DO NOTHING; INSERT INTO catalog_defs (id, is_standard, project_id, title) VALUES ('cat-invisible-private', false, 'cat-own-p2', 'H') ON CONFLICT DO NOTHING`);
    const base = await nf(CTRLS("reqalm", "no-such-catalog", NIST));
    try {
      for (const url of [
        CTRLS("reqalm", "cat-null-owner", "imprint-null-owner"),
        CTRL("reqalm", "cat-null-owner", "imprint-null-owner", "AC-3"),
        CTRLS("reqalm", "cat-invisible-private", "imprint-x"),
        CTRL("reqalm", "cat-invisible-private", "imprint-x", "AC-3"),
      ]) {
        assert.equal((await inject(url)).statusCode, 404);
        assert.deepEqual(await nf(url), base);
      }
    } finally {
      await q(`DELETE FROM catalog_item_labels WHERE catalog_id = 'cat-null-owner'; DELETE FROM catalog_imprints WHERE id = 'imprint-null-owner'; DELETE FROM catalog_defs WHERE id IN ('cat-null-owner','cat-invisible-private'); DELETE FROM projects WHERE id = 'cat-own-p2'`);
    }
  });

  it("twin + orphan: reqalm count/title stable; twin isolated; latest A01 title", async () => {
    const before = await listCount("reqalm", "AC-3");
    assert.equal((await detail("reqalm", "AC-3")).conforming_lines.find((l) => l.id === "A01")!.title, "Sign in via SSO");
    const latest = (await q(`SELECT uid, version_n::int AS n FROM requirement_versions WHERE project_id = 'reqalm' AND base_uid = 'A01' ORDER BY version_n DESC LIMIT 1`)).rows[0] as { uid: string; n: number };
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title) VALUES ('A01.cat-old', 'A01', 'reqalm', ${latest.n - 1}, 'superseded', 's', 'OLDEST-A01-TITLE') ON CONFLICT (uid) DO UPDATE SET title = EXCLUDED.title, version_n = EXCLUDED.version_n`);
    await q(`UPDATE requirement_versions SET title = 'LATEST-A01-TITLE' WHERE uid = '${latest.uid}'`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id) VALUES ('reqalm', 'ORPHAN-NO-LINE', 'AC-3', 'conforms_to', '${NIST}') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('cat-twin-b', 'reqalm-client', 'Twin') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('A01', 'cat-twin-b', 'requirement', 'TWIN-A01-TITLE') ON CONFLICT (project_id, base_uid) DO UPDATE SET title = EXCLUDED.title`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title) VALUES ('A01-twin', 'A01', 'cat-twin-b', 0, 'active', 's', 'TWIN-A01-TITLE') ON CONFLICT (uid) DO UPDATE SET title = EXCLUDED.title`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id) VALUES ('cat-twin-b', 'A01-twin', 'AC-3', 'conforms_to', '${NIST}') ON CONFLICT DO NOTHING`);
    try {
      assert.equal(await listCount("reqalm", "AC-3"), before);
      const a01 = (await detail("reqalm", "AC-3")).conforming_lines.find((l) => l.id === "A01")!;
      assert.equal(a01.title, "LATEST-A01-TITLE");
      assert.notEqual(a01.title, "OLDEST-A01-TITLE");
      assert.equal(a01.status, "active");
      await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-casey-cat-twin', 'cat-twin-b', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`);
      assert.equal((await detail("cat-twin-b", "AC-3")).conforming_lines.find((l) => l.id === "A01")!.title, "TWIN-A01-TITLE");
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_uid IN ('ORPHAN-NO-LINE','A01-twin') AND to_uid = 'AC-3'`);
      await q(`DELETE FROM requirement_versions WHERE uid IN ('A01-twin')`);
      await q(`DELETE FROM requirement_lines WHERE project_id = 'cat-twin-b' AND base_uid = 'A01'`);
      await q(`DELETE FROM project_grants WHERE id = 'grant-casey-cat-twin'`);
      await q(`DELETE FROM projects WHERE id = 'cat-twin-b'`);
      await q(`DELETE FROM requirement_versions WHERE uid = 'A01.cat-old'`);
      await q(`UPDATE requirement_versions SET title = NULL WHERE uid = '${latest.uid}'`);
    }
  });

  it("label + imprint isolation (decoy sorts first; STIG-only line)", async () => {
    const before = await listCount("reqalm", "AC-3");
    const title0 = (await detail("reqalm", "AC-3")).title;
    await q(`INSERT INTO catalog_defs (id, is_standard, project_id, title) VALUES ('aaa-cat-decoy-label', true, NULL, 'Decoy') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_item_labels (catalog_id, item_uid, title, family) VALUES ('aaa-cat-decoy-label', 'AC-3', 'WRONG AC-3 TITLE', 'AC'), ('aaa-cat-decoy-label', 'DECOY-ONLY-CTL', 'decoy only', 'AC') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('CAT-STIG-ONLY', 'reqalm', 'requirement', 'stig only') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('CAT-STIG-ONLY', 'CAT-STIG-ONLY', 'reqalm', 0, 'active', 's') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id) VALUES ('reqalm', 'CAT-STIG-ONLY', 'AC-3', 'conforms_to', '${STIG}') ON CONFLICT DO NOTHING`);
    try {
      assert.equal(await listCount("reqalm", "AC-3"), before);
      assert.equal((await detail("reqalm", "AC-3")).title, title0);
      assert.match(title0, /Access Enforcement/);
      assert.equal((await inject(CTRL("reqalm", CAT, NIST, "DECOY-ONLY-CTL"))).statusCode, 404);
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_uid = 'CAT-STIG-ONLY' AND catalog_imprint_id = '${STIG}'`);
      await q(`DELETE FROM requirement_versions WHERE uid = 'CAT-STIG-ONLY'`);
      await q(`DELETE FROM requirement_lines WHERE base_uid = 'CAT-STIG-ONLY'`);
      await q(`DELETE FROM catalog_item_labels WHERE catalog_id = 'aaa-cat-decoy-label'`);
      await q(`DELETE FROM catalog_defs WHERE id = 'aaa-cat-decoy-label'`);
    }
  });

  it("paging, STIG family, statement, imprint/control 404, full audits", async () => {
    assert.equal((dataOf(await inject(`${CTRLS("reqalm", CAT, NIST)}?limit=5`)) as { total: number }).total, 52);
    assert.match((await detail("reqalm", "AC-3")).text ?? "", /Enforce approved authorizations/);
    const stig = dataOf(await inject(`${CTRLS("reqalm", STIG_CAT, STIG)}?limit=100`)) as { items: { id: string; family: string }[] };
    const allowed = new Set((await q(`SELECT item_uid FROM catalog_item_labels WHERE catalog_id = '${STIG_CAT}'`)).rows.map((r) => r.item_uid as string));
    assert.ok(allowed.size > 0);
    for (const { id } of stig.items) assert.ok(allowed.has(id), id);
    const v = stig.items.find((i) => i.id.startsWith("V-"))!;
    assert.equal(v.family, "STIG");
    assert.equal((await inject(CTRLS("reqalm", CAT, "no-such-imprint"))).statusCode, 404);
    assert.equal((await inject(CTRLS("reqalm", CAT, STIG))).statusCode, 404);
    assert.equal((await inject(CTRL("reqalm", CAT, STIG, "AC-3"))).statusCode, 404);
    assert.equal((await inject(CTRL("reqalm", CAT, NIST, "NO-SUCH-CONTROL"))).statusCode, 404);
    const p0 = dataOf(await inject(`${CTRLS("reqalm", CAT, NIST)}?limit=2&offset=0`)) as { items: { id: string }[] };
    const p1 = dataOf(await inject(`${CTRLS("reqalm", CAT, NIST)}?limit=2&offset=2`)) as { items: { id: string }[] };
    assert.equal(p0.items.length, 2);
    assert.notDeepEqual(p0.items.map((i) => i.id), p1.items.map((i) => i.id));
    await inject(CTRLS("reqalm", CAT, NIST), { ...bearer, "x-request-id": "cat-audit-ctrls" });
    await inject(CTRL("reqalm", CAT, NIST, "AC-3"), { ...bearer, "x-request-id": "cat-audit-detail" });
    assert.deepEqual((await audit("cat-audit-ctrls")).rows[0], {
      operation: "catalogs.list_controls",
      outcome: "allow",
      project_id: "reqalm",
      target_id: NIST,
    });
    assert.deepEqual((await audit("cat-audit-detail")).rows[0], {
      operation: "catalogs.get_control",
      outcome: "allow",
      project_id: "reqalm",
      target_id: "AC-3",
    });
    const imp161 = `a${"b".repeat(160)}`;
    for (const url of [
      CTRLS("reqalm", "Not_A_Slug", NIST),
      CTRLS("reqalm", CAT, "bad imprint"),
      CTRLS("reqalm", CAT, STIG.toUpperCase()),
      CTRLS("reqalm", CAT, imp161),
      CTRL("reqalm", CAT, NIST, "!!bad!!"),
    ]) assert.equal((await inject(url)).statusCode, 400, url);
  });

  it("authz 401/403/404; key custodian blocked on catalog + controls", async () => {
    assert.equal((await inject(CATS("reqalm"), {})).statusCode, 401);
    await q(`INSERT INTO identities (id, display_name) VALUES ('cat-no-grant', 'No Grant') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO local_credentials (identity_id, username, password_hash, is_dev_seeded) SELECT 'cat-no-grant', 'cat-no-grant@dev.local', password_hash, true FROM local_credentials WHERE identity_id = 'casey-reader' LIMIT 1 ON CONFLICT (identity_id) DO UPDATE SET username = EXCLUDED.username`);
    assert.equal((await inject(CATS("reqalm"), { authorization: `Bearer ${await issueTestAccessToken(ctx.app, "cat-no-grant@dev.local")}` })).statusCode, 404);
    const saved = (await ctx.pool.query<{ id: string; role: string }>(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm' AND revoked_at IS NULL`)).rows;
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-cat', 'reqalm', 'casey-reader', 'Key custodian')`);
    for (const url of [CATS("reqalm"), CTRLS("reqalm", CAT, NIST), CTRL("reqalm", CAT, NIST, "AC-3")]) assert.equal((await inject(url)).statusCode, 403);
    await q(`DELETE FROM project_grants WHERE id = 'grant-kc-cat'`);
    for (const g of saved) await ctx.pool.query(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, 'reqalm', 'casey-reader', $2) ON CONFLICT DO NOTHING`, [g.id, g.role]);
  });
});
