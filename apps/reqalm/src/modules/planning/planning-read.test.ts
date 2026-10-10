import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { createTestApp, issueTestAccessToken, type TestApp } from "../../test/harness.js";
import { finishedSpans, resetTelemetrySpans } from "../../test/otel-testing.js";
import { listRoutesForSecurityAudit } from "../../http/route-security.js";

let ctx: TestApp | undefined;
let bearer: Record<string, string>;
const P = "reqalm";
const ITER = (pid: string) => `/api/v1/projects/${pid}/iterations`;
const ITER1 = (pid: string, id: string) => `${ITER(pid)}/${id}`;
const CS = (pid: string) => `/api/v1/projects/${pid}/change-sets`;
const CS1 = (pid: string, id: string) => `${CS(pid)}/${id}`;
const WI = (pid: string) => `/api/v1/projects/${pid}/work-item-links`;
const WI1 = (pid: string, id: string) => `${WI(pid)}/${id}`;
const q = (sql: string) => ctx!.pool.query(sql);
const inject = (url: string, headers = bearer) =>
  ctx!.app.inject({ method: "GET", url, remoteAddress: "203.0.113.50", headers: { host: "localhost:3000", ...headers } } as never);
const dataOf = (res: { statusCode: number; json: () => unknown }) => (assert.equal(res.statusCode, 200), (res.json() as { data: unknown }).data);
type InjectResponse = Awaited<ReturnType<typeof inject>>;
const stripReqId = (b: Record<string, unknown>) => (({ request_id: _, ...r }) => r)(b);
const VOLATILE = new Set(["date", "request-id"]);
const hdrs = (res: InjectResponse) => {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    if (VOLATILE.has(k.toLowerCase()) || v === undefined) continue;
    out[k] = Array.isArray(v) ? v.map(String) : typeof v === "number" ? String(v) : v;
  }
  return out;
};
const assert404Parity = (ref: InjectResponse, res: InjectResponse, url: string) => {
  assert.equal(res.statusCode, 404, url);
  assert.deepEqual(hdrs(res), hdrs(ref), url);
  assert.deepEqual(stripReqId(res.json() as Record<string, unknown>), stripReqId(ref.json() as Record<string, unknown>), url);
};

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
});
after(async () => {
  await ctx?.close();
});

