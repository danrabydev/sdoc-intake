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
const BASE = (p: string) => `/api/v1/projects/${p}/workflow`;
const PROFILE = (p: string) => `${BASE(p)}/profile`;
const PROFILES = (p: string) => `${BASE(p)}/profiles`;
const PROF = (p: string, id: string) => `${PROFILES(p)}/${id}`;
const GATES = (p: string) => `${BASE(p)}/gates`;
const GATE = (p: string, id: string) => `${GATES(p)}/${id}`;
const HOOKS = (p: string) => `${BASE(p)}/action-hooks`;
const HOOK = (p: string, id: string) => `${HOOKS(p)}/${id}`;
const KINDS = (p: string) => `${BASE(p)}/subject-kinds`;
const KIND = (p: string, id: string) => `${KINDS(p)}/${id}`;
const BINDINGS = (p: string) => `${BASE(p)}/role-bindings`;
const BINDING = (p: string, id: string) => `${BINDINGS(p)}/${id}`;
const RECORDS = (p: string) => `${BASE(p)}/approval-records`;
const RECORD = (p: string, id: string) => `${RECORDS(p)}/${id}`;
const LINE = (p: string, base: string) => `${BASE(p)}/lines/${base}/approval`;

const q = (sql: string) => ctx!.pool.query(sql);
const inject = (url: string, headers = bearer) =>
  ctx!.app.inject({ method: "GET", url, remoteAddress: "203.0.113.50", headers: { host: "localhost:3000", ...headers } } as never);
const dataOf = (res: { statusCode: number; json: () => unknown }) => (assert.equal(res.statusCode, 200), (res.json() as { data: unknown }).data);
type InjectResponse = Awaited<ReturnType<typeof inject>>;
const VOLATILE_RESPONSE_HEADERS = new Set(["date", "request-id", "content-length"]);
const comparableResponseHeaders = (res: InjectResponse) => {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(res.headers)) {
    if (VOLATILE_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.map(String) : typeof value === "number" ? String(value) : value;
  }
  return out;
};
const stripReqId = (b: Record<string, unknown>) => (({ request_id: _, ...r }) => r)(b);
const assert404Parity = (ref: InjectResponse, res: InjectResponse, url: string) => {
  assert.equal(res.statusCode, 404, url);
  assert.deepEqual(comparableResponseHeaders(res), comparableResponseHeaders(ref), url);
  assert.deepEqual(stripReqId(res.json() as Record<string, unknown>), stripReqId(ref.json() as Record<string, unknown>), url);
};

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
});
after(async () => {
  await ctx?.close();
});

describe("workflow route registration", () => {
  it("pins projectScoped workflow:read on every workflow operation route", () => {
    const routes = listRoutesForSecurityAudit(ctx!.app).filter((r) => r.url.includes("/workflow"));
    assert.ok(routes.length >= 10);
    for (const r of routes) {
      assert.equal(r.operationRoute, true, r.url);
      assert.equal(r.operationRef?.permission, "workflow:read", r.url);
      assert.equal(r.operationRef?.projectScoped, true, r.url);
    }
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const svc = readFileSync(path.join(dir, "workflow.service.ts"), "utf8");
    const routesSrc = readFileSync(path.join(dir, "routes.ts"), "utf8");
    assert.match(svc, /project_id = \$1/);
    assert.match(routesSrc, /permission: "workflow:read"/);
    assert.match(routesSrc, /permissionDeniedAsNotFound: true/);
  });
});

