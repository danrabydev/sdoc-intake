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

async function captureAppLogs(fn: () => Promise<void>): Promise<string> {
  const log = ctx.app.log as unknown as Record<symbol, { write: (s: string) => unknown }>;
  const sym = Object.getOwnPropertySymbols(log).find((s) => s.description === "pino.stream");
  assert.ok(sym, "pino stream symbol");
  const stream = log[sym!]!;
  const original = stream.write;
  let captured = "";
  stream.write = function (this: unknown, chunk: string) {
    captured += chunk;
    return original.call(this, chunk);
  };
  try {
    await fn();
  } finally {
    stream.write = original;
  }
  return captured;
}

async function insertBizIds(ids: { id: number; req: string; op: string; projectId: string | null }) {
  await q(
    `INSERT INTO audit_events (id, occurred_at, request_id, operation, outcome, identity_id, project_id, detail)
     VALUES ($1, now(), $2, $3, 'allow', 'casey-reader', $4, '{}'::jsonb)`,
    [ids.id, ids.req, ids.op, ids.projectId],
  );
}

async function bumpAuditSeq() {
  await q(`SELECT setval(pg_get_serial_sequence('audit_events', 'id'), (SELECT COALESCE(max(id), 1) FROM audit_events))`);
}

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
    const svc = readFileSync(path.join(dir, "audit.service.ts"), "utf8");
    assert.match(svc, /project_id IS NULL/);
  });

  it("Auditor role includes audit:read in the pinned role table", () => {
    assert.ok(ROLE_PERMISSIONS.Auditor?.has("audit:read"));
    assert.ok(ROLE_PERMISSIONS["Key custodian"]?.has("audit:read"));
  });
});