describe("planning route registration", () => {
  it("pins projectScoped planning:read on every planning operation route", () => {
    const seen = new Set<string>();
    const routes = listRoutesForSecurityAudit(ctx!.app).filter((r) => {
      if (!r.operationRef?.name?.startsWith("planning.")) return false;
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
    assert.equal(routes.length, 6);
    for (const r of routes) {
      assert.equal(r.operationRef?.permission, "planning:read", r.url);
      assert.equal(r.operationRef?.projectScoped, true, r.url);
    }
    const dir = path.dirname(fileURLToPath(import.meta.url));
    assert.match(readFileSync(path.join(dir, "routes.ts"), "utf8"), /permission: "planning:read"/);
    assert.match(readFileSync(path.join(dir, "planning.service.ts"), "utf8"), /v\.project_id = ANY\(\$/);
  });
});

describe("planning read API", () => {
  it("iterations list sort and detail; change sets; work item links; no cyber_gate fields", async () => {
    const iters = dataOf(await inject(`${ITER(P)}?limit=100`)) as { items: { id: string }[]; total: number };
    assert.equal(iters.total, 3);
    assert.deepEqual(
      iters.items.map((i) => i.id),
      ["iter-r2", "iter-r1", "iter-r0"],
    );
    const cs = dataOf(await inject(`${CS(P)}?limit=100`)) as { items: { id: string; parent_id: string | null }[]; total: number };
    assert.equal(cs.total, 5);
    assert.ok(cs.items.some((c) => c.parent_id === "cs-sdlc-r1-security-review"));
    const wi = dataOf(await inject(`${WI(P)}?limit=100`)) as { items: { id: string }[]; total: number };
    assert.equal(wi.total, 2);
    const detail = dataOf(await inject(ITER1(P, "iter-r1"))) as Record<string, unknown>;
    assert.equal(detail.name, "R1 core ALM");
    for (const key of Object.keys(detail)) {
      assert.ok(!key.includes("cyber_gate") && !key.includes("gate_signoffs"), key);
    }
    assert.ok(!JSON.stringify((await inject(CS1(P, "cs-stack-newer"))).json()).includes("gate_signoffs"));
  });

  it("paging edges on iterations", async () => {
    assert.equal((await inject(`${ITER(P)}?limit=101`)).statusCode, 400);
    const empty = dataOf(await inject(`${ITER(P)}?limit=2&offset=99`)) as { items: unknown[]; total: number };
    assert.equal(empty.total, 3);
    assert.equal(empty.items.length, 0);
  });

  it("missing, forbidden, and cross-project paths share 404", async () => {
    const ref = await inject(ITER1(P, "no-such-iter"));
    assert.equal(ref.statusCode, 404);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('plan-p2', 'raby-family', 'P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO iterations (id, project_id, name) VALUES ('iter-p2-only', 'plan-p2', 'x') ON CONFLICT DO NOTHING`);
    try {
      assert404Parity(ref, await inject(ITER1(P, "iter-p2-only")), "cross-project iteration");
    } finally {
      await q(`DELETE FROM iterations WHERE id = 'iter-p2-only'; DELETE FROM projects WHERE id = 'plan-p2'`);
    }
    const saved = (await q(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = '${P}'`)).rows as {
      id: string;
      role: string;
    }[];
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = '${P}'`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-plan', '${P}', 'casey-reader', 'Key custodian')`);
    try {
      for (const url of [ITER(P), ITER1(P, "iter-r0"), CS(P), CS1(P, "cs-stack-newer"), WI(P), WI1(P, "wil-a01-ado")]) {
        assert404Parity(ref, await inject(url), url);
      }
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-kc-plan'`);
      for (const g of saved) await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('${g.id}', '${P}', 'casey-reader', '${g.role}') ON CONFLICT DO NOTHING`);
    }
  });

  it("regression: planning:read on p2 only returns 404 on reqalm routes", async () => {
    const saved = (await q(`SELECT id, project_id, role FROM project_grants WHERE identity_id = 'casey-reader'`)).rows as {
      id: string;
      project_id: string;
      role: string;
    }[];
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader'`);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('plan-p2', 'raby-family', 'P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO iterations (id, project_id, name) VALUES ('iter-p2-local', 'plan-p2', 'local') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-p2-plan', 'plan-p2', 'casey-reader', 'Reader')`);
    try {
      assert.equal((await inject(ITER(P))).statusCode, 404);
      assert.equal((await inject(ITER1(P, "iter-r0"))).statusCode, 404);
      assert.equal((await inject(ITER("plan-p2"))).statusCode, 200);
    } finally {
      await q(`DELETE FROM iterations WHERE id = 'iter-p2-local'`);
      await q(`DELETE FROM project_grants WHERE id = 'grant-p2-plan'`);
      await q(`DELETE FROM projects WHERE id = 'plan-p2'`);
      for (const g of saved) {
        await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('${g.id}', '${g.project_id}', 'casey-reader', '${g.role}') ON CONFLICT DO NOTHING`);
      }
    }
  });

  it("malformed ids: 400, redaction, audit", async () => {
    resetTelemetrySpans();
    assert.equal((await inject(ITER1(P, "!!bad!!"))).statusCode, 400);
    const bad = await inject(CS1(P, "!!bad!!"), { ...bearer, "x-request-id": "plan-bad-id" });
    assert.equal(bad.statusCode, 400);
    assert.equal((await q(`SELECT target_id FROM audit_events WHERE request_id = 'plan-bad-id'`)).rows[0]?.target_id, null);
    assert.ok(finishedSpans().some((s) => String(s.attributes["url.path"] ?? "").includes("/change-sets/[invalid]")));
  });

  it("hidden cross-project work item link omitted from list and total", async () => {
    const before = dataOf(await inject(`${WI(P)}?limit=100`)) as { items: { id: string }[]; total: number };
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('plan-hidden-p2', 'raby-family', 'Hidden') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('PLAN-HIDDEN', 'plan-hidden-p2', 'requirement', 'SECRET-WIL') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('PLAN-HIDDEN', 'PLAN-HIDDEN', 'plan-hidden-p2', 0, 'active', 's') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO work_item_links (id, project_id, requirement_version_uid, devops_id) VALUES ('wil-hidden-cross', '${P}', 'PLAN-HIDDEN', 'ADO-SECRET') ON CONFLICT DO NOTHING`);
    try {
      const after = dataOf(await inject(`${WI(P)}?limit=100`)) as { items: { id: string }[]; total: number };
      assert.equal(after.total, before.total);
      assert.deepEqual(after.items, before.items);
      assert.ok(!JSON.stringify(after).includes("ADO-SECRET"));
    } finally {
      await q(`DELETE FROM work_item_links WHERE id = 'wil-hidden-cross'`);
      await q(`DELETE FROM requirement_versions WHERE uid = 'PLAN-HIDDEN'`);
      await q(`DELETE FROM requirement_lines WHERE base_uid = 'PLAN-HIDDEN'`);
      await q(`DELETE FROM projects WHERE id = 'plan-hidden-p2'`);
    }
  });
});