describe("workflow read API", () => {
  it("project profile, gates sort, hooks, kinds; no gate_signoffs in payloads", async () => {
    const prof = dataOf(await inject(PROFILE("reqalm"))) as {
      workflow_profile_id: string;
      profile: { id: string; gate_ids: string[] };
    };
    assert.equal(prof.workflow_profile_id, "wf-commercial-default");
    assert.equal(prof.profile.id, "wf-commercial-default");
    assert.ok(prof.profile.gate_ids.includes("gate-line-approved"));

    const gates = dataOf(await inject(`${GATES("reqalm")}?limit=100`)) as { items: { id: string }[]; total: number };
    assert.equal(gates.total, 12);
    assert.deepEqual(
      gates.items.map((g) => g.id),
      [...gates.items.map((g) => g.id)].sort(),
    );

    const hooks = dataOf(await inject(`${HOOKS("reqalm")}?limit=100`)) as { items: { id: string }[]; total: number };
    assert.equal(hooks.total, 12);
    assert.deepEqual(
      hooks.items.map((h) => h.id),
      [...hooks.items.map((h) => h.id)].sort(),
    );

    const kinds = dataOf(await inject(`${KINDS("reqalm")}?limit=100`)) as { items: { id: string }[]; total: number };
    assert.equal(kinds.total, 7);
    assert.deepEqual(
      kinds.items.map((k) => k.id),
      [...kinds.items.map((k) => k.id)].sort(),
    );

    const gateRes = await inject(GATE("reqalm", "gate-line-approved"));
    const body = JSON.stringify(gateRes.json());
    assert.ok(!body.includes("gate_signoffs") && !body.includes("cyber_gate"));
  });

  it("profiles list paging with positive offset; profile detail", async () => {
    const all = dataOf(await inject(`${PROFILES("reqalm")}?limit=100`)) as { items: { id: string }[]; total: number };
    assert.equal(all.total, 2);
    const page = dataOf(await inject(`${PROFILES("reqalm")}?limit=1&offset=1`)) as {
      items: { id: string }[];
      total: number;
    };
    assert.equal(page.total, 2);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.id, "wf-dod-cyber");
    const detail = dataOf(await inject(PROF("reqalm", "wf-commercial-default"))) as { scope: string; project_id: string };
    assert.equal(detail.scope, "project");
    assert.equal(detail.project_id, "reqalm");
  });

  it("role bindings and approval records paging edges", async () => {
    const bindings = dataOf(await inject(`${BINDINGS("reqalm")}?limit=100`)) as { items: unknown[]; total: number };
    assert.equal(bindings.total, 9);
    const off = dataOf(await inject(`${BINDINGS("reqalm")}?limit=2&offset=2`)) as { items: { id: string }[]; total: number };
    assert.equal(off.total, 9);
    assert.equal(off.items.length, 2);

    const recs = dataOf(await inject(`${RECORDS("reqalm")}?limit=100`)) as { items: { base_uid: string }[]; total: number };
    assert.equal(recs.total, 99);
    const sorted = [...recs.items.map((r) => r.base_uid)].sort();
    assert.deepEqual(recs.items.map((r) => r.base_uid), sorted);

    assert.equal((await inject(`${RECORDS("reqalm")}?limit=101`)).statusCode, 400);
    const empty = dataOf(await inject(`${RECORDS("reqalm")}?limit=2&offset=200`)) as { items: unknown[]; total: number };
    assert.equal(empty.total, 99);
    assert.equal(empty.items.length, 0);

    const line = dataOf(await inject(LINE("reqalm", "A01"))) as {
      base_uid: string;
      approval: { status: string; id: string } | null;
    };
    assert.equal(line.base_uid, "A01");
    assert.equal(line.approval?.status, "approved");
    assert.equal(line.approval?.id, "ar-a01");
  });

  it("cross-project profile and record paths return 404", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('wf-p2', 'reqalm-client', 'P2') ON CONFLICT DO NOTHING`);
    const ref = await inject(PROF("wf-p2", "wf-commercial-default"));
    assert.equal(ref.statusCode, 404);
    try {
      assert404Parity(ref, await inject(RECORD("wf-p2", "ar-a01")), "cross project record");
      assert404Parity(ref, await inject(LINE("wf-p2", "A01")), "cross project line");
    } finally {
      await q(`DELETE FROM projects WHERE id = 'wf-p2'`);
    }
  });

  it("workflow:read grant on p2 only yields 404 on reqalm workflow routes", async () => {
    const saved = (await q(`SELECT id, project_id, role FROM project_grants WHERE identity_id = 'casey-reader'`)).rows as {
      id: string;
      project_id: string;
      role: string;
    }[];
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader'`);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('wf-p2', 'reqalm-client', 'P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-wf-p2', 'wf-p2', 'casey-reader', 'Reader')`);
    try {
      assert.equal((await inject(PROFILE("reqalm"))).statusCode, 404);
      assert.equal((await inject(GATES("reqalm"))).statusCode, 404);
      assert.equal((await inject(PROFILE("wf-p2"))).statusCode, 200);
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-wf-p2'`);
      await q(`DELETE FROM projects WHERE id = 'wf-p2'`);
      for (const g of saved) {
        await q(
          `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('${g.id}', '${g.project_id}', 'casey-reader', '${g.role}') ON CONFLICT DO NOTHING`,
        );
      }
    }
  });

  it("missing, forbidden, and bad ids share 404/400 with header parity", async () => {
    assert.equal((await inject(GATE("reqalm", "gate-no-such"))).statusCode, 404);
    const saved = (await q(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`)).rows as {
      id: string;
      role: string;
    }[];
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-wf', 'reqalm', 'casey-reader', 'Key custodian')`);
    try {
      const ref = await inject(GATES("reqalm"));
      assert.equal(ref.statusCode, 404);
      for (const url of [GATES("reqalm"), GATE("reqalm", "gate-line-approved"), RECORD("reqalm", "ar-a01")]) {
        assert404Parity(ref, await inject(url), url);
      }
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-kc-wf'`);
      for (const g of saved) await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('${g.id}', 'reqalm', 'casey-reader', '${g.role}') ON CONFLICT DO NOTHING`);
    }

    resetTelemetrySpans();
    for (const url of [GATE("reqalm", "!!bad!!"), GATE("reqalm", `a${"b".repeat(64)}`)]) {
      assert.equal((await inject(url)).statusCode, 400, url);
    }
    assert.equal((await inject(PROFILE("Not_A_Slug"))).statusCode, 404);
    assert.ok(finishedSpans().some((s) => String(s.attributes["url.path"] ?? "").includes("/workflow/gates/[invalid]")));
  });
});
