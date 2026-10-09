import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestApp, issueTestAccessToken, type TestApp } from "../../test/harness.js";

let ctx: TestApp;
let bearer: Record<string, string>;
const CATS = (p: string) => `/api/v1/projects/${p}/catalogs`;
const CTRLS = (p: string, cat: string, imp: string) =>
  `/api/v1/projects/${p}/catalogs/${cat}/imprints/${imp}/controls`;
const CTRL = (p: string, cat: string, imp: string, ctl: string) => `${CTRLS(p, cat, imp)}/${ctl}`;
const q = (sql: string) => ctx.pool.query(sql);
const inject = (url: string, headers = bearer) =>
  ctx.app.inject({ method: "GET", url, remoteAddress: "203.0.113.50", headers: { host: "localhost:3000", ...headers } } as never);
const stripReqId = (b: Record<string, unknown>) => (({ request_id: _, ...r }) => r)(b);
const dataOf = (res: { statusCode: number; json: () => unknown }) => (assert.equal(res.statusCode, 200), (res.json() as { data: unknown }).data);

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
});
after(async () => ctx.close());

describe("catalogs read API", () => {
  it("lists standard + project catalogs with imprints for reqalm", async () => {
    const data = dataOf(await inject(CATS("reqalm"))) as {
      project_id: string;
      catalogs: { id: string; imprints: { id: string; version_label: string; status: string }[] }[];
    };
    assert.equal(data.project_id, "reqalm");
    const ids = data.catalogs.map((c) => c.id).sort();
    assert.deepEqual(ids, ["cat-nist-global", "cat-reqalm-security", "cat-stig-asd-v6r4"]);
    const nist = data.catalogs.find((c) => c.id === "cat-nist-global")!;
    assert.ok(nist.imprints.some((i) => i.id === "nist-800-53@rev5-dogfood-20261006" && i.status === "published"));
  });

  it("404 unknown vs invisible private catalog (identical bodies)", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('cat-own-p2', 'reqalm-client', 'Cat P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_defs (id, is_standard, project_id, title) VALUES ('cat-invisible-private', false, 'cat-own-p2', 'Hidden') ON CONFLICT DO NOTHING`);
    try {
      const unknown = await inject(CTRLS("reqalm", "no-such-catalog", "nist-800-53@rev5-dogfood-20261006"));
      const invisible = await inject(CTRLS("reqalm", "cat-invisible-private", "imprint-x"));
      assert.equal(unknown.statusCode, 404);
      assert.equal(invisible.statusCode, 404);
      assert.deepEqual(stripReqId(unknown.json() as Record<string, unknown>), stripReqId(invisible.json() as Record<string, unknown>));
      assert.equal((unknown.json() as { detail: string }).detail, "Catalog not found");
    } finally {
      await q(`DELETE FROM catalog_defs WHERE id = 'cat-invisible-private'`);
      await q(`DELETE FROM projects WHERE id = 'cat-own-p2'`);
    }
  });

  it("private catalog visible only with grant on owning project", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('cat-priv-p2', 'reqalm-client', 'Priv') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_defs (id, is_standard, project_id, title) VALUES ('cat-priv-visible', false, 'cat-priv-p2', 'Private stew') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_imprints (id, catalog_id, version_label, status) VALUES ('imprint-priv-only', 'cat-priv-visible', 'v1', 'published') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO catalog_item_labels (catalog_id, item_uid, title, family) VALUES ('cat-priv-visible', 'PRIV-ONLY-CTL', 'Private ctl', 'X') ON CONFLICT DO NOTHING`);
    try {
      assert.equal((await inject(CATS("reqalm"))).statusCode, 200);
      const noGrant = await inject(CATS("cat-priv-p2"));
      assert.equal(noGrant.statusCode, 404);
      await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-casey-cat-priv', 'cat-priv-p2', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`);
      const listed = dataOf(await inject(CATS("cat-priv-p2"))) as { catalogs: { id: string }[] };
      assert.ok(listed.catalogs.some((c) => c.id === "cat-priv-visible"));
      assert.ok(listed.catalogs.some((c) => c.id === "cat-nist-global"));
      await q(`DELETE FROM project_grants WHERE id = 'grant-casey-cat-priv'`);
    } finally {
      await q(`DELETE FROM catalog_item_labels WHERE catalog_id = 'cat-priv-visible'`);
      await q(`DELETE FROM catalog_imprints WHERE id = 'imprint-priv-only'`);
      await q(`DELETE FROM catalog_defs WHERE id = 'cat-priv-visible'`);
      await q(`DELETE FROM projects WHERE id = 'cat-priv-p2'`);
    }
  });

  it("conforming counts scoped to project (twin project)", async () => {
    const imp = "nist-800-53@rev5-dogfood-20261006";
    const ac3Before = dataOf(await inject(CTRL("reqalm", "cat-nist-global", imp, "AC-3"))) as {
      conforming_lines: unknown[];
    };
    assert.ok(ac3Before.conforming_lines.length > 0);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('cat-twin-b', 'reqalm-client', 'Twin') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-casey-cat-twin', 'cat-twin-b', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('TWIN-CAT-LINE', 'cat-twin-b', 'requirement', 't') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('TWIN-CAT-LINE', 'TWIN-CAT-LINE', 'cat-twin-b', 0, 'active', 's') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO trace_edges (from_project_id, from_uid, to_uid, kind, catalog_imprint_id) VALUES ('cat-twin-b', 'TWIN-CAT-LINE', 'AC-3', 'conforms_to', '${imp}') ON CONFLICT DO NOTHING`);
    try {
      const twin = dataOf(await inject(CTRL("cat-twin-b", "cat-nist-global", imp, "AC-3"))) as {
        conforming_lines: unknown[];
      };
      assert.equal(twin.conforming_lines.length, 1);
      const still = dataOf(await inject(CTRL("reqalm", "cat-nist-global", imp, "AC-3"))) as {
        conforming_lines: unknown[];
      };
      assert.equal(still.conforming_lines.length, ac3Before.conforming_lines.length);
    } finally {
      await q(`DELETE FROM trace_edges WHERE from_project_id = 'cat-twin-b' AND from_uid = 'TWIN-CAT-LINE'`);
      await q(`DELETE FROM requirement_versions WHERE base_uid = 'TWIN-CAT-LINE'`);
      await q(`DELETE FROM requirement_lines WHERE base_uid = 'TWIN-CAT-LINE'`);
      await q(`DELETE FROM project_grants WHERE id = 'grant-casey-cat-twin'`);
      await q(`DELETE FROM projects WHERE id = 'cat-twin-b'`);
    }
  });

  it("paging controls and control detail with conforming lines", async () => {
    const imp = "nist-800-53@rev5-dogfood-20261006";
    const page1 = dataOf(await inject(`${CTRLS("reqalm", "cat-nist-global", imp)}?limit=2&offset=0`)) as {
      items: unknown[];
      total: number;
      limit: number;
      offset: number;
    };
    assert.equal(page1.limit, 2);
    assert.equal(page1.offset, 0);
    assert.equal(page1.items.length, 2);
    assert.ok(page1.total >= 49);
    const detail = dataOf(await inject(CTRL("reqalm", "cat-nist-global", imp, "AC-3"))) as {
      id: string;
      title: string;
      family: string;
      text: string | null;
      conforming_lines: { id: string; link: { mode: string } }[];
    };
    assert.equal(detail.id, "AC-3");
    assert.equal(detail.family, "AC");
    assert.ok(detail.text && /Access Enforcement/i.test(detail.title));
    assert.ok(detail.conforming_lines.length > 0);
    assert.ok(detail.conforming_lines.every((l) => l.link.mode === "direct" || l.link.mode === "via"));
  });

  it("authz 401/403/404 and audit row", async () => {
    assert.equal((await inject(CATS("reqalm"), {})).statusCode, 401);
    await q(`INSERT INTO identities (id, display_name) VALUES ('cat-no-grant', 'No Grant') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO local_credentials (identity_id, username, password_hash, is_dev_seeded) SELECT 'cat-no-grant', 'cat-no-grant@dev.local', password_hash, true FROM local_credentials WHERE identity_id = 'casey-reader' LIMIT 1 ON CONFLICT (identity_id) DO UPDATE SET username = EXCLUDED.username`);
    assert.equal((await inject(CATS("reqalm"), { authorization: `Bearer ${await issueTestAccessToken(ctx.app, "cat-no-grant@dev.local")}` })).statusCode, 404);
    const saved = (await ctx.pool.query<{ id: string; role: string }>(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm' AND revoked_at IS NULL`)).rows;
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-cat', 'reqalm', 'casey-reader', 'Key custodian')`);
    assert.equal((await inject(CATS("reqalm"))).statusCode, 403);
    await q(`DELETE FROM project_grants WHERE id = 'grant-kc-cat'`);
    for (const g of saved) await ctx.pool.query(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, 'reqalm', 'casey-reader', $2) ON CONFLICT DO NOTHING`, [g.id, g.role]);
    const res = await inject(CATS("reqalm"), { ...bearer, "x-request-id": "cat-audit-1" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual((await ctx.pool.query(`SELECT operation, outcome, project_id, target_id FROM audit_events WHERE request_id = 'cat-audit-1' ORDER BY id DESC LIMIT 1`)).rows[0], {
      operation: "catalogs.list",
      outcome: "allow",
      project_id: "reqalm",
      target_id: null,
    });
  });
});
