import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { createTestApp, issueTestAccessToken, type TestApp } from "../../test/harness.js";
import { finishedSpans, resetTelemetrySpans } from "../../test/otel-testing.js";
import { listRoutesForSecurityAudit } from "../../http/route-security.js";
import { ROLE_PERMISSIONS } from "../../rbac/enforce.js";
import { assertAccessDtoHygiene } from "./access.dto.test.js";

let ctx: TestApp | undefined;
let bearer: Record<string, string>;
const PEOPLE = (p: string) => `/api/v1/projects/${p}/access/people`;
const PGRANTS = (p: string) => `/api/v1/projects/${p}/access/grants`;
const CGRANTS = (c: string) => `/api/v1/clients/${c}/access/grants`;
const ROLES = "/api/v1/access/roles";
const PLATFORM = "/api/v1/access/platform-grants";
const q = (sql: string, params?: unknown[]) => ctx!.pool.query(sql, params);
const inject = (url: string, headers = bearer) =>
  ctx!.app.inject({ method: "GET", url, remoteAddress: "203.0.113.50", headers: { host: "localhost:3000", ...headers } } as never);
const dataOf = (res: { statusCode: number; json: () => unknown }) => (assert.equal(res.statusCode, 200), (res.json() as { data: unknown }).data);
type InjectResponse = Awaited<ReturnType<typeof inject>>;
const stripReqId = (b: Record<string, unknown>) => (({ request_id: _, ...r }) => r)(b);
const hdrs = (res: InjectResponse) => {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    if (k === "date" || k === "request-id" || v === undefined) continue;
    out[k] = Array.isArray(v) ? v.map(String) : String(v);
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

describe("access route registration", () => {
  it("pins projectScoped or listScope grant:read on every access operation route", () => {
    const routes = listRoutesForSecurityAudit(ctx!.app).filter((r) => r.url.includes("/access"));
    assert.ok(routes.length >= 5);
    for (const r of routes) {
      assert.equal(r.operationRoute, true, r.url);
      assert.equal(r.operationRef?.permission, "grant:read", r.url);
    }
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const svc = readFileSync(path.join(dir, "access.service.ts"), "utf8");
    const routesSrc = readFileSync(path.join(dir, "routes.ts"), "utf8");
    assert.match(svc, /pg\.project_id = \$1/);
    assert.match(svc, /revoked_at IS NULL/);
    assert.match(svc, /callerHasPlatformGrant/);
    assert.match(routesSrc, /permission: "grant:read"/);
    assert.match(routesSrc, /permissionDeniedAsNotFound: true/);
  });
});

describe("access read API", () => {
  it("people sort, aggregated roles, and DTO hygiene", async () => {
    const page = dataOf(await inject(`${PEOPLE("reqalm")}?limit=100`)) as {
      items: { id: string; display_name: string; roles: string[] }[];
      total: number;
    };
    assert.equal(page.total, 10);
    const names = page.items.map((i) => i.display_name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    const dan = page.items.find((i) => i.id === "dan")!;
    assert.deepEqual(dan.roles.sort(), ["Author", "Project admin"]);
    assertAccessDtoHygiene(page);
    const body = JSON.stringify((await inject(`${PEOPLE("reqalm")}?limit=1&offset=1`)).json());
    assert.ok(!body.includes("cyber_gate") && !body.includes("gate_signoffs"));
  });

  it("project grants paging edges and sort by role then id", async () => {
    assert.equal((await inject(`${PGRANTS("reqalm")}?limit=101`)).statusCode, 400);
    const all = dataOf(await inject(`${PGRANTS("reqalm")}?limit=100`)) as {
      items: { id: string; role: string }[];
      total: number;
    };
    assert.equal(all.total, 12);
    const sorted = [...all.items].sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id));
    assert.deepEqual(all.items, sorted);
    const off = dataOf(await inject(`${PGRANTS("reqalm")}?limit=2&offset=2`)) as { items: unknown[] };
    assert.equal(off.items.length, 2);
    assert.equal((dataOf(await inject(`${PGRANTS("reqalm")}?limit=1&offset=99`)) as { items: unknown[] }).items.length, 0);
    assertAccessDtoHygiene(all);
  });

  it("client grants for raby-family and cross-client denial", async () => {
    const grants = dataOf(await inject(`${CGRANTS("raby-family")}?limit=10`)) as {
      items: { role: string; person: { id: string } }[];
      total: number;
    };
    assert.equal(grants.total, 1);
    assert.equal(grants.items[0]?.role, "Client admin");
    assert.equal(grants.items[0]?.person.id, "pat-client-admin");
    assert.equal((await inject(CGRANTS("other-family"))).statusCode, 404);
    assertAccessDtoHygiene(grants);
  });

  it("role catalog lists permissions sorted", async () => {
    const roles = dataOf(await inject(`${ROLES}?limit=100`)) as {
      items: { name: string; permissions: string[] }[];
      total: number;
    };
    assert.equal(roles.total, Object.keys(ROLE_PERMISSIONS).length);
    const reader = roles.items.find((r) => r.name === "Reader")!;
    assert.ok(reader.permissions.includes("grant:read"));
    assert.deepEqual(reader.permissions, [...reader.permissions].sort());
    assertAccessDtoHygiene(roles);
  });

  it("platform grants hidden from non-platform callers; visible when caller holds a platform grant", async () => {
    assert.equal((await inject(PLATFORM)).statusCode, 404);
    await q(
      `INSERT INTO platform_grants (id, identity_id, role) VALUES ('pgrant-casey-temp-plat', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`,
    );
    try {
      const plat = dataOf(await inject(`${PLATFORM}?limit=10`)) as {
        items: { role: string; person: { display_name: string } }[];
        total: number;
      };
      assert.ok(plat.total >= 1);
      assert.ok(plat.items.some((g) => g.role === "Key custodian"));
      const raw = JSON.stringify(plat);
      assert.ok(!raw.includes("password_hash") && !raw.includes("mfa_secret"));
      assertAccessDtoHygiene(plat);
    } finally {
      await q(`DELETE FROM platform_grants WHERE id = 'pgrant-casey-temp-plat'`);
    }
  });

  it("cross-project leak and 404 parity on every project route", async () => {
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('acc-p2', 'raby-family', 'P2') ON CONFLICT DO NOTHING`);
    await q(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-acc-secret', 'acc-p2', 'alex-author', 'Author') ON CONFLICT DO NOTHING`,
    );
    try {
      const people = dataOf(await inject(`${PEOPLE("reqalm")}?limit=100`)) as { total: number };
      assert.equal(people.total, 10);
      const ref = await inject(PEOPLE("no-such-project"));
      assert.equal(ref.statusCode, 404);
      for (const url of [PEOPLE("acc-p2"), PGRANTS("acc-p2")]) {
        assert404Parity(ref, await inject(url), url);
      }
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-acc-secret'`);
      await q(`DELETE FROM projects WHERE id = 'acc-p2'`);
    }
    const refDeny = await inject(PEOPLE("no-such-project"));
    assert.equal(refDeny.statusCode, 404);
    const saved = (await q(`SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`)).rows as {
      id: string;
      role: string;
    }[];
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-acc', 'reqalm', 'casey-reader', 'Key custodian')`);
    try {
      for (const url of [PEOPLE("reqalm"), PGRANTS("reqalm")]) {
        assert404Parity(refDeny, await inject(url), url);
      }
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-kc-acc'`);
      for (const g of saved) await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, 'reqalm', 'casey-reader', $2) ON CONFLICT DO NOTHING`, [g.id, g.role]);
    }
  });

  it("malformed projectId: not_found parity, redaction, and paging validation 400", async () => {
    resetTelemetrySpans();
    assert.equal((await inject(PEOPLE("Not_A_Slug"))).statusCode, 404);
    assert.equal((await inject(PEOPLE("!!bad!!"))).statusCode, 404);
    assert.equal((await inject(`${PEOPLE("reqalm")}?limit=101`)).statusCode, 400);
    assert.ok(finishedSpans().some((s) => String(s.attributes["url.path"] ?? "").includes("/projects/[invalid]/")));
  });

  it("regression: grant:read on p2 only returns 404 on reqalm access routes", async () => {
    const saved = (await q(`SELECT id, project_id, role FROM project_grants WHERE identity_id = 'casey-reader'`)).rows as {
      id: string;
      project_id: string;
      role: string;
    }[];
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader'`);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('acc-p2-only', 'raby-family', 'P2') ON CONFLICT DO NOTHING`);
    await q(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-p2-access', 'acc-p2-only', 'casey-reader', 'Reader')`,
    );
    try {
      assert.equal((await inject(PEOPLE("reqalm"))).statusCode, 404);
      assert.equal((await inject(PEOPLE("acc-p2-only"))).statusCode, 200);
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-p2-access'`);
      await q(`DELETE FROM projects WHERE id = 'acc-p2-only'`);
      for (const g of saved) {
        await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, $2, 'casey-reader', $3) ON CONFLICT DO NOTHING`, [g.id, g.project_id, g.role]);
      }
    }
  });
});
