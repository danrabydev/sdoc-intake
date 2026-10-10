import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { createTestApp, issueTestAccessToken, type TestApp } from "../../test/harness.js";
import { finishedSpans, resetTelemetrySpans } from "../../test/otel-testing.js";
import { listRoutesForSecurityAudit } from "../../http/route-security.js";
import type { ContractScopeLineDto } from "./contracts.service.js";

let ctx: TestApp;
let bearer: Record<string, string>;
const LIST = (p: string) => `/api/v1/projects/${p}/contracts`;
const DET = (p: string, id: string) => `${LIST(p)}/${id}`;
const SCOPE = (p: string, id: string) => `${DET(p, id)}/scope`;
const RELS = (p: string, id: string) => `${DET(p, id)}/releases`;
const q = (sql: string) => ctx.pool.query(sql);
const inject = (url: string, headers = bearer) =>
  ctx.app.inject({ method: "GET", url, remoteAddress: "203.0.113.50", headers: { host: "localhost:3000", ...headers } } as never);
const dataOf = (res: { statusCode: number; json: () => unknown }) => (assert.equal(res.statusCode, 200), (res.json() as { data: unknown }).data);
const stripReqId = (b: Record<string, unknown>) => (({ request_id: _, ...r }) => r)(b);
const problemHeaders = (res: { headers: Record<string, string | string[] | undefined> }) => ({
  "content-type": res.headers["content-type"],
});
const assert404Parity = (
  ref: { statusCode: number; headers: Record<string, string | string[] | undefined>; json: () => unknown },
  res: typeof ref,
  url: string,
) => {
  assert.equal(res.statusCode, 404, url);
  assert.deepEqual(problemHeaders(res), problemHeaders(ref), url);
  assert.deepEqual(stripReqId(res.json() as Record<string, unknown>), stripReqId(ref.json() as Record<string, unknown>), url);
};
const audit = (rid: string) =>
  ctx.pool.query(`SELECT operation, outcome, project_id, target_id FROM audit_events WHERE request_id = $1 ORDER BY id DESC LIMIT 1`, [rid]);
const scopePage = async (projectId: string, contractId: string, limit = 100) => {
  const items: ContractScopeLineDto[] = [];
  let total = 0;
  for (let offset = 0; offset < 10_000; offset += limit) {
    const page = dataOf(await inject(`${SCOPE(projectId, contractId)}?limit=${limit}&offset=${offset}`)) as {
      items: ContractScopeLineDto[];
      total: number;
    };
    total = page.total;
    items.push(...page.items);
    if (items.length >= total) break;
  }
  assert.equal(items.length, total);
  return { items, total };
};

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
});
after(async () => ctx.close());

