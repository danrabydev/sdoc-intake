import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createTestApp,
  issueTestAccessToken,
  TEST_AGENT_SECRET,
  TEST_API_RESOURCE,
  type TestApp,
} from "../../test/harness.js";
import { finishedSpans, resetTelemetrySpans } from "../../test/otel-testing.js";

let ctx: TestApp;
let bearer: Record<string, string>;
let readerToken: string;

before(async () => {
  ctx = await createTestApp({ dogfood: true });
  readerToken = await issueTestAccessToken(ctx.app);
  bearer = { authorization: `Bearer ${readerToken}` };
});

after(async () => {
  await ctx.close();
});

const inject = (opts: { method: string; url: string; headers?: Record<string, string>; payload?: string }) =>
  ctx.app.inject({
    ...opts,
    remoteAddress: "203.0.113.50",
    headers: { host: "localhost:3000", ...opts.headers },
  } as never);

async function agentToken(role?: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: "reqalm-agent-dev",
    client_secret: TEST_AGENT_SECRET,
    agent_name: "cursor-cloud",
    resource: TEST_API_RESOURCE,
  });
  if (role) params.set("role", role);
  const res = await inject({
    method: "POST",
    url: "/oauth/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: params.toString(),
  });
  assert.equal(res.statusCode, 200);
  return (res.json() as { access_token: string }).access_token;
}

