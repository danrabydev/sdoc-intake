import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { createTestApp, issueTestAccessToken, type TestApp } from "../../test/harness.js";
import { finishedSpans, resetTelemetrySpans } from "../../test/otel-testing.js";
import { listRoutesForSecurityAudit } from "../../http/route-security.js";
import { stableCapabilityArtifactId } from "./artifacts.service.js";

let ctx: TestApp | undefined;
let bearer: Record<string, string>;
const arts = (p: string, v: string) => `/api/v1/projects/${p}/requirement-versions/${v}/artifacts`;
const atts = (p: string, v: string) => `/api/v1/projects/${p}/requirement-versions/${v}/attachments`;
const inject = (url: string, headers = bearer) =>
  ctx!.app.inject({ method: "GET", url, remoteAddress: "203.0.113.50", headers: { host: "localhost:3000", ...headers } } as never);
const dataOf = (res: { statusCode: number; json: () => unknown }) => (assert.equal(res.statusCode, 200), (res.json() as { data: unknown }).data);
type InjectResponse = Awaited<ReturnType<typeof inject>>;
const hdrs = (res: InjectResponse) => {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    if (k === "date" || k === "request-id" || v === undefined) continue;
    out[k] = Array.isArray(v) ? v.map(String) : String(v);
  }
  return out;
};
const BLOB = `blob_${"e".repeat(64)}`;
async function insertAtt(attId: string, attvId: string, parentUid: string, projectId = "reqalm", deletedAt?: string) {
  const q = (sql: string, p?: unknown[]) => ctx!.pool.query(sql, p);
  await q(
    `INSERT INTO attachment_blobs (id, sha256, size_bytes, media_type, storage_key) VALUES ($1, $2, 1, 'text/plain', 't') ON CONFLICT DO NOTHING`,
    [BLOB, "e".repeat(64)],
  );
  await q(
    `INSERT INTO file_attachments (id, client_id, project_id, parent_kind, parent_uid, display_name, deleted_at)
     VALUES ($1, 'raby-family', $2, 'requirement_version', $3, 'n', $4::timestamptz)`,
    [attId, projectId, parentUid, deletedAt ?? null],
  );
  await q(
    `INSERT INTO file_attachment_versions (id, attachment_id, version_n, blob_id, scan_state, uploaded_by) VALUES ($1, $2, 1, $3, 'clean', 't')`,
    [attvId, attId, BLOB],
  );
}

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
  await insertAtt("att_a1b2c3d4e5f6g7h8i9j0k1l2m3", "attv_c3d4e5f6g7h8i9j0k1l2m3n4o5", "CAP-ATTACH-READ");
  await insertAtt("att_z9y8x7w6v5u4t3s2r1q0p9o8n7m6", "attv_y8x7w6v5u4t3s2r1q0p9o8n7m6l5", "CAP-ATTACH-READ");
});
after(async () => {
  await ctx?.close();
});

describe("artifacts route registration", () => {
  it("pins projectScoped attachment:read on list routes", () => {
    const routes = [
      ...new Map(
        listRoutesForSecurityAudit(ctx!.app)
          .filter((r) => /\/requirement-versions\/:versionUid\/(artifacts|attachments)$/.test(r.url))
          .map((r) => [r.url, r] as const),
      ).values(),
    ];
    assert.equal(routes.length, 2);
    for (const r of routes) {
      assert.equal(r.operationRef?.permission, "attachment:read", r.url);
      assert.equal(r.operationRef?.projectScoped, true, r.url);
    }
    const dir = path.dirname(fileURLToPath(import.meta.url));
    assert.match(readFileSync(path.join(dir, "artifacts.service.ts"), "utf8"), /project_id = \$1/);
    const routesSrc = readFileSync(path.join(dir, "routes.ts"), "utf8");
    assert.match(routesSrc, /permission: "attachment:read"/);
    assert.match(routesSrc, /validatePathProjectId: true/);
  });
});

