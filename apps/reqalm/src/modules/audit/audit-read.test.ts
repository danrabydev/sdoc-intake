import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { createTestApp, issueTestAccessToken, type TestApp } from "../../test/harness.js";
import { listRoutesForSecurityAudit } from "../../http/route-security.js";
import { ROLE_PERMISSIONS } from "../../rbac/enforce.js";
import { writeBusinessAudit } from "../../audit/business-audit.js";
import { writeAuthAudit } from "../../audit/auth-audit.js";

let ctx: TestApp;
let bearer: Record<string, string>;
const PROJ = (p: string) => `/api/v1/projects/${p}/audit-events`;
const PLATFORM = "/api/v1/audit-events";
const q = (sql: string, params?: unknown[]) => ctx.pool.query(sql, params);
const inject = (url: string, headers = bearer, method = "GET") =>
  ctx.app.inject({
    method,
    url,
    remoteAddress: "203.0.113.50",
    headers: { host: "localhost:3000", ...headers },
  } as never);
const dataOf = (res: { statusCode: number; json: () => unknown }) =>
  (assert.equal(res.statusCode, 200), (res.json() as { data: unknown }).data);
const stripReqId = (b: Record<string, unknown>) => (({ request_id: _, ...r }) => r)(b);
type InjectResponse = Awaited<ReturnType<typeof inject>>;
const VOLATILE = new Set(["date", "request-id"]);
const headersSansVolatile = (res: InjectResponse) => {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    if (VOLATILE.has(k.toLowerCase()) || v === undefined) continue;
    out[k] = Array.isArray(v) ? v.map(String) : typeof v === "number" ? String(v) : v;
  }
  return out;
};
const assert404Parity = (ref: InjectResponse, res: InjectResponse, label: string) => {
  assert.equal(res.statusCode, 404, label);
  assert.deepEqual(headersSansVolatile(res), headersSansVolatile(ref), label);
  assert.deepEqual(stripReqId(res.json() as Record<string, unknown>), stripReqId(ref.json() as Record<string, unknown>), label);
};

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  bearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
});
after(async () => {
  await ctx.close();
});

describe("audit route registration", () => {
  it("pins audit:read on projectScoped and listScope audit routes", () => {
    const routes = listRoutesForSecurityAudit(ctx.app).filter(
      (r) =>
        r.method === "GET" &&
        r.operationRoute &&
        (r.operationRef?.name === "audit.list_project" || r.operationRef?.name === "audit.list_platform"),
    );
    assert.equal(routes.length, 2);
    const project = routes.find((r) => r.operationRef?.name === "audit.list_project")!;
    const platform = routes.find((r) => r.operationRef?.name === "audit.list_platform")!;
    assert.equal(project.operationRef?.permission, "audit:read");
    assert.equal(project.operationRef?.projectScoped, true);
    assert.equal(platform.operationRef?.permission, "audit:read");
    assert.equal(platform.operationRef?.listScope, true);
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const routesSrc = readFileSync(path.join(dir, "routes.ts"), "utf8");
    assert.match(routesSrc, /permission: "audit:read"/);
    assert.match(routesSrc, /projectScoped: true/);
    assert.match(routesSrc, /listScope: true/);
  });

  it("Auditor role includes audit:read in the pinned role table", () => {
    assert.ok(ROLE_PERMISSIONS.Auditor?.has("audit:read"));
    assert.ok(ROLE_PERMISSIONS["Key custodian"]?.has("audit:read"));
  });
});