describe("contracts route registration", () => {
  it("pins projectScoped contract:read on every contracts operation route", () => {
    const routes = listRoutesForSecurityAudit(ctx.app).filter((r) => r.url.includes("/contracts"));
    assert.ok(routes.length >= 4);
    for (const r of routes) {
      assert.equal(r.operationRoute, true, r.url);
      assert.equal(r.operationRef?.permission, "contract:read", r.url);
      assert.equal(r.operationRef?.projectScoped, true, r.url);
    }
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const svc = readFileSync(path.join(dir, "contracts.service.ts"), "utf8");
    const routesSrc = readFileSync(path.join(dir, "routes.ts"), "utf8");
    assert.match(svc, /c\.project_id = \$1/);
    assert.match(svc, /v\.project_id = ANY\(\$/);
    assert.match(svc, /r\.project_id = ANY\(\$/);
    assert.match(svc, /allowed\.has\(r\.line_project_id\)/);
    assert.match(svc, /if \(!allowed\.has\(r\.line_project_id\)\) continue/);
    assert.match(routesSrc, /permission: "contract:read"/);
    assert.match(routesSrc, /permissionDeniedAsNotFound: true/);
    assert.match(routesSrc, /projectScoped: true/);
  });
});

describe("contracts read API", () => {
  it("list sort order id asc; detail fields; no cyber_gate in payloads", async () => {
    const list = dataOf(await inject(`${LIST("reqalm")}?limit=100`)) as {
      items: { id: string; title: string; kind: string; scope_count: number; release_count: number }[];
      total: number;
    };
    assert.equal(list.total, 7);
    assert.deepEqual(list.items.map((i) => i.id), [...list.items.map((i) => i.id)].sort());
    const product = list.items.find((i) => i.id === "ctr-reqalm-product")!;
    assert.equal(product.kind, "contract");
    assert.ok(product.scope_count >= 400);
    assert.ok(product.release_count >= 31);
    const detail = dataOf(await inject(DET("reqalm", "ctr-reqalm-maintenance"))) as Record<string, unknown>;
    assert.equal(detail.status, "active");
    assert.equal(detail.scope_count, 4);
    for (const key of Object.keys(detail)) {
      assert.ok(!key.includes("cyber_gate") && !key.includes("gate_signoffs"), key);
    }
    const body = JSON.stringify((await inject(DET("reqalm", "ctr-reqalm-product"))).json());
    assert.ok(!body.includes("cyber_gate") && !body.includes("gate_signoffs"));
  });

  it("scope paging edges and maintenance visible lines", async () => {
    assert.equal((await inject(`${SCOPE("reqalm", "ctr-reqalm-maintenance")}?limit=101`)).statusCode, 400);
    const empty = dataOf(await inject(`${SCOPE("reqalm", "ctr-reqalm-maintenance")}?limit=2&offset=99`)) as {
      items: unknown[];
      total: number;
    };
    assert.equal(empty.total, 4);
    assert.equal(empty.items.length, 0);
    const page0 = dataOf(await inject(`${SCOPE("reqalm", "ctr-reqalm-maintenance")}?limit=2&offset=0`)) as {
      items: ContractScopeLineDto[];
      total: number;
    };
    assert.equal(page0.total, 4);
    const bases = [...page0.items, ...(dataOf(await inject(`${SCOPE("reqalm", "ctr-reqalm-maintenance")}?limit=2&offset=2`)) as { items: ContractScopeLineDto[] }).items].map(
      (l) => l.base,
    );
    assert.equal(page0.total, page0.items.length + 2);
    assert.deepEqual(bases.sort(), [
      "CAP-UPKEEP-AUDIT-LOG-REVIEW",
      "CAP-UPKEEP-MONTHLY-DEPS-VULN",
      "CAP-UPKEEP-MONTHLY-SEC-AUDIT",
      "CAP-UPKEEP-QUARTERLY-ACCESS-RECERT",
    ]);
  });

  it("releases visible set matches grant-filtered covers_releases order", async () => {
    const rels = dataOf(await inject(RELS("reqalm", "ctr-reqalm-product"))) as { items: { id: string }[] };
    const pos = (
      await q(
        `SELECT cr.release_id FROM contract_releases cr JOIN releases r ON r.id = cr.release_id
          WHERE cr.contract_id = 'ctr-reqalm-product' AND cr.project_id = 'reqalm' AND r.project_id = 'reqalm'
          ORDER BY cr.position ASC, cr.release_id ASC`,
      )
    ).rows.map((r) => r.release_id as string);
    assert.deepEqual(rels.items.map((r) => r.id), pos);
  });

  it("missing, forbidden, and cross-project contract paths share 404", async () => {
    const ref = await inject(DET("reqalm", "no-such-contract"));
    assert.equal(ref.statusCode, 404);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('ctr-p2', 'reqalm-client', 'P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO contracts (id, project_id, client_id, name, status) VALUES ('ctr-p2-only', 'ctr-p2', 'reqalm-client', 'x', 'active') ON CONFLICT DO NOTHING`);
    try {
      for (const url of [
        DET("reqalm", "ctr-p2-only"),
        SCOPE("reqalm", "ctr-p2-only"),
        RELS("reqalm", "ctr-p2-only"),
        SCOPE("reqalm", "ctr-reqalm-product").replace("ctr-reqalm-product", "ctr-p2-only"),
      ]) {
        assert404Parity(ref, await inject(url), url);
      }
    } finally {
      await q(`DELETE FROM contracts WHERE id = 'ctr-p2-only'; DELETE FROM projects WHERE id = 'ctr-p2'`);
    }
    const saved = (await q(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`)).rows as {
      id: string;
      role: string;
    }[];
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-ctr', 'reqalm', 'casey-reader', 'Key custodian')`);
    try {
      for (const url of [LIST("reqalm"), DET("reqalm", "ctr-reqalm-product"), SCOPE("reqalm", "ctr-reqalm-product"), RELS("reqalm", "ctr-reqalm-product")]) {
        assert404Parity(ref, await inject(url), url);
      }
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-kc-ctr'`);
      for (const g of saved) await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('${g.id}', 'reqalm', 'casey-reader', '${g.role}') ON CONFLICT DO NOTHING`);
    }
  });

  it("malformed project and contract ids: 400, redaction, audit", async () => {
    resetTelemetrySpans();
    for (const url of [DET("reqalm", "!!bad!!"), DET("reqalm", `a${"b".repeat(64)}`)]) {
      assert.equal((await inject(url)).statusCode, 400, url);
    }
    assert.equal((await inject(DET("Not_A_Slug", "ctr-reqalm-product"))).statusCode, 404);
    const bad = await inject(DET("reqalm", "!!bad!!"), { ...bearer, "x-request-id": "ctr-bad-id" });
    assert.equal((await q(`SELECT target_id FROM audit_events WHERE request_id = 'ctr-bad-id'`)).rows[0]?.target_id, null);
    assert.ok(finishedSpans().some((s) => String(s.attributes["url.path"] ?? "").includes("/contracts/[invalid]")));
  });

  it("audit row on allow for list, get, scope, releases", async () => {
    const ops = [
      ["ctr-audit-list", LIST("reqalm")],
      ["ctr-audit-get", DET("reqalm", "ctr-reqalm-product")],
      ["ctr-audit-scope", `${SCOPE("reqalm", "ctr-reqalm-maintenance")}?limit=1`],
      ["ctr-audit-rels", RELS("reqalm", "ctr-reqalm-product")],
    ] as const;
    for (const [rid, url] of ops) {
      assert.equal((await inject(url, { ...bearer, "x-request-id": rid })).statusCode, 200, url);
      const row = (await audit(rid)).rows[0]!;
      assert.equal(row.outcome, "allow");
      assert.equal(row.project_id, "reqalm");
    }
    assert.equal((await audit("ctr-audit-get")).rows[0]?.operation, "contracts.get");
    assert.equal((await audit("ctr-audit-scope")).rows[0]?.operation, "contracts.list_scope");
  });

  it("hidden cross-project scope and releases omit rows without changing visible items or total", async () => {
    const beforeList = dataOf(await inject(DET("reqalm", "ctr-reqalm-product"))) as {
      scope_count: number;
      release_count: number;
    };
    const beforeRels = dataOf(await inject(RELS("reqalm", "ctr-reqalm-product"))) as { items: { id: string; name: string }[] };
    const beforeScope = await scopePage("reqalm", "ctr-reqalm-product");
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('ctr-hidden-p2', 'reqalm-client', 'Hidden') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('CTR-HIDDEN-LINE', 'ctr-hidden-p2', 'requirement', 'SECRET-HIDDEN-LINE-TITLE') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('CTR-HIDDEN-LINE', 'CTR-HIDDEN-LINE', 'ctr-hidden-p2', 0, 'active', 's') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO releases (id, project_id, name, status, position) VALUES ('rel-hidden-p2-only', 'ctr-hidden-p2', 'SECRET-HIDDEN-RELEASE-NAME', 'planned', 9999) ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO contract_scope (contract_id, project_id, version_uid, position) VALUES ('ctr-reqalm-product', 'reqalm', 'CTR-HIDDEN-LINE', 99998) ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO contract_releases (contract_id, project_id, release_id, position) VALUES ('ctr-reqalm-product', 'reqalm', 'rel-hidden-p2-only', 99998) ON CONFLICT DO NOTHING`);
    try {
      const afterList = dataOf(await inject(DET("reqalm", "ctr-reqalm-product"))) as { scope_count: number; release_count: number };
      assert.equal(afterList.scope_count, beforeList.scope_count);
      assert.equal(afterList.release_count, beforeList.release_count);
      assert.deepEqual(
        (dataOf(await inject(RELS("reqalm", "ctr-reqalm-product"))) as { items: { id: string; name: string }[] }).items,
        beforeRels.items,
      );
      const afterScope = await scopePage("reqalm", "ctr-reqalm-product");
      assert.deepEqual(afterScope.items, beforeScope.items);
      assert.equal(afterScope.total, beforeScope.total);
      const payload = JSON.stringify(afterScope.items);
      for (const secret of ["SECRET-HIDDEN-LINE-TITLE", "CTR-HIDDEN-LINE", "SECRET-HIDDEN-RELEASE-NAME", "rel-hidden-p2-only", "restricted"]) {
        assert.ok(!payload.includes(secret));
      }
    } finally {
      await q(`DELETE FROM contract_releases WHERE contract_id = 'ctr-reqalm-product' AND release_id = 'rel-hidden-p2-only'`);
      await q(`DELETE FROM contract_scope WHERE version_uid = 'CTR-HIDDEN-LINE'`);
      await q(`DELETE FROM releases WHERE id = 'rel-hidden-p2-only'`);
      await q(`DELETE FROM requirement_versions WHERE uid = 'CTR-HIDDEN-LINE'`);
      await q(`DELETE FROM requirement_lines WHERE base_uid = 'CTR-HIDDEN-LINE'`);
      await q(`DELETE FROM projects WHERE id = 'ctr-hidden-p2'`);
    }
  });
});