describe("artifacts read API", () => {
  it("lists artifacts and attachments with paging, sort, and redaction", async () => {
    const art = dataOf(await inject(`${arts("reqalm", "CAP-SSO")}?limit=10`)) as {
      items: { position: number; id: string }[];
      total: number;
    };
    assert.equal(art.total, 2);
    assert.deepEqual(art.items.map((i) => i.position), [0, 1]);
    assert.equal(art.items[0]!.id, stableCapabilityArtifactId("CAP-SSO", 0));
    assert.ok(!JSON.stringify(art).includes("storage_key"));
    assert.equal((await inject(`${arts("reqalm", "CAP-SSO")}?limit=101`)).statusCode, 400);
    assert.equal((dataOf(await inject(`${arts("reqalm", "CAP-SSO")}?limit=1&offset=99`)) as { items: unknown[] }).items.length, 0);

    const att = dataOf(await inject(`${atts("reqalm", "CAP-ATTACH-READ")}?limit=10`)) as {
      items: { id: string }[];
      total: number;
    };
    assert.equal(att.total, 2);
    assert.deepEqual(att.items.map((i) => i.id), ["att_a1b2c3d4e5f6g7h8i9j0k1l2m3", "att_z9y8x7w6v5u4t3s2r1q0p9o8n7m6"]);
    assert.equal((await inject(`${atts("reqalm", "CAP-ATTACH-READ")}?limit=101`)).statusCode, 400);
    assert.equal((dataOf(await inject(`${atts("reqalm", "CAP-ATTACH-READ")}?limit=1&offset=1`)) as { items: { id: string }[] }).items[0]!.id, "att_z9y8x7w6v5u4t3s2r1q0p9o8n7m6");
    assert.equal((dataOf(await inject(`${atts("reqalm", "CAP-ATTACH-READ")}?limit=1&offset=99`)) as { items: unknown[] }).items.length, 0);
  });

  it("hides soft-deleted attachments and unknown parent versions", async () => {
    assert.equal((await inject(atts("reqalm", "CAP-NO-SUCH-VER"))).statusCode, 404);
    await insertAtt("att_m3n4o5p6q7r8s9t0u1v2w3x4y5", "attv_n4o5p6q7r8s9t0u1v2w3x4y5z6", "CAP-ATTACH-READ", "reqalm", "2020-01-01T00:00:00.000Z");
    assert.equal((dataOf(await inject(atts("reqalm", "CAP-ATTACH-READ"))) as { total: number }).total, 2);
  });

  it("cross-project version uid and project filter return 404", async () => {
    const q = (sql: string) => ctx!.pool.query(sql);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('ctr-p2', 'raby-family', 'P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('XPROJ-ATT', 'ctr-p2', 'capability', 'X')`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('XPROJ-ATT', 'XPROJ-ATT', 'ctr-p2', 0, 'draft', 'x')`);
    await insertAtt("att_o5p6q7r8s9t0u1v2w3x4y5z6a7", "attv_p6q7r8s9t0u1v2w3x4y5z6a7b8", "XPROJ-ATT", "ctr-p2");
    try {
      assert.equal((await inject(arts("reqalm", "XPROJ-ATT"))).statusCode, 404);
      assert.equal((await inject(atts("reqalm", "XPROJ-ATT"))).statusCode, 404);
    } finally {
      await q(`DELETE FROM file_attachment_versions WHERE attachment_id = 'att_o5p6q7r8s9t0u1v2w3x4y5z6a7'`);
      await q(`DELETE FROM file_attachments WHERE id = 'att_o5p6q7r8s9t0u1v2w3x4y5z6a7'`);
      await q(`DELETE FROM requirement_versions WHERE uid = 'XPROJ-ATT'`);
      await q(`DELETE FROM requirement_lines WHERE base_uid = 'XPROJ-ATT'`);
      await q(`DELETE FROM projects WHERE id = 'ctr-p2'`);
    }
  });

  it("malformed ids: 400 and path redaction; authz 404 parity", async () => {
    resetTelemetrySpans();
    for (const url of [arts("!!bad!!", "CAP-SSO"), atts("Not_A_Slug", "CAP-ATTACH-READ"), arts("reqalm", "bad id!")]) {
      assert.equal((await inject(url)).statusCode, 400, url);
    }
    assert.ok(finishedSpans().some((s) => String(s.attributes["url.path"] ?? "").includes("[invalid]")));
    const refA = await inject(arts("reqalm", "CAP-NO-SUCH-VER"));
    const refT = await inject(atts("reqalm", "CAP-NO-SUCH-VER"));
    const q = (sql: string) => ctx!.pool.query(sql);
    const saved = (await q(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`)).rows as {
      id: string;
      role: string;
    }[];
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-art', 'reqalm', 'casey-reader', 'Key custodian')`);
    try {
      for (const [ref, url] of [
        [refA, arts("reqalm", "CAP-SSO")],
        [refT, atts("reqalm", "CAP-ATTACH-READ")],
      ] as const) {
        const res = await inject(url);
        assert.equal(res.statusCode, 404);
        assert.deepEqual(hdrs(res), hdrs(ref));
      }
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-kc-art'`);
      for (const g of saved) await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('${g.id}', 'reqalm', 'casey-reader', '${g.role}') ON CONFLICT DO NOTHING`);
    }
  });
});
