import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestApp, issueTestAccessToken, type TestApp } from "../../test/harness.js";

let ctx: TestApp;
let bearer: Record<string, string>;
const NIST = "nist-800-53@rev5-dogfood-20261006";
const STIG = "asd-stig@v6r4";
const CAT = "cat-nist-global";
const STIG_CAT = "cat-stig-asd-v6r4";
const CATS = (p: string) => `/api/v1/projects/${p}/catalogs`;
const CTRLS = (p: string, cat: string, imp: string) =>
  `/api/v1/projects/${p}/catalogs/${cat}/imprints/${imp}/controls`;
const CTRL = (p: string, cat: string, imp: string, ctl: string) => `${CTRLS(p, cat, imp)}/${ctl}`;
const q = (sql: string) => ctx.pool.query(sql);
const inject = (url: string, headers = bearer) =>
  ctx.app.inject({ method: "GET", url, remoteAddress: "203.0.113.50", headers: { host: "localhost:3000", ...headers } } as never);
const stripReqId = (b: Record<string, unknown>) => (({ request_id: _, ...r }) => r)(b);
const dataOf = (res: { statusCode: number; json: () => unknown }) => (assert.equal(res.statusCode, 200), (res.json() as { data: unknown }).data);
const notFoundBody = async (url: string) => stripReqId((await inject(url)).json() as Record<string, unknown>);

type Pin = { edge_uid: string; trace_suspect: boolean };
type Detail = {
  title: string;
  text: string | null;
  family?: string;
  conforming_lines: { id: string; title: string | null; status: string; pins: Pin[] }[];
};

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

async function controlDetail(project: string, controlId: string): Promise<Detail> {
  return dataOf(await inject(CTRL(project, CAT, NIST, controlId))) as Detail;
}

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
});
after(async () => ctx.close());