async function restoreCaseyGrants(saved: { id: string; role: string }[]): Promise<void> {
  await ctx.pool.query(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
  for (const g of saved) {
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, 'reqalm', 'casey-reader', $2) ON CONFLICT DO NOTHING`,
      [g.id, g.role],
    );
  }
}

describe("releases read API", () => {
  it("returns 401 unauthenticated on list and detail", async () => {
    for (const url of ["/api/v1/projects/reqalm/releases?limit=1", "/api/v1/projects/reqalm/releases/rel-r0-sequences"]) {
      const res = await inject({ method: "GET", url });
      assert.equal(res.statusCode, 401, url);
      assert.equal((res.json() as { code: string }).code, "unauthenticated");
    }
  });

  it("status filter returns exact count and every item matches (list)", async () => {
    const planned = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/releases?status=planned&limit=100", headers: bearer })
    ).json() as { data: { items: Array<{ status: string; id: string }>; total: number } };
    assert.equal(planned.data.total, 4);
    assert.equal(planned.data.items.length, 4);
    assert.ok(planned.data.items.every((i) => i.status === "planned"));
    assert.ok(planned.data.items.some((i) => i.id === "rel-r1-ui-header-nav"));
    assert.ok(!planned.data.items.some((i) => i.id === "rel-r1-browse-ui-relations"));
    assert.ok(!planned.data.items.some((i) => i.id === "rel-r1-catalogs-api"));
    assert.ok(!planned.data.items.some((i) => i.id === "rel-r1-lf-endings"));
    assert.ok(!planned.data.items.some((i) => i.id === "rel-r1-relations-api"));
    assert.ok(!planned.data.items.some((i) => i.id === "rel-r1-mfa-qr"));
    assert.ok(!planned.data.items.some((i) => i.id === "rel-r1-browse-ui-tree"));
    assert.ok(!planned.data.items.some((i) => i.id === "rel-r1-read-hierarchy"));
    assert.ok(!planned.data.items.some((i) => i.id === "rel-r1-browse-ui-releases"));
    assert.ok(!planned.data.items.some((i) => i.id === "rel-r1-read-releases"));
    const shipped = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/releases?status=shipped&limit=100", headers: bearer })
    ).json() as { data: { total: number; items: Array<{ id: string; status: string }> } };
    assert.equal(shipped.data.total, 25);
    assert.ok(shipped.data.items.some((i) => i.id === "rel-r1-browse-ui-relations"));
    assert.ok(shipped.data.items.some((i) => i.id === "rel-r1-catalogs-api"));
    assert.ok(shipped.data.items.some((i) => i.id === "rel-r1-lf-endings"));
    assert.ok(shipped.data.items.some((i) => i.id === "rel-r1-relations-api"));
    assert.ok(shipped.data.items.some((i) => i.id === "rel-r1-browse-ui-tree"));
    assert.ok(shipped.data.items.some((i) => i.id === "rel-r1-mfa-qr"));
    assert.ok(shipped.data.items.some((i) => i.id === "rel-r1-read-hierarchy"));
    assert.ok(shipped.data.items.some((i) => i.id === "rel-r1-read-releases"));
    assert.ok(shipped.data.items.some((i) => i.id === "rel-r1-browse-ui-releases"));
    assert.ok(shipped.data.items.every((i) => i.status === "shipped"));
  });

  it("list order is planned_on desc nulls last then id asc", async () => {
    const list = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/releases?limit=100", headers: bearer })
    ).json() as { data: { items: Array<{ id: string; planned_on: string | null }> } };
    const ids = list.data.items.map((i) => i.id);
    assert.deepEqual(ids.slice(0, 6), [
      "rel-r1-core-alm",
      "rel-r1-platform-followups",
      "rel-r0-sequences",
      "rel-r1-browse-ui-relations",
      "rel-r1-catalogs-api",
      "rel-r1-lf-endings",
    ]);
    for (let i = 1; i < list.data.items.length; i++) {
      const a = list.data.items[i - 1]!;
      const b = list.data.items[i]!;
      const pa = a.planned_on ?? "";
      const pb = b.planned_on ?? "";
      assert.ok(pa > pb || (pa === pb && a.id <= b.id), `${a.id} vs ${b.id}`);
    }
  });

  it("detail returns exact fields and delivered capabilities", async () => {
    const res = await inject({
      method: "GET",
      url: "/api/v1/projects/reqalm/releases/rel-r1-read-releases",
      headers: bearer,
    });
    assert.equal(res.statusCode, 200);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    assert.equal(data.id, "rel-r1-read-releases");
    assert.equal(data.project_id, "reqalm");
    assert.equal(data.name, "R1 — releases read API");
    assert.equal(data.status, "shipped");
    assert.equal(data.planned_on, "2026-10-08");
    assert.equal(data.shipped_on, "2026-10-08");
    assert.equal(data.delivered_capability_count, 1);
    assert.match(String(data.notes), /gate_signoffs/);
    assert.deepEqual(data.delivered_capabilities, [
      { uid: "CAP-READ-RELEASES", title: "Read releases (list, detail)", status: "active" },
    ]);
    const shipped = (
      await inject({
        method: "GET",
        url: "/api/v1/projects/reqalm/releases/rel-r1-read-requirements",
        headers: bearer,
      })
    ).json() as { data: { status: string; shipped_on: string; delivered_capabilities: Array<{ status: string }> } };
    assert.equal(shipped.data.status, "shipped");
    assert.equal(shipped.data.shipped_on, "2026-10-08");
    assert.equal(shipped.data.delivered_capabilities[0]?.status, "active");
  });

  it("scopes list and detail to project (cross-project 404 parity)", async () => {
    await ctx.pool.query(
      `INSERT INTO projects (id, client_id, name) VALUES ('cross-proj', 'reqalm-client', 'Cross') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO releases (id, project_id, name, status, position)
       VALUES ('cross-rel', 'cross-proj', 'Cross release', 'planned', 0) ON CONFLICT DO NOTHING`,
    );
    try {
      const list = (
        await inject({ method: "GET", url: "/api/v1/projects/reqalm/releases?limit=100", headers: bearer })
      ).json() as { data: { items: Array<{ id: string }> } };
      assert.ok(!list.data.items.some((i) => i.id === "cross-rel"));
      const nf = async (url: string) => {
        const res = await inject({ method: "GET", url, headers: bearer });
        return { status: res.statusCode, code: (res.json() as { code: string }).code };
      };
      assert.deepEqual(
        await nf("/api/v1/projects/reqalm/releases/cross-rel"),
        await nf("/api/v1/projects/reqalm/releases/no-such-rel"),
      );
    } finally {
      await ctx.pool.query(`DELETE FROM releases WHERE id = 'cross-rel'`);
      await ctx.pool.query(`DELETE FROM projects WHERE id = 'cross-proj'`);
    }
  });

  it("paging caps: limit 101 and offset 100001 are 400; offset 100000 is OK (list)", async () => {
    assert.equal(
      (await inject({ method: "GET", url: "/api/v1/projects/reqalm/releases?limit=101", headers: bearer })).statusCode,
      400,
    );
    assert.equal(
      (await inject({ method: "GET", url: "/api/v1/projects/reqalm/releases?offset=100000&limit=1", headers: bearer }))
        .statusCode,
      200,
    );
    assert.equal(
      (await inject({ method: "GET", url: "/api/v1/projects/reqalm/releases?offset=100001", headers: bearer })).statusCode,
      400,
    );
  });

  it("over-length status filter returns 400 (list)", async () => {
    assert.equal(
      (await inject({
        method: "GET",
        url: `/api/v1/projects/reqalm/releases?status=${"x".repeat(65)}`,
        headers: bearer,
      })).statusCode,
      400,
    );
    assert.equal(
      (await inject({ method: "GET", url: "/api/v1/projects/reqalm/releases?status=unknown", headers: bearer }))
        .statusCode,
      400,
    );
  });

  it("Key custodian denied on list and detail", async () => {
    const saved = (
      await ctx.pool.query<{ id: string; role: string }>(
        `SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm' AND revoked_at IS NULL`,
      )
    ).rows;
    await ctx.pool.query(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-rel', 'reqalm', 'casey-reader', 'Key custodian')`,
    );
    try {
      const h = { authorization: `Bearer ${readerToken}` };
      for (const url of [
        "/api/v1/projects/reqalm/releases?limit=1",
        "/api/v1/projects/reqalm/releases/rel-r0-sequences",
      ]) {
        assert.equal((await inject({ method: "GET", url, headers: h })).statusCode, 403, url);
      }
    } finally {
      await ctx.pool.query(`DELETE FROM project_grants WHERE id = 'grant-kc-rel'`);
      await restoreCaseyGrants(saved);
    }
  });

  it("narrowed agent Reader token denied when grant is non-Reader; un-narrowed user token 200 (detail)", async () => {
    await ctx.pool.query(
      `INSERT INTO clients (id, name) VALUES ('browse-client-p2', 'Browse P2') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO projects (id, client_id, name) VALUES ('browse-p2', 'browse-client-p2', 'Browse P2') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role)
       VALUES ('grant-agent-padmin-p2-rel', 'browse-p2', 'agent-cursor-cloud', 'Project admin') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO releases (id, project_id, name, status, position)
       VALUES ('p2-rel', 'browse-p2', 'agent narrowing bed', 'planned', 0) ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role)
       VALUES ('grant-casey-reader-p2-rel', 'browse-p2', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`,
    );
    try {
      const narrowed = { authorization: `Bearer ${await agentToken("Reader")}` };
      for (const url of [
        "/api/v1/projects/browse-p2/releases?limit=1",
        "/api/v1/projects/browse-p2/releases/p2-rel",
      ]) {
        assert.equal((await inject({ method: "GET", url, headers: narrowed })).statusCode, 403, url);
      }
      assert.equal(
        (await inject({ method: "GET", url: "/api/v1/projects/browse-p2/releases/p2-rel", headers: bearer })).statusCode,
        200,
      );
    } finally {
      await ctx.pool.query(`DELETE FROM project_grants WHERE id IN ('grant-agent-padmin-p2-rel', 'grant-casey-reader-p2-rel')`);
      await ctx.pool.query(`DELETE FROM releases WHERE id = 'p2-rel'`);
      await ctx.pool.query(`DELETE FROM projects WHERE id = 'browse-p2'`);
      await ctx.pool.query(`DELETE FROM clients WHERE id = 'browse-client-p2'`);
    }
  });

  it("malformed release id: 400, audit, redaction", async () => {
    resetTelemetrySpans();
    const res = await inject({
      method: "GET",
      url: "/api/v1/projects/reqalm/releases/!!bad!!",
      headers: { ...bearer, "x-request-id": "rel-bad-id" },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(
      (await ctx.pool.query(`SELECT target_id FROM audit_events WHERE request_id = 'rel-bad-id'`)).rows[0]?.target_id,
      null,
    );
    assert.ok(finishedSpans().some((s) => String(s.attributes["url.path"] ?? "").includes("/releases/[invalid]")));
  });
});
