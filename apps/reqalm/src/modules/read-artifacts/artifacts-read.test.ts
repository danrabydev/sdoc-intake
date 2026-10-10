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
const VOLATILE_RESPONSE_HEADERS = new Set(["date", "request-id"]);
const comparableResponseHeaders = (res: InjectResponse) => {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(res.headers)) {
    if (VOLATILE_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.map(String) : typeof value === "number" ? String(value) : value;
  }
  return out;
};
const assert404Parity = (ref: InjectResponse, res: InjectResponse, url: string) => {
  assert.equal(res.statusCode, 404, url);
  assert.deepEqual(comparableResponseHeaders(res), comparableResponseHeaders(ref), url);
};

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
});
after(async () => {
  await ctx?.close();
});

describe("artifacts route registration", () => {
  it("pins projectScoped requirement:read on artifact and attachment list routes", () => {
    const routes = listRoutesForSecurityAudit(ctx!.app).filter((r) =>
      r.url.includes("/requirement-versions/"),
    );
    assert.equal(routes.length, 2);
    for (const r of routes) {
      assert.equal(r.operationRoute, true, r.url);
      assert.equal(r.operationRef?.permission, "requirement:read", r.url);
      assert.equal(r.operationRef?.projectScoped, true, r.url);
    }
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const svc = readFileSync(path.join(dir, "artifacts.service.ts"), "utf8");
    const routesSrc = readFileSync(path.join(dir, "routes.ts"), "utf8");
    assert.match(svc, /project_id = \$1/);
    assert.match(routesSrc, /permission: "requirement:read"/);
    assert.match(routesSrc, /permissionDeniedAsNotFound: true/);
  });
});

describe("artifacts read API", () => {
  it("lists CAP-SSO design artifacts sorted by position with stable ids", async () => {
    const page = dataOf(await inject(`${arts("reqalm", "CAP-SSO")}?limit=10`)) as {
      items: { id: string; kind: string; uri: string; position: number }[];
      total: number;
    };
    assert.equal(page.total, 2);
    assert.deepEqual(
      page.items.map((i) => i.position),
      [0, 1],
    );
    assert.equal(page.items[0]!.id, stableCapabilityArtifactId("CAP-SSO", 0));
    assert.ok(page.items.every((i) => i.kind === "other"));
    const body = JSON.stringify(page);
    assert.ok(!body.includes("cyber_gate") && !body.includes("gate_signoffs"));
    assert.ok(!body.includes("storage_key") && !body.includes("wrapped_dek"));
  });

  it("artifact paging edges", async () => {
    assert.equal((await inject(`${arts("reqalm", "CAP-SSO")}?limit=101`)).statusCode, 400);
    const empty = dataOf(await inject(`${arts("reqalm", "CAP-SSO")}?limit=1&offset=99`)) as {
      items: unknown[];
      total: number;
    };
    assert.equal(empty.total, 2);
    assert.equal(empty.items.length, 0);
  });

  it("lists seeded file attachment metadata on CAP-ATTACH-READ", async () => {
    const page = dataOf(await inject(`${atts("reqalm", "CAP-ATTACH-READ")}?limit=10`)) as {
      items: {
        id: string;
        version_id: string;
        display_name: string;
        sha256: string;
        scan_state: string;
        is_latest: boolean;
      }[];
      total: number;
    };
    assert.equal(page.total, 1);
    assert.equal(page.items[0]!.id, "att_a1b2c3d4e5f6g7h8i9j0k1l2m3n4");
    assert.equal(page.items[0]!.scan_state, "clean");
    assert.equal(page.items[0]!.is_latest, true);
    const body = JSON.stringify(page);
    assert.ok(!body.includes("storage_key"));
  });

  it("soft-deleted attachments hidden; missing parent version 404", async () => {
    assert.equal((await inject(atts("reqalm", "CAP-NO-SUCH-VER"))).statusCode, 404);
    const hidden = dataOf(await inject(atts("reqalm", "CAP-ATTACH-READ")));
    assert.equal((hidden as { total: number }).total, 1);
  });

  it("cross-project leak: version uid anchored in another project returns 404", async () => {
    const q = (sql: string) => ctx!.pool.query(sql);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('ctr-p2', 'reqalm-client', 'P2') ON CONFLICT DO NOTHING`);
    await q(
      `INSERT INTO requirement_lines (base_uid, project_id, kind, title, sibling_order)
       VALUES ('XPROJ-ATT', 'ctr-p2', 'capability', 'X', 0) ON CONFLICT DO NOTHING`,
    );
    await q(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement)
       VALUES ('XPROJ-ATT', 'XPROJ-ATT', 'ctr-p2', 0, 'draft', 'x') ON CONFLICT DO NOTHING`,
    );
    try {
      assert.equal((await inject(arts("reqalm", "XPROJ-ATT"))).statusCode, 404);
    } finally {
      await q(`DELETE FROM requirement_versions WHERE uid = 'XPROJ-ATT'`);
      await q(`DELETE FROM requirement_lines WHERE base_uid = 'XPROJ-ATT' AND project_id = 'ctr-p2'`);
      await q(`DELETE FROM projects WHERE id = 'ctr-p2'`);
    }
  });

  it("missing parent and forbidden grant share 404 header parity", async () => {
    const ref = await inject(arts("reqalm", "CAP-NO-SUCH-VER"));
    assert.equal(ref.statusCode, 404);
    const q = (sql: string) => ctx!.pool.query(sql);
    const saved = (await q(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`))
      .rows as { id: string; role: string }[];
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await q(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-art', 'reqalm', 'casey-reader', 'Key custodian')`,
    );
    try {
      assert404Parity(ref, await inject(arts("reqalm", "CAP-SSO")), arts("reqalm", "CAP-SSO"));
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-kc-art'`);
      for (const g of saved) {
        await q(
          `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('${g.id}', 'reqalm', 'casey-reader', '${g.role}') ON CONFLICT DO NOTHING`,
        );
      }
    }
  });

  it("malformed version id: 400 with path redaction", async () => {
    resetTelemetrySpans();
    const url = arts("reqalm", "bad id!");
    assert.equal((await inject(url)).statusCode, 400);
    assert.ok(
      finishedSpans().some((s) =>
        String(s.attributes["url.path"] ?? "").includes("/requirement-versions/[invalid]/"),
      ),
    );
  });
});