describe("catalogs read API", () => {
  it("lists standard + project catalogs with imprints for reqalm", async () => {
    const data = dataOf(await inject(CATS("reqalm"))) as { catalogs: { id: string; imprints: { id: string; status: string }[] }[] };
    assert.deepEqual(
      data.catalogs.map((c) => c.id).sort(),
      ["cat-nist-global", "cat-reqalm-security", "cat-stig-asd-v6r4"],
    );
    assert.ok(data.catalogs.find((c) => c.id === CAT)!.imprints.some((i) => i.id === NIST && i.status === "published"));
  });

  it("CM-3 count matches detail lines; suspect pin object exact", async () => {
    const detail0 = await controlDetail("reqalm", "CM-3");
    assert.equal(detail0.conforming_lines.length, 7);
    assert.equal(await listCount("reqalm", "CM-3"), 7);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('CAT-SUS-PIN', 'reqalm', 'requirement', 'sus pin') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('CAT-SUS-PIN.1', 'CAT-SUS-PIN', 'reqalm', 1, 'active', 's') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id, trace_suspect) VALUES ('reqalm', 'CAT-SUS-PIN.1', 'CM-3', 'conforms_to', '${NIST}', true) ON CONFLICT DO NOTHING`);
    try {
      const sus = (await controlDetail("reqalm", "CM-3")).conforming_lines.find((l) => l.id === "CAT-SUS-PIN")!;
      assert.deepEqual(sus.pins, [{ edge_uid: "CAT-SUS-PIN.1", trace_suspect: true }]);
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_uid = 'CAT-SUS-PIN.1' AND to_uid = 'CM-3'`);
      await q(`DELETE FROM requirement_versions WHERE uid = 'CAT-SUS-PIN.1'`);
      await q(`DELETE FROM requirement_lines WHERE base_uid = 'CAT-SUS-PIN'`);
    }
  });

  it("null-owner private catalog absent from list; controls/detail 404 like unknown", async () => {
    await q(`INSERT INTO catalog_defs (id, is_standard, project_id, title) VALUES ('cat-null-owner', false, NULL, 'Null owner') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_imprints (id, catalog_id, version_label, status) VALUES ('imprint-null-owner', 'cat-null-owner', 'v0', 'draft') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_item_labels (catalog_id, item_uid, title, family) VALUES ('cat-null-owner', 'AC-3', 'Decoy AC-3', 'AC') ON CONFLICT DO NOTHING`);
    const baseline = await notFoundBody(CTRLS("reqalm", "no-such-catalog", NIST));
    try {
      assert.ok(!(dataOf(await inject(CATS("reqalm"))) as { catalogs: { id: string }[] }).catalogs.some((c) => c.id === "cat-null-owner"));
      for (const url of [
        CTRLS("reqalm", "cat-null-owner", "imprint-null-owner"),
        CTRL("reqalm", "cat-null-owner", "imprint-null-owner", "AC-3"),
      ]) {
        assert.equal((await inject(url)).statusCode, 404);
        assert.deepEqual(await notFoundBody(url), baseline);
      }
    } finally {
      await q(`DELETE FROM catalog_item_labels WHERE catalog_id = 'cat-null-owner'`);
      await q(`DELETE FROM catalog_imprints WHERE id = 'imprint-null-owner'`);
      await q(`DELETE FROM catalog_defs WHERE id = 'cat-null-owner'`);
    }
  });

  it("404 unknown vs invisible private catalog (owned project)", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('cat-own-p2', 'reqalm-client', 'Cat P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_defs (id, is_standard, project_id, title) VALUES ('cat-invisible-private', false, 'cat-own-p2', 'Hidden') ON CONFLICT DO NOTHING`);
    const baseline = await notFoundBody(CTRLS("reqalm", "no-such-catalog", NIST));
    try {
      for (const url of [CTRLS("reqalm", "cat-invisible-private", "imprint-x"), CTRL("reqalm", "cat-invisible-private", "imprint-x", "AC-3")]) {
        assert.equal((await inject(url)).statusCode, 404);
        assert.deepEqual(await notFoundBody(url), baseline);
      }
    } finally {
      await q(`DELETE FROM catalog_defs WHERE id = 'cat-invisible-private'`);
      await q(`DELETE FROM projects WHERE id = 'cat-own-p2'`);
    }
  });

  it("private catalog only on owning route project", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('cat-priv-p2', 'reqalm-client', 'Priv') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_defs (id, is_standard, project_id, title) VALUES ('cat-priv-visible', false, 'cat-priv-p2', 'Private stew') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_imprints (id, catalog_id, version_label, status) VALUES ('imprint-priv-only', 'cat-priv-visible', 'v1', 'published') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-casey-cat-priv', 'cat-priv-p2', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`);
    try {
      assert.equal((await inject(CTRL("reqalm", "cat-priv-visible", "imprint-priv-only", "PRIV-ONLY-CTL"))).statusCode, 404);
      assert.ok((dataOf(await inject(CATS("cat-priv-p2"))) as { catalogs: { id: string }[] }).catalogs.some((c) => c.id === "cat-priv-visible"));
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-casey-cat-priv'`);
      await q(`DELETE FROM catalog_imprints WHERE id = 'imprint-priv-only'`);
      await q(`DELETE FROM catalog_defs WHERE id = 'cat-priv-visible'`);
      await q(`DELETE FROM projects WHERE id = 'cat-priv-p2'`);
    }
  });

  it("label and imprint isolation for NIST AC-3", async () => {
    const before = await listCount("reqalm", "AC-3");
    const titleBefore = (await controlDetail("reqalm", "AC-3")).title;
    await q(`INSERT INTO catalog_defs (id, is_standard, project_id, title) VALUES ('cat-decoy-label', true, NULL, 'Decoy') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_item_labels (catalog_id, item_uid, title, family) VALUES ('cat-decoy-label', 'AC-3', 'WRONG AC-3 TITLE', 'AC') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id) VALUES ('reqalm', 'A01', 'AC-3', 'conforms_to', '${STIG}') ON CONFLICT DO NOTHING`);
    try {
      assert.equal(await listCount("reqalm", "AC-3"), before);
      assert.equal((await controlDetail("reqalm", "AC-3")).title, titleBefore);
      assert.match(titleBefore, /Access Enforcement/);
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_project_id = 'reqalm' AND from_uid = 'A01' AND catalog_imprint_id = '${STIG}' AND to_uid = 'AC-3'`);
      await q(`DELETE FROM catalog_item_labels WHERE catalog_id = 'cat-decoy-label'`);
      await q(`DELETE FROM catalog_defs WHERE id = 'cat-decoy-label'`);
    }
  });

  it("conforming_count ignores orphan/twin edges; latest version title + status on lines", async () => {
    const before = await listCount("reqalm", "AC-3");
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id) VALUES ('reqalm', 'ORPHAN-NO-LINE', 'AC-3', 'conforms_to', '${NIST}') ON CONFLICT DO NOTHING`);
    const a01Ver = (
      await q(`SELECT uid FROM requirement_versions WHERE project_id = 'reqalm' AND base_uid = 'A01' ORDER BY version_n DESC LIMIT 1`)
    ).rows[0]!.uid as string;
    await q(`UPDATE requirement_versions SET title = 'LATEST-A01-TITLE' WHERE uid = '${a01Ver}'`);
    try {
      assert.equal(await listCount("reqalm", "AC-3"), before);
      const a01 = (await controlDetail("reqalm", "AC-3")).conforming_lines.find((l) => l.id === "A01")!;
      assert.equal(a01.status, "active");
      assert.equal(a01.title, "LATEST-A01-TITLE");
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_uid = 'ORPHAN-NO-LINE' AND to_uid = 'AC-3'`);
      await q(`UPDATE requirement_versions SET title = NULL WHERE uid = '${a01Ver}'`);
    }
  });

  it("NIST paging total 49, AC-3 statement, STIG family, imprint/control 404s, audits", async () => {
    const page = dataOf(await inject(`${CTRLS("reqalm", CAT, NIST)}?limit=5&offset=0`)) as { total: number };
    assert.equal(page.total, 49);
    const ac3 = await controlDetail("reqalm", "AC-3");
    assert.match(ac3.text ?? "", /Enforce approved authorizations/);
    const stig = dataOf(await inject(`${CTRLS("reqalm", STIG_CAT, STIG)}?limit=100`)) as {
      items: { id: string; family: string }[];
    };
    const v = stig.items.find((i) => i.id.startsWith("V-"))!;
    assert.equal(v.family, "STIG");
    assert.equal((await inject(CTRLS("reqalm", CAT, STIG))).statusCode, 404);
    assert.equal((await inject(CTRL("reqalm", CAT, NIST, "NO-SUCH-CONTROL"))).statusCode, 404);
    const p1 = dataOf(await inject(`${CTRLS("reqalm", CAT, NIST)}?limit=2&offset=2`)) as { items: { id: string }[] };
    assert.equal(p1.items.length, 2);
    await inject(CTRLS("reqalm", CAT, NIST), { ...bearer, "x-request-id": "cat-audit-ctrls" });
    await inject(CTRL("reqalm", CAT, NIST, "AC-3"), { ...bearer, "x-request-id": "cat-audit-detail" });
    assert.deepEqual((await ctx.pool.query(`SELECT operation FROM audit_events WHERE request_id = 'cat-audit-ctrls' ORDER BY id DESC LIMIT 1`)).rows[0], {
      operation: "catalogs.list_controls",
    });
    assert.deepEqual((await ctx.pool.query(`SELECT operation FROM audit_events WHERE request_id = 'cat-audit-detail' ORDER BY id DESC LIMIT 1`)).rows[0], {
      operation: "catalogs.get_control",
    });
  });

  it("authz 401/403/404 and key custodian blocked on catalog + controls", async () => {
    assert.equal((await inject(CATS("reqalm"), {})).statusCode, 401);
    await q(`INSERT INTO identities (id, display_name) VALUES ('cat-no-grant', 'No Grant') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO local_credentials (identity_id, username, password_hash, is_dev_seeded) SELECT 'cat-no-grant', 'cat-no-grant@dev.local', password_hash, true FROM local_credentials WHERE identity_id = 'casey-reader' LIMIT 1 ON CONFLICT (identity_id) DO UPDATE SET username = EXCLUDED.username`);
    assert.equal((await inject(CATS("reqalm"), { authorization: `Bearer ${await issueTestAccessToken(ctx.app, "cat-no-grant@dev.local")}` })).statusCode, 404);
    const saved = (await ctx.pool.query<{ id: string; role: string }>(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm' AND revoked_at IS NULL`)).rows;
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-cat', 'reqalm', 'casey-reader', 'Key custodian')`);
    for (const url of [CATS("reqalm"), CTRLS("reqalm", CAT, NIST), CTRL("reqalm", CAT, NIST, "AC-3")]) {
      assert.equal((await inject(url)).statusCode, 403);
    }
    await q(`DELETE FROM project_grants WHERE id = 'grant-kc-cat'`);
    for (const g of saved) await ctx.pool.query(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, 'reqalm', 'casey-reader', $2) ON CONFLICT DO NOTHING`, [g.id, g.role]);
  });
});
