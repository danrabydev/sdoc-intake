import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { redactInvalidPathParamIds } from "../../http/project-id.js";
import { hashPassword } from "../../credential/password.js";
import { createTestApp, issueTestAccessToken, TEST_PASSWORD, type TestApp } from "../../test/harness.js";
import { finishedSpans, resetTelemetrySpans } from "../../test/otel-testing.js";
import { listRoutesForSecurityAudit } from "../../http/route-security.js";
import { ROLE_PERMISSIONS } from "../../rbac/enforce.js";
import {
  assertAccessDtoHygiene,
  assertAccessGrantPage,
  assertAccessPeoplePage,
  assertPlatformGrantPage,
} from "./access.dto.test.js";

let ctx: TestApp | undefined;
let overseerBearer: Record<string, string>;
let readerBearer: Record<string, string>;

const PEOPLE = (p: string) => `/api/v1/projects/${p}/access/people`;
const PGRANTS = (p: string) => `/api/v1/projects/${p}/access/grants`;
const CGRANTS = (c: string) => `/api/v1/clients/${c}/access/grants`;
const ROLES = "/api/v1/access/roles";
const PLATFORM = "/api/v1/access/platform-grants";
const q = (sql: string, params?: unknown[]) => ctx!.pool.query(sql, params);
const inject = (url: string, headers = overseerBearer) =>
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
  const passwordHash = await hashPassword(TEST_PASSWORD);
  await q(
    `INSERT INTO local_credentials (identity_id, username, password_hash, is_dev_seeded)
     VALUES ('jordan-auditor', 'jordan-auditor@dev.local', $1, true)
     ON CONFLICT (identity_id) DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash`,
    [passwordHash],
  );
  overseerBearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app, "jordan-auditor@dev.local")}` };
  readerBearer = { authorization: `Bearer ${await issueTestAccessToken(ctx.app, "casey-reader@dev.local")}` };
});
after(async () => {
  await ctx?.close();
});
describe("access route registration", () => {
  it("pins projectScoped or listScope access:read on every access operation route", () => {
    const routes = listRoutesForSecurityAudit(ctx!.app).filter((r) => r.url.includes("/access"));
    assert.ok(routes.length >= 5);
    for (const r of routes) {
      assert.equal(r.operationRoute, true, r.url);
      assert.equal(r.operationRef?.permission, "access:read", r.url);
    }
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const svc = readFileSync(path.join(dir, "access.service.ts"), "utf8");
    const routesSrc = readFileSync(path.join(dir, "routes.ts"), "utf8");
    assert.match(svc, /pg\.project_id = \$1/);
    assert.match(svc, /revoked_at IS NULL/);
    assert.match(svc, /callerHasPlatformGrant/);
    assert.match(svc, /callerHasClientGrantOn/);
    assert.match(routesSrc, /permission: "access:read"/);
    assert.match(routesSrc, /permissionDeniedAsNotFound: true/);
    assert.match(routesSrc, /invalidPathProjectIdAsValidation: true/);
  });
});

describe("access read API", () => {
  it("Reader and Tester get 404 on every access route", async () => {
    for (const url of [PEOPLE("reqalm"), PGRANTS("reqalm"), CGRANTS("raby-family"), ROLES, PLATFORM]) {
      assert.equal((await inject(url, readerBearer)).statusCode, 404, url);
    }
    assert.equal((await inject(PEOPLE("reqalm"), readerBearer)).statusCode, 404);
  });

  it("people sort, aggregated roles, and DTO field set", async () => {
    const page = dataOf(await inject(`${PEOPLE("reqalm")}?limit=100`)) as {
      items: { display_name: string; roles: string[] }[];
      total: number;
    };
    assert.equal(page.total, 10);
    const names = page.items.map((i) => i.display_name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    const dan = page.items.find((i) => i.display_name.includes("Dan"))!;
    assert.deepEqual(dan.roles.sort(), ["Author", "Project admin"]);
    assertAccessPeoplePage(page);
    const body = JSON.stringify((await inject(`${PEOPLE("reqalm")}?limit=1&offset=1`)).json());
    assert.ok(!body.includes("cyber_gate") && !body.includes("gate_signoffs"));
  });

  it("revoked project grants are excluded and items.length matches total", async () => {
    await q(
      `INSERT INTO identities (id, display_name) VALUES ('revoke-fixture', 'Revoke Fixture') ON CONFLICT DO NOTHING`,
    );
    await q(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-revoke-fixture', 'reqalm', 'revoke-fixture', 'Author') ON CONFLICT DO NOTHING`,
    );
    try {
      const before = dataOf(await inject(`${PGRANTS("reqalm")}?limit=100`)) as {
        items: { id: string }[];
        total: number;
      };
      assert.ok(before.items.some((g) => g.id === "grant-revoke-fixture"));
      await q(`UPDATE project_grants SET revoked_at = now() WHERE id = 'grant-revoke-fixture'`);
      const after = dataOf(await inject(`${PGRANTS("reqalm")}?limit=100`)) as {
        items: { id: string }[];
        total: number;
      };
      assert.ok(!after.items.some((g) => g.id === "grant-revoke-fixture"));
      assert.equal(after.items.length, after.total);
      assert.equal(after.total, before.total - 1);
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-revoke-fixture'`);
      await q(`DELETE FROM identities WHERE id = 'revoke-fixture'`);
    }
  });

  it("project grants paging with exact ids at offset and sort by role then id", async () => {
    assert.equal((await inject(`${PGRANTS("reqalm")}?limit=101`)).statusCode, 400);
    const all = dataOf(await inject(`${PGRANTS("reqalm")}?limit=100`)) as {
      items: { id: string; role: string }[];
      total: number;
    };
    assert.equal(all.total, 12);
    const sorted = [...all.items].sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id));
    assert.deepEqual(all.items, sorted);
    const expectedAtOffset2 = sorted.slice(2, 4).map((g) => g.id);
    const off = dataOf(await inject(`${PGRANTS("reqalm")}?limit=2&offset=2`)) as { items: { id: string }[] };
    assert.deepEqual(
      off.items.map((g) => g.id),
      expectedAtOffset2,
    );
    assert.equal((dataOf(await inject(`${PGRANTS("reqalm")}?limit=1&offset=99`)) as { items: unknown[] }).items.length, 0);
    assertAccessGrantPage(all);
  });

  it("client grants require client-level or platform grant; project-only overseer is denied", async () => {
    assert.equal((await inject(`${CGRANTS("raby-family")}?limit=10`)).statusCode, 404);
    await q(
      `INSERT INTO client_grants (id, client_id, identity_id, role) VALUES ('grant-jordan-raby-client', 'raby-family', 'jordan-auditor', 'Client admin') ON CONFLICT DO NOTHING`,
    );
    try {
      const grants = dataOf(await inject(`${CGRANTS("raby-family")}?limit=10`)) as {
        items: { id: string; role: string; person: { display_name: string } }[];
        total: number;
      };
      assert.ok(grants.total >= 1);
      assert.ok(grants.items.some((g) => g.role === "Client admin"));
      assert.equal((await inject(CGRANTS("other-family"))).statusCode, 404);
      assertAccessGrantPage(grants);
    } finally {
      await q(`DELETE FROM client_grants WHERE id = 'grant-jordan-raby-client'`);
    }
  });

  it("client grants sort with two rows", async () => {
    const saved = (await q(`SELECT id, client_id, identity_id, role FROM client_grants WHERE client_id = 'raby-family'`)).rows;
    await q(`DELETE FROM client_grants WHERE client_id = 'raby-family'`);
    await q(
      `INSERT INTO client_grants (id, client_id, identity_id, role) VALUES ('grant-sort-a', 'raby-family', 'jordan-auditor', 'Auditor')`,
    );
    await q(
      `INSERT INTO client_grants (id, client_id, identity_id, role) VALUES ('grant-sort-b', 'raby-family', 'casey-reader', 'Reader')`,
    );
    try {
      const page = dataOf(await inject(`${CGRANTS("raby-family")}?limit=10`)) as {
        items: { id: string; role: string }[];
      };
      assert.equal(page.items.length, 2);
      const sorted = [...page.items].sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id));
      assert.deepEqual(page.items, sorted);
    } finally {
      await q(`DELETE FROM client_grants WHERE client_id = 'raby-family'`);
      for (const g of saved) {
        await q(
          `INSERT INTO client_grants (id, client_id, identity_id, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [g.id, g.client_id, g.identity_id, g.role],
        );
      }
    }
  });

  it("role catalog: 404 with no grants; 200 for access:read caller with grants", async () => {
    const saved = (await q(`SELECT id, project_id, role FROM project_grants WHERE identity_id = 'casey-reader'`)).rows;
    await q(`DELETE FROM project_grants WHERE identity_id = 'casey-reader'`);
    try {
      assert.equal((await inject(ROLES, readerBearer)).statusCode, 404);
    } finally {
      for (const g of saved) {
        await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, $2, 'casey-reader', $3) ON CONFLICT DO NOTHING`, [g.id, g.project_id, g.role]);
      }
    }
    const roles = dataOf(await inject(`${ROLES}?limit=100`)) as {
      items: { name: string; permissions: string[] }[];
      total: number;
    };
    assert.equal(roles.total, Object.keys(ROLE_PERMISSIONS).length);
    const auditor = roles.items.find((r) => r.name === "Auditor")!;
    assert.ok(auditor.permissions.includes("access:read"));
    assert.deepEqual(auditor.permissions, [...auditor.permissions].sort());
    const sortedNames = roles.items.map((r) => r.name);
    assert.deepEqual(sortedNames, [...sortedNames].sort());
    assertAccessDtoHygiene(roles);
  });

  it("role catalog 404 when overseer has access:read role but all grants removed", async () => {
    const savedProject = (await q(`SELECT id, project_id, role FROM project_grants WHERE identity_id = 'jordan-auditor'`))
      .rows;
    const savedClient = (await q(`SELECT id, client_id, identity_id, role FROM client_grants WHERE identity_id = 'jordan-auditor'`))
      .rows;
    const savedPlatform = (await q(`SELECT id, identity_id, role FROM platform_grants WHERE identity_id = 'jordan-auditor'`))
      .rows;
    await q(`DELETE FROM project_grants WHERE identity_id = 'jordan-auditor'`);
    await q(`DELETE FROM client_grants WHERE identity_id = 'jordan-auditor'`);
    await q(`DELETE FROM platform_grants WHERE identity_id = 'jordan-auditor'`);
    try {
      assert.equal((await inject(ROLES)).statusCode, 404);
    } finally {
      for (const g of savedProject) {
        await q(
          `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, $2, 'jordan-auditor', $3) ON CONFLICT DO NOTHING`,
          [g.id, g.project_id, g.role],
        );
      }
      for (const g of savedClient) {
        await q(
          `INSERT INTO client_grants (id, client_id, identity_id, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [g.id, g.client_id, g.identity_id, g.role],
        );
      }
      for (const g of savedPlatform) {
        await q(
          `INSERT INTO platform_grants (id, identity_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [g.id, g.identity_id, g.role],
        );
      }
    }
  });

  it("platform grants hidden without platform grant; visible with platform grant and access:read", async () => {
    assert.equal((await inject(PLATFORM)).statusCode, 404);
    await q(
      `INSERT INTO platform_grants (id, identity_id, role) VALUES ('pgrant-jordan-temp-plat', 'jordan-auditor', 'Auditor') ON CONFLICT DO NOTHING`,
    );
    try {
      const plat = dataOf(await inject(`${PLATFORM}?limit=10`)) as {
        items: { id: string; role: string; person: { display_name: string } }[];
        total: number;
      };
      assert.ok(plat.total >= 2);
      const sorted = [...plat.items].sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id));
      assert.deepEqual(plat.items, sorted);
      assert.ok(plat.items.some((g) => g.role === "Key custodian"));
      const raw = JSON.stringify(plat);
      assert.ok(!raw.includes("password_hash") && !raw.includes("mfa_secret"));
      assertPlatformGrantPage(plat);
    } finally {
      await q(`DELETE FROM platform_grants WHERE id = 'pgrant-jordan-temp-plat'`);
    }
  });

  it("cross-project leak: identity only on another project never appears on reqalm", async () => {
    await q(`INSERT INTO identities (id, display_name) VALUES ('leak-only-p2', 'Leak Only P2') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('acc-p2', 'raby-family', 'P2') ON CONFLICT DO NOTHING`);
    await q(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-leak-only', 'acc-p2', 'leak-only-p2', 'Author') ON CONFLICT DO NOTHING`,
    );
    try {
      const people = dataOf(await inject(`${PEOPLE("reqalm")}?limit=100`)) as {
        items: { display_name: string }[];
      };
      assert.ok(!people.items.some((p) => p.display_name === "Leak Only P2"));
      const grants = dataOf(await inject(`${PGRANTS("reqalm")}?limit=100`)) as {
        items: { person: { display_name: string } }[];
      };
      assert.ok(!grants.items.some((g) => g.person.display_name === "Leak Only P2"));
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-leak-only'`);
      await q(`DELETE FROM projects WHERE id = 'acc-p2'`);
      await q(`DELETE FROM identities WHERE id = 'leak-only-p2'`);
    }
  });

  it("cross-client: second client grants stay invisible without a client grant there", async () => {
    await q(
      `INSERT INTO client_grants (id, client_id, identity_id, role) VALUES ('grant-jordan-other-client', 'other-family', 'jordan-auditor', 'Client admin') ON CONFLICT DO NOTHING`,
    );
    try {
      assert.equal((await inject(CGRANTS("other-family"))).statusCode, 200);
      const other = dataOf(await inject(`${CGRANTS("other-family")}?limit=10`)) as { total: number };
      assert.equal(other.total, 1);
      await q(`DELETE FROM client_grants WHERE id = 'grant-jordan-other-client'`);
      assert.equal((await inject(CGRANTS("other-family"))).statusCode, 404);
    } finally {
    }
  });

  it("404 parity on project, client, and platform routes", async () => {
    const refProject = await inject(PEOPLE("no-such-project"));
    assert.equal(refProject.statusCode, 404);
    for (const url of [PEOPLE("acc-p2"), PGRANTS("acc-p2")]) {
      assert404Parity(refProject, await inject(url), url);
    }
    const refClient = await inject(CGRANTS("no-such-client"));
    assert.equal(refClient.statusCode, 404);
    assert404Parity(refClient, await inject(CGRANTS("other-family")), CGRANTS("other-family"));
    assert404Parity(refClient, await inject(CGRANTS("no-such-client")), CGRANTS("no-such-client"));
    const refPlatform = await inject(PLATFORM, readerBearer);
    assert.equal(refPlatform.statusCode, 404);
    assert404Parity(refPlatform, await inject(PLATFORM, readerBearer), PLATFORM);
  });

  it("bad projectId and clientId return 400; access path segments redact in telemetry", async () => {
    resetTelemetrySpans();
    assert.equal((await inject(PEOPLE("!!bad!!"))).statusCode, 400);
    assert.equal((await inject(PGRANTS("Not_A_Slug"))).statusCode, 400);
    assert.equal((await inject(CGRANTS("!!bad-client!!"))).statusCode, 400);
    assert.ok(finishedSpans().some((s) => String(s.attributes["url.path"] ?? "").includes("/projects/[invalid]/")));
    assert.equal(
      redactInvalidPathParamIds("/api/v1/access/!!secret!!/people"),
      "/api/v1/access/[invalid]/people",
    );
  });

  it("regression: access:read on p2 only returns 404 on reqalm access routes", async () => {
    const saved = (await q(`SELECT id, project_id, role FROM project_grants WHERE identity_id = 'jordan-auditor'`)).rows as {
      id: string;
      project_id: string;
      role: string;
    }[];
    await q(`DELETE FROM project_grants WHERE identity_id = 'jordan-auditor'`);
    await q(`INSERT INTO projects (id, client_id, name) VALUES ('acc-p2-only', 'raby-family', 'P2') ON CONFLICT DO NOTHING`);
    await q(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-p2-access', 'acc-p2-only', 'jordan-auditor', 'Auditor')`,
    );
    try {
      assert.equal((await inject(PEOPLE("reqalm"))).statusCode, 404);
      assert.equal((await inject(PEOPLE("acc-p2-only"))).statusCode, 200);
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-p2-access'`);
      await q(`DELETE FROM projects WHERE id = 'acc-p2-only'`);
      for (const g of saved) {
        await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, $2, 'jordan-auditor', $3) ON CONFLICT DO NOTHING`, [g.id, g.project_id, g.role]);
      }
    }
  });

  it("Key custodian on project grant cannot read access routes", async () => {
    const refDeny = await inject(PEOPLE("no-such-project"));
    await q(`INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-acc', 'reqalm', 'taylor-tester', 'Key custodian') ON CONFLICT DO NOTHING`);
    try {
      for (const url of [PEOPLE("reqalm"), PGRANTS("reqalm")]) {
        assert404Parity(refDeny, await inject(url, readerBearer), url);
      }
    } finally {
      await q(`DELETE FROM project_grants WHERE id = 'grant-kc-acc'`);
    }
  });
});