describe("audit read API", () => {
  it("sort order newest first with tie-break id", async () => {
    await q(
      `INSERT INTO audit_events (occurred_at, request_id, operation, outcome, identity_id, project_id, detail)
       VALUES ('2020-01-01T00:00:00Z', 'audit-sort-old', 'audit.test.old', 'allow', 'casey-reader', 'reqalm', '{}'::jsonb)`,
    );
    await q(
      `INSERT INTO audit_events (occurred_at, request_id, operation, outcome, identity_id, project_id, detail)
       VALUES ('2030-01-01T00:00:00Z', 'audit-sort-new', 'audit.test.new', 'allow', 'casey-reader', 'reqalm', '{}'::jsonb)`,
    );
    const page = dataOf(await inject(`${PROJ("reqalm")}?limit=50&actor=casey-reader`)) as {
      items: { action: string; id: string }[];
    };
    const actions = page.items.filter((i) => i.action.startsWith("audit.test.")).map((i) => i.action);
    assert.deepEqual(actions.slice(0, 2), ["audit.test.new", "audit.test.old"]);
  });

  it("paging with positive offset and filter params", async () => {
    for (let i = 0; i < 3; i++) {
      await writeBusinessAudit(ctx.pool, {
        requestId: `audit-page-${i}`,
        operation: "audit.page.sample",
        outcome: "allow",
        identityId: "casey-reader",
        projectId: "reqalm",
        targetType: "requirement",
        detail: { idx: i },
      });
    }
    const full = dataOf(await inject(`${PROJ("reqalm")}?limit=10&action=audit.page.sample`)) as {
      items: unknown[];
      total: number;
    };
    assert.ok(full.total >= 3);
    const page1 = dataOf(await inject(`${PROJ("reqalm")}?limit=1&offset=1&action=audit.page.sample`)) as {
      items: { detail: { idx: number } }[];
      total: number;
    };
    assert.equal(page1.items.length, 1);
    assert.equal(page1.total, full.total);
    const empty = dataOf(await inject(`${PROJ("reqalm")}?limit=2&offset=9999&action=audit.page.sample`)) as {
      items: unknown[];
    };
    assert.equal(empty.items.length, 0);
  });

  it("redacts secrets and session ids in event detail", async () => {
    await writeBusinessAudit(ctx.pool, {
      requestId: "audit-redact-row",
      operation: "audit.redact.sample",
      outcome: "allow",
      identityId: "casey-reader",
      projectId: "reqalm",
      detail: { refresh_token: "abc", session_id: "hide-me", note: "visible" },
    });
    const page = dataOf(await inject(`${PROJ("reqalm")}?limit=5&action=audit.redact.sample`)) as {
      items: { detail: Record<string, unknown> }[];
    };
    const detail = page.items[0]!.detail;
    assert.equal(detail.refresh_token, "[REDACTED]");
    assert.equal(detail.note, "visible");
    assert.equal("session_id" in detail, false);
    const body = JSON.stringify(page);
    assert.ok(!body.includes("hide-me") && !body.includes("abc"));
  });

  it("malformed project id and query params: 404 vs 400 with audit", async () => {
    assert.equal((await inject(PROJ("Not_A_Slug"))).statusCode, 404);
    assert.equal((await inject(`${PROJ("reqalm")}?actor=!!bad!!`)).statusCode, 400);
    assert.equal((await inject(`${PROJ("reqalm")}?action=INVALID`)).statusCode, 400);
    assert.equal((await inject(`${PROJ("reqalm")}?target_type=Bad-Type`)).statusCode, 400);
    assert.equal((await inject(`${PROJ("reqalm")}?from=not-a-time`)).statusCode, 400);
    const wide = await inject(
      `${PROJ("reqalm")}?from=2020-01-01T00:00:00Z&to=2021-06-01T00:00:00Z`,
    );
    assert.equal(wide.statusCode, 400);
    const bad = await inject(`${PROJ("reqalm")}?actor=!!bad!!`, { ...bearer, "x-request-id": "audit-bad-q" });
    assert.equal(bad.statusCode, 400);
    assert.equal(
      (await q(`SELECT outcome FROM audit_events WHERE request_id = 'audit-bad-q'`)).rows[0]?.outcome,
      "error",
    );
  });

  it("missing, forbidden, and cross-project leak share 404", async () => {
    const ref = await inject(PROJ("no-such-project-slug"));
    assert.equal(ref.statusCode, 404);
    await writeBusinessAudit(ctx.pool, {
      requestId: "audit-leak-p2",
      operation: "audit.leak.secret",
      outcome: "allow",
      identityId: "casey-reader",
      projectId: "audit-leak-p2",
      detail: { secret: "LEAK-SECRET-P2" },
    });
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('audit-leak-p2', 'reqalm-client', 'P2') ON CONFLICT DO NOTHING`);
    try {
      const list = dataOf(await inject(`${PROJ("reqalm")}?limit=100`)) as { items: { project_id: string | null; detail: unknown }[] };
      const payload = JSON.stringify(list.items);
      assert.ok(!payload.includes("LEAK-SECRET-P2"));
      assert.ok(!payload.includes("audit.leak.secret"));
      assert.ok(list.items.every((i) => i.project_id === "reqalm" || i.project_id === null));
      assert404Parity(ref, await inject(PROJ("no-such-project-slug")), "missing");
    } finally {
      await q(`DELETE FROM projects WHERE id = 'audit-leak-p2'`);
    }
    const saved = (await q(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`)).rows as {
      id: string;
      role: string;
    }[];
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await q(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-no-audit-role', 'reqalm', 'casey-reader', 'NoAuditFixtureRole')`,
    );
    try {
      assert404Parity(ref, await inject(PROJ("reqalm")), "forbidden-no-audit-perm");
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-no-audit-role'`);
      for (const g of saved) {
        await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, 'reqalm', 'casey-reader', $2) ON CONFLICT DO NOTHING`, [
          g.id,
          g.role,
        ]);
      }
    }
  });

  it("platform route requires platform grant; project grant alone is 404", async () => {
    const ref = await inject(PLATFORM);
    assert.equal(ref.statusCode, 404);
    await q(
      `INSERT INTO platform_grants (id, identity_id, role) VALUES ('plat-casey-sec-audit', 'casey-reader', 'Security') ON CONFLICT DO NOTHING`,
    );
    try {
      await writeAuthAudit(ctx.pool, {
        eventType: "login.local",
        outcome: "success",
        identityId: "casey-reader",
        ip: "198.51.100.77",
        detail: { session_id: "sess-platform", refresh_token: "tok" },
      });
      await writeBusinessAudit(ctx.pool, {
        requestId: "audit-platform-null",
        operation: "key.rotate",
        outcome: "allow",
        identityId: "casey-reader",
        projectId: null,
        detail: {},
      });
      const plat = dataOf(
        await inject(`${PLATFORM}?limit=20&action=login.local`),
      ) as { items: { source: string; action: string; client_ip: string | null; detail: Record<string, unknown> }[] };
      const authRow = plat.items.find((i) => i.source === "auth" && i.action === "login.local" && i.client_ip === "198.51.100.77")!;
      assert.ok(authRow);
      assert.equal(authRow.client_ip, "198.51.100.77");
      assert.equal("session_id" in authRow.detail, false);
      assert.equal(authRow.detail.refresh_token, "[REDACTED]");
      await q(`DELETE FROM platform_grants WHERE id = 'plat-casey-sec-audit'`);
      assert.equal((await inject(PLATFORM, bearer)).statusCode, 404);
      assert404Parity(ref, await inject(PLATFORM, bearer), "platform-no-grant");
    } finally {
      await q(`DELETE FROM platform_grants WHERE id = 'plat-casey-sec-audit'`);
    }
  });

  it("write verbs on audit paths return 404 or 405 only", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      for (const url of [PROJ("reqalm"), PLATFORM]) {
        const res = await inject(url, bearer, method);
        assert.ok(res.statusCode === 404 || res.statusCode === 405, `${method} ${url} -> ${res.statusCode}`);
      }
    }
  });

  it("payloads omit cyber_gate and gate_signoffs", async () => {
    const body = JSON.stringify(await inject(`${PROJ("reqalm")}?limit=1`).then((r) => r.json()));
    assert.ok(!body.includes("cyber_gate") && !body.includes("gate_signoffs"));
  });

  it("audit row on allow for project list", async () => {
    const res = await inject(PROJ("reqalm") + "?limit=1", { ...bearer, "x-request-id": "audit-allow-proj" });
    assert.equal(res.statusCode, 200);
    const row = (await q(`SELECT operation, outcome, project_id FROM audit_events WHERE request_id = 'audit-allow-proj'`)).rows[0];
    assert.deepEqual(row, { operation: "audit.list_project", outcome: "allow", project_id: "reqalm" });
  });
});
