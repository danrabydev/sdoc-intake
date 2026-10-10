import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { createTestApp, issueTestAccessToken, type TestApp } from "../../test/harness.js";
import { finishedSpans, resetTelemetrySpans } from "../../test/otel-testing.js";
import { listRoutesForSecurityAudit } from "../../http/route-security.js";
import { PLANNING_ROUTE_OPS } from "../../rbac/role-permissions.test.js";

let ctx: TestApp | undefined;
let bearer: Record<string, string>;
const P = "reqalm";
const BASE = `/api/v1/projects/${P}`;
const paths = {
  iterList: `${BASE}/iterations`,
  iterGet: (id: string) => `${BASE}/iterations/${id}`,
  csList: `${BASE}/change-sets`,
  csGet: (id: string) => `${BASE}/change-sets/${id}`,
  wiList: `${BASE}/work-item-links`,
  wiGet: (id: string) => `${BASE}/work-item-links/${id}`,
};
const BAD = ["!!bad!!", `a${"b".repeat(64)}`] as const;
const q = (sql: string) => ctx!.pool.query(sql);
const inject = (url: string, headers = bearer) =>
  ctx!.app.inject({ method: "GET", url, remoteAddress: "203.0.113.50", headers: { host: "localhost:3000", ...headers } } as never);
const dataOf = (res: { statusCode: number; json: () => unknown }) => (assert.equal(res.statusCode, 200), (res.json() as { data: unknown }).data);
type Res = Awaited<ReturnType<typeof inject>>;
const stripReqId = (b: Record<string, unknown>) => (({ request_id: _, ...r }) => r)(b);
const hdrs = (res: Res) => {
  const skip = new Set(["date", "request-id"]);
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    if (skip.has(k.toLowerCase()) || v === undefined) continue;
    out[k] = Array.isArray(v) ? v.map(String) : typeof v === "number" ? String(v) : v;
  }
  return out;
};
const assert404Parity = (ref: Res, res: Res, label: string) => {
  assert.equal(res.statusCode, 404, label);
  assert.deepEqual(hdrs(res), hdrs(ref), label);
  assert.deepEqual(stripReqId(res.json() as Record<string, unknown>), stripReqId(ref.json() as Record<string, unknown>), label);
};

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
});
after(async () => {
  await ctx?.close();
});