describe("audit read API", () => {
  it("sort order newest first with numeric id tie-break on project route", async () => {
    await q(
      `WITH t AS (SELECT now() AS ts)
       INSERT INTO audit_events (id, occurred_at, request_id, operation, outcome, identity_id, project_id, detail)
       SELECT 999999999, ts, 'audit-tie-lo', 'audit.tie.project', 'allow', 'casey-reader', 'reqalm', '{}'::jsonb FROM t
       UNION ALL
       SELECT 1000000000, ts, 'audit-tie-hi', 'audit.tie.project', 'allow', 'casey-reader', 'reqalm', '{}'::jsonb FROM t`,
    );
    await bumpAuditSeq();
    const page = dataOf(await inject(`${PROJ("reqalm")}?limit=5&action=audit.tie.project`)) as {
      items: { id: string }[];
    };
    assert.deepEqual(
      page.items.map((i) => i.id),
      ["b:1000000000", "b:999999999"],
    );
  });

  it("project route orders by occurred_at before id tie-break", async () => {
    const inserted = (await q(
      `WITH mx AS (SELECT COALESCE(max(id), 0)::bigint AS v FROM audit_events),
            ins AS (
              INSERT INTO audit_events (id, occurred_at, request_id, operation, outcome, identity_id, project_id, detail)
              SELECT mx.v + 20, now() - interval '2 days', 'audit-time-old', 'audit.time.project', 'allow', 'casey-reader', 'reqalm', '{}'::jsonb FROM mx
              UNION ALL
              SELECT mx.v + 10, now(), 'audit-time-new', 'audit.time.project', 'allow', 'casey-reader', 'reqalm', '{}'::jsonb FROM mx
              RETURNING id, request_id, occurred_at
            )
       SELECT id, request_id, occurred_at FROM ins ORDER BY occurred_at DESC`,
    )).rows as { id: string; request_id: string }[];
    await bumpAuditSeq();
    const page = dataOf(await inject(`${PROJ("reqalm")}?limit=5&action=audit.time.project`)) as {
      items: { id: string; occurred_at: string }[];
    };
    assert.equal(page.items.length, 2);
    assert.equal(page.items[0]!.id, `b:${inserted[0]!.id}`);
    assert.equal(page.items[1]!.id, `b:${inserted[1]!.id}`);
    assert.equal(inserted[0]!.request_id, "audit-time-new");
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
    assert.equal((await inject(PROJ("REQALM"))).statusCode, 404);
    assert.equal((await inject(`${PROJ("reqalm")}?from=2026-01-01&to=2026-02-01T00:00:00Z`)).statusCode, 400);
    assert.equal((await inject(`${PROJ("reqalm")}?to=2026-01-01`)).statusCode, 400);
    assert.equal((await inject(`${PROJ("reqalm")}?actor=${encodeURIComponent("!!bad!!")}`)).statusCode, 400);
    assert.equal((await inject(`${PROJ("reqalm")}?action=INVALID`)).statusCode, 400);
    assert.equal((await inject(`${PROJ("reqalm")}?target_type=Bad-Type`)).statusCode, 400);
    assert.equal((await inject(`${PROJ("reqalm")}?from=not-a-time`)).statusCode, 400);
    assert.equal(
      (await inject(`${PROJ("reqalm")}?from=2026-01-01T00:00:00.000Z&to=2026-04-01T00:00:01.000Z`)).statusCode,
      400,
    );
    assert.equal(
      (await inject(`${PROJ("reqalm")}?from=2026-01-01T00:00:00.000Z&to=2026-04-01T00:00:00.000Z`)).statusCode,
      200,
    );
    const bad = await inject(`${PROJ("reqalm")}?actor=${encodeURIComponent("!!bad!!")}`, {
      ...bearer,
      "x-request-id": "audit-bad-q",
    });
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

  it("defaults to the last 90 days when from and to are omitted", async () => {
    await q(
      `INSERT INTO audit_events (occurred_at, request_id, operation, outcome, identity_id, project_id, detail)
       VALUES ('2010-01-01T00:00:00Z', 'audit-old-default', 'audit.default.window', 'allow', 'casey-reader', 'reqalm', '{}'::jsonb)`,
    );
    await q(
      `INSERT INTO audit_events (occurred_at, request_id, operation, outcome, identity_id, project_id, detail)
       VALUES (now(), 'audit-fresh-default', 'audit.default.window', 'allow', 'casey-reader', 'reqalm', '{}'::jsonb)`,
    );
    const page = dataOf(await inject(`${PROJ("reqalm")}?limit=50&action=audit.default.window`)) as {
      items: { id: string }[];
    };
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]!.id.startsWith("b:"), true);
  });

  it("platform route excludes project-scoped business rows", async () => {
    await q(
      `INSERT INTO platform_grants (id, identity_id, role) VALUES ('plat-casey-kc-scope', 'casey-reader', 'Key custodian') ON CONFLICT DO NOTHING`,
    );
    try {
      await insertBizIds({ id: 901, req: "audit-scope-proj", op: "audit.scope.filter", projectId: "reqalm" });
      await insertBizIds({ id: 902, req: "audit-scope-plat", op: "audit.scope.filter", projectId: null });
      await bumpAuditSeq();
      const page = dataOf(await inject(`${PLATFORM}?limit=20&action=audit.scope.filter`)) as {
        items: { project_id: string | null; id: string }[];
      };
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0]!.project_id, null);
      assert.equal(page.items[0]!.id, "b:902");
    } finally {
      await q(`DELETE FROM platform_grants WHERE id = 'plat-casey-kc-scope'`);
    }
  });

  it("platform sort uses numeric id tie-break", async () => {
    await q(
      `INSERT INTO platform_grants (id, identity_id, role) VALUES ('plat-casey-kc-sort', 'casey-reader', 'Key custodian') ON CONFLICT DO NOTHING`,
    );
    try {
      await q(
        `WITH t AS (SELECT now() AS ts)
         INSERT INTO auth_audit_events (id, occurred_at, event_type, outcome, identity_id, ip, detail)
         SELECT 999999999, ts, 'audit.platform.tie', 'success', 'casey-reader', '203.0.113.9', '{}'::jsonb FROM t
         UNION ALL
         SELECT 1000000000, ts, 'audit.platform.tie', 'success', 'casey-reader', '203.0.113.10', '{}'::jsonb FROM t`,
      );
      await q(`SELECT setval(pg_get_serial_sequence('auth_audit_events', 'id'), (SELECT max(id) FROM auth_audit_events))`);
      const page = dataOf(await inject(`${PLATFORM}?limit=5&action=audit.platform.tie`)) as { items: { id: string }[] };
      assert.deepEqual(
        page.items.map((i) => i.id),
        ["a:1000000000", "a:999999999"],
      );
    } finally {
      await q(`DELETE FROM platform_grants WHERE id = 'plat-casey-kc-sort'`);
    }
  });

  it("platform route orders by occurred_at before id tie-break", async () => {
    await q(
      `INSERT INTO platform_grants (id, identity_id, role) VALUES ('plat-casey-kc-time', 'casey-reader', 'Key custodian') ON CONFLICT DO NOTHING`,
    );
    try {
      const inserted = (await q(
        `WITH mx AS (SELECT COALESCE(max(id), 0)::bigint AS v FROM auth_audit_events),
              ins AS (
                INSERT INTO auth_audit_events (id, occurred_at, event_type, outcome, identity_id, ip, detail)
                SELECT mx.v + 20, now() - interval '2 days', 'audit.platform.time', 'success', 'casey-reader', '203.0.113.1', '{}'::jsonb FROM mx
                UNION ALL
                SELECT mx.v + 10, now(), 'audit.platform.time', 'success', 'casey-reader', '203.0.113.2', '{}'::jsonb FROM mx
                RETURNING id, occurred_at
              )
         SELECT id, occurred_at FROM ins ORDER BY occurred_at DESC`,
      )).rows as { id: string }[];
      await q(`SELECT setval(pg_get_serial_sequence('auth_audit_events', 'id'), (SELECT max(id) FROM auth_audit_events))`);
      const page = dataOf(await inject(`${PLATFORM}?limit=5&action=audit.platform.time`)) as {
        items: { id: string; occurred_at: string }[];
      };
      assert.equal(page.items.length, 2);
      assert.equal(page.items[0]!.id, `a:${inserted[0]!.id}`);
      assert.equal(page.items[1]!.id, `a:${inserted[1]!.id}`);
      assert.ok(Number(inserted[0]!.id) < Number(inserted[1]!.id));
    } finally {
      await q(`DELETE FROM platform_grants WHERE id = 'plat-casey-kc-time'`);
    }
  });

  it("project-level Auditor cannot use the platform route (404)", async () => {
    const saved = (await q(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`)).rows as {
      id: string;
      role: string;
    }[];
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await q(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-auditor-proj-only', 'reqalm', 'casey-reader', 'Auditor')`,
    );
    try {
      assert.equal((await inject(PLATFORM)).statusCode, 404);
      assert.equal((await inject(PROJ("reqalm") + "?limit=1")).statusCode, 200);
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-auditor-proj-only'`);
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

  it("platform Auditor sees auth client_ip null; Security sees raw ip", async () => {
    await writeAuthAudit(ctx.pool, {
      eventType: "audit.ip.policy",
      outcome: "success",
      identityId: "casey-reader",
      ip: "203.0.113.44",
      detail: {},
    });
    await q(
      `INSERT INTO platform_grants (id, identity_id, role) VALUES ('plat-auditor-ip', 'casey-reader', 'Auditor') ON CONFLICT DO NOTHING`,
    );
    try {
      const aud = dataOf(await inject(`${PLATFORM}?limit=5&action=audit.ip.policy`)) as {
        items: { client_ip: string | null }[];
      };
      assert.equal(aud.items[0]?.client_ip, null);
    } finally {
      await q(`DELETE FROM platform_grants WHERE id = 'plat-auditor-ip'`);
    }
    await q(
      `INSERT INTO platform_grants (id, identity_id, role) VALUES ('plat-sec-ip', 'casey-reader', 'Security') ON CONFLICT DO NOTHING`,
    );
    try {
      const sec = dataOf(await inject(`${PLATFORM}?limit=5&action=audit.ip.policy`)) as {
        items: { client_ip: string | null }[];
      };
      assert.equal(sec.items[0]?.client_ip, "203.0.113.44");
    } finally {
      await q(`DELETE FROM platform_grants WHERE id = 'plat-sec-ip'`);
    }
  });

  it("redacts invalid query params in request logs", async () => {
    const badActor = encodeURIComponent("!!bad!!");
    const logs = await captureAppLogs(async () => {
      assert.equal((await inject(`${PROJ("reqalm")}?actor=${badActor}`)).statusCode, 400);
    });
    assert.ok(logs.includes("audit-events"));
    assert.ok(!logs.includes("!!bad!!"));
    assert.ok(!logs.includes(badActor));
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