describe("planning read API", () => {
  it("registers six projectScoped routes on planning:read (pinned with role table)", () => {
    const seen = new Set<string>();
    const routes = listRoutesForSecurityAudit(ctx!.app).filter((r) => {
      if (!r.operationRef?.name?.startsWith("planning.")) return false;
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
    assert.deepEqual(
      routes.map((r) => r.operationRef!.name).sort(),
      [...PLANNING_ROUTE_OPS].sort(),
    );
    for (const r of routes) {
      assert.equal(r.operationRef?.permission, "planning:read", r.url);
      assert.equal(r.operationRef?.projectScoped, true, r.url);
    }
    const dir = path.dirname(fileURLToPath(import.meta.url));
    assert.match(readFileSync(path.join(dir, "planning.service.ts"), "utf8"), /v\.project_id = ANY\(\$/);
  });

  for (const [label, mk, spanNeedle] of [
    ["iterationId", (id: string) => paths.iterGet(id), "/iterations/[invalid]"],
    ["changeSetId", (id: string) => paths.csGet(id), "/change-sets/[invalid]"],
    ["linkId", (id: string) => paths.wiGet(id), "/work-item-links/[invalid]"],
  ] as const) {
    it(`400 + redaction for bad ${label}`, async () => {
      resetTelemetrySpans();
      for (const bad of BAD) assert.equal((await inject(mk(bad))).statusCode, 400, mk(bad));
      const audited = await inject(mk(BAD[0]), { ...bearer, "x-request-id": `plan-bad-${label}` });
      assert.equal(audited.statusCode, 400);
      assert.equal((await q(`SELECT target_id FROM audit_events WHERE request_id = 'plan-bad-${label}'`)).rows[0]?.target_id, null);
      assert.ok(finishedSpans().some((s) => String(s.attributes["url.path"] ?? "").includes(spanNeedle)));
    });
  }

  it("400 for bad projectId on list routes returns 404 when slug invalid", async () => {
    assert.equal((await inject(`/api/v1/projects/Not_A_Slug/iterations`)).statusCode, 404);
  });

  for (const [name, listUrl, expectIds, total] of [
    ["iterations", paths.iterList, ["iter-r2", "iter-r1", "iter-r0"], 3],
    [
      "change_sets",
      paths.csList,
      [
        "cs-stack-newer",
        "cs-stack-older",
        "cs-leaf-under-sdlc-conforms",
        "cs-sdlc-r1-security-review",
        "cs-leaf-alex-draft-edit",
      ],
      5,
    ],
    ["work_item_links", paths.wiList, ["wil-a01-ado", "wil-fix-approved-ado"], 2],
  ] as const) {
    it(`list ${name}: sort, paging edges, no cyber_gate`, async () => {
      assert.equal((await inject(`${listUrl}?limit=101`)).statusCode, 400);
      const empty = dataOf(await inject(`${listUrl}?limit=2&offset=99`)) as { items: unknown[]; total: number };
      assert.equal(empty.total, total);
      assert.equal(empty.items.length, 0);
      const page = dataOf(await inject(`${listUrl}?limit=100`)) as { items: { id: string }[]; total: number };
      assert.equal(page.total, total);
      if (expectIds) assert.deepEqual(page.items.map((i) => i.id), expectIds);
      assert.ok(!JSON.stringify(page).match(/cyber_gate|gate_signoffs/));
    });
  }

  it("detail payloads omit cyber_gate / gate_signoffs", async () => {
    const detail = dataOf(await inject(paths.iterGet("iter-r1"))) as Record<string, unknown>;
    assert.equal(detail.name, "R1 core ALM");
    for (const key of Object.keys(detail)) assert.ok(!key.includes("cyber_gate") && !key.includes("gate_signoffs"), key);
  });

  it("iterations list is scoped to projectId (cross-project rows omitted)", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('plan-p2', 'raby-family', 'P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO iterations (id, project_id, name) VALUES ('iter-p2-only', 'plan-p2', 'x') ON CONFLICT DO NOTHING`);
    try {
      const page = dataOf(await inject(`${paths.iterList}?limit=100`)) as { items: { id: string }[]; total: number };
      assert.equal(page.total, 3);
      assert.ok(!page.items.some((i) => i.id === "iter-p2-only"));
    } finally {
      await q(`DELETE FROM iterations WHERE id = 'iter-p2-only'; DELETE FROM projects WHERE id = 'plan-p2'`);
    }
  });

  it("change-set GET returns 404 for id owned by another project", async () => {
    const ref = await inject(paths.csGet("no-such-cs"));
    assert.equal(ref.statusCode, 404);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('plan-cs-p2', 'raby-family', 'P2') ON CONFLICT DO NOTHING`);
    await q(
      `INSERT INTO change_sets (id, project_id, kind, scope, status, opened_by, opened_at)
       VALUES ('cs-p2-only', 'plan-cs-p2', 'leaf', 'project', 'open', 'dan', now()) ON CONFLICT DO NOTHING`,
    );
    try {
      assert404Parity(ref, await inject(paths.csGet("cs-p2-only")), "change-set cross-project");
    } finally {
      await q(`DELETE FROM change_sets WHERE id = 'cs-p2-only'; DELETE FROM projects WHERE id = 'plan-cs-p2'`);
    }
  });

  it("work-item-link GET returns 404 for id in URL project but version on another project", async () => {
    const ref = await inject(paths.wiGet("no-such-wil"));
    assert.equal(ref.statusCode, 404);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('plan-wil-p2', 'raby-family', 'P2') ON CONFLICT DO NOTHING`);
    await q(
      `INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('PLAN-WIL-P2', 'plan-wil-p2', 'requirement', 'x') ON CONFLICT DO NOTHING`,
    );
    await q(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement)
       VALUES ('PLAN-WIL-P2', 'PLAN-WIL-P2', 'plan-wil-p2', 0, 'active', 's') ON CONFLICT DO NOTHING`,
    );
    await q(
      `INSERT INTO work_item_links (id, project_id, requirement_version_uid, devops_id)
       VALUES ('wil-p2-version', '${P}', 'PLAN-WIL-P2', 'ADO-P2') ON CONFLICT DO NOTHING`,
    );
    try {
      assert404Parity(ref, await inject(paths.wiGet("wil-p2-version")), "work-item-link cross-project version");
    } finally {
      await q(
        `DELETE FROM work_item_links WHERE id = 'wil-p2-version';
         DELETE FROM requirement_versions WHERE uid = 'PLAN-WIL-P2';
         DELETE FROM requirement_lines WHERE base_uid = 'PLAN-WIL-P2';
         DELETE FROM projects WHERE id = 'plan-wil-p2'`,
      );
    }
  });

  it("404 header/body parity: missing, forbidden, cross-project iteration id", async () => {
    const ref = await inject(paths.iterGet("no-such-iter"));
    assert.equal(ref.statusCode, 404);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('plan-p2', 'raby-family', 'P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO iterations (id, project_id, name) VALUES ('iter-p2-only', 'plan-p2', 'x') ON CONFLICT DO NOTHING`);
    try {
      assert404Parity(ref, await inject(paths.iterGet("iter-p2-only")), "cross-project iteration get");
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
      for (const url of [
        paths.iterList,
        paths.iterGet("iter-r0"),
        paths.csList,
        paths.csGet("cs-stack-newer"),
        paths.wiList,
        paths.wiGet("wil-a01-ado"),
      ]) {
        assert404Parity(ref, await inject(url), url);
      }
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-kc-plan'`);
      for (const g of saved) await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('${g.id}', '${P}', 'casey-reader', '${g.role}') ON CONFLICT DO NOTHING`);
    }
  });

  it("cross-project grant: planning:read on p2 only → 404 on reqalm", async () => {
    const saved = (await q(`SELECT id, project_id, role FROM project_grants WHERE identity_id = 'casey-reader'`)).rows as {
      id: string;
      project_id: string;
      role: string;
    }[];
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader'`);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('plan-p2', 'raby-family', 'P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-p2-plan', 'plan-p2', 'casey-reader', 'Reader')`);
    try {
      assert.equal((await inject(paths.iterList)).statusCode, 404);
      assert.equal((await inject(`/api/v1/projects/plan-p2/iterations`)).statusCode, 200);
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-p2-plan'; DELETE FROM projects WHERE id = 'plan-p2'`);
      for (const g of saved) await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('${g.id}', '${g.project_id}', 'casey-reader', '${g.role}') ON CONFLICT DO NOTHING`);
    }
  });

  it("cross-project work_item_link rows hidden from list total and payload", async () => {
    const before = dataOf(await inject(`${paths.wiList}?limit=100`)) as { items: { id: string }[]; total: number };
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('plan-hidden-p2', 'raby-family', 'Hidden') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('PLAN-HIDDEN', 'plan-hidden-p2', 'requirement', 'SECRET-WIL') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('PLAN-HIDDEN', 'PLAN-HIDDEN', 'plan-hidden-p2', 0, 'active', 's') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO work_item_links (id, project_id, requirement_version_uid, devops_id) VALUES ('wil-hidden-cross', '${P}', 'PLAN-HIDDEN', 'ADO-SECRET') ON CONFLICT DO NOTHING`);
    try {
      const after = dataOf(await inject(`${paths.wiList}?limit=100`)) as { items: { id: string }[]; total: number };
      assert.equal(after.total, before.total);
      assert.deepEqual(after.items, before.items);
      assert.ok(!JSON.stringify(after).includes("ADO-SECRET"));
    } finally {
      await q(`DELETE FROM work_item_links WHERE id = 'wil-hidden-cross'; DELETE FROM requirement_versions WHERE uid = 'PLAN-HIDDEN'; DELETE FROM requirement_lines WHERE base_uid = 'PLAN-HIDDEN'; DELETE FROM projects WHERE id = 'plan-hidden-p2'`);
    }
  });
});
