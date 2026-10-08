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

describe("requirements read API", () => {
  it("filters type, status, kind, and combined query params", async () => {
    const cap = (
      await inject({
        method: "GET",
        url: "/api/v1/projects/reqalm/requirements?kind=capability&limit=100",
        headers: bearer,
      })
    ).json() as { data: { items: Array<{ kind: string }>; total: number } };
    assert.equal(cap.data.total, 72);
    assert.ok(cap.data.items.length > 0);
    assert.ok(cap.data.items.every((i) => i.kind === "capability"));
    const draft = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements?status=draft&limit=100", headers: bearer })
    ).json() as { data: { items: Array<{ id: string; status: string }> } };
    assert.ok(draft.data.items.length > 0);
    assert.ok(draft.data.items.every((i) => i.status === "draft"));
    assert.ok(!draft.data.items.some((i) => i.id === "CAP-READ-RELEASES"));
    assert.ok(!draft.data.items.some((i) => i.id === "CAP-BROWSE-UI-RELEASES"));
    assert.ok(!draft.data.items.some((i) => i.id === "CAP-READ-HIERARCHY"));
    assert.ok(draft.data.items.some((i) => i.id === "CAP-MFA-QR"));
    assert.ok(!draft.data.items.some((i) => i.id === "CAP-BROWSE-UI-TREE"));
    const uiActive = (
      await inject({
        method: "GET",
        url: "/api/v1/projects/reqalm/requirements?status=active&q=CAP-BROWSE-UI-REQS&limit=5",
        headers: bearer,
      })
    ).json() as { data: { items: Array<{ id: string; status: string }> } };
    assert.deepEqual(uiActive.data.items.map((i) => i.id), ["CAP-BROWSE-UI-REQS"]);
    assert.equal(uiActive.data.items[0]?.status, "active");
    const content = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements?type=content&limit=100", headers: bearer })
    ).json() as { data: { items: Array<{ type: string; id: string }>; total: number } };
    assert.equal(content.data.total, 7);
    assert.ok(content.data.items.some((i) => i.id === "SEC-DEVENV" && i.type === "content"));
    const combo = (
      await inject({
        method: "GET",
        url: "/api/v1/projects/reqalm/requirements?kind=section&type=content&status=active&q=SEC-DEVENV",
        headers: bearer,
      })
    ).json() as { data: { items: Array<{ id: string }> } };
    assert.deepEqual(combo.data.items.map((i) => i.id), ["SEC-DEVENV"]);
  });

  it("escapes q wildcards (% _ \\) and respects max query length", async () => {
    await ctx.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, parent, kind, title)
       VALUES ('FIX-Q-UND', 'reqalm', 'SEC-DEVENV', 'requirement', 'a_c'), ('FIX-Q-ABC', 'reqalm', 'SEC-DEVENV', 'requirement', 'abc')
       ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title)
       VALUES ('FIX-Q-UND', 'FIX-Q-UND', 'reqalm', 0, 'active', 'a_c', 'a_c'), ('FIX-Q-ABC', 'FIX-Q-ABC', 'reqalm', 0, 'active', 'abc', 'abc')
       ON CONFLICT DO NOTHING`,
    );
    const und = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements?q=a_c&limit=50", headers: bearer })
    ).json() as { data: { items: Array<{ id: string }> } };
    assert.deepEqual(und.data.items.map((i) => i.id), ["FIX-Q-UND"]);
    const pct = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements?q=%25&limit=5", headers: bearer })
    ).json() as { data: { total: number } };
    assert.equal(pct.data.total, 0);
    const us = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements?q=_&limit=100", headers: bearer })
    ).json() as { data: { items: Array<{ title: string; id: string }> } };
    for (const item of us.data.items) {
      assert.match(`${item.id} ${item.title}`, /_/);
    }
    assert.equal(
      (await inject({ method: "GET", url: `/api/v1/projects/reqalm/requirements?q=${"x".repeat(201)}`, headers: bearer }))
        .statusCode,
      400,
    );
    for (const param of ["kind", "type", "status"] as const) {
      assert.equal(
        (await inject({
          method: "GET",
          url: `/api/v1/projects/reqalm/requirements?${param}=${"x".repeat(65)}`,
          headers: bearer,
        })).statusCode,
        400,
        param,
      );
    }
  });

  it("selects newest version for list summary and detail (M15)", async () => {
    const versions = (
      await inject({
        method: "GET",
        url: "/api/v1/projects/reqalm/requirements/FIX-SUCC-2HOP/versions?limit=10",
        headers: bearer,
      })
    ).json() as { data: { items: Array<{ version_n: number }> } };
    const versionNs = versions.data.items.map((v) => v.version_n);
    assert.deepEqual(versionNs, [...versionNs].sort((a, b) => b - a));
    assert.ok(versionNs.length >= 3);
    for (let i = 1; i < versionNs.length; i++) {
      assert.ok(versionNs[i - 1]! > versionNs[i]!);
    }
    const list = (
      await inject({
        method: "GET",
        url: "/api/v1/projects/reqalm/requirements?q=FIX-SUCC-2HOP&limit=5",
        headers: bearer,
      })
    ).json() as { data: { items: Array<{ id: string; version_n: number; version_id: string }> } };
    assert.equal(list.data.items[0]?.version_n, 2);
    assert.equal(list.data.items[0]?.version_id, "FIX-SUCC-2HOP.2");
    const detail = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements/FIX-SUCC-2HOP", headers: bearer })
    ).json() as { data: { version_n: number; version_id: string } };
    assert.equal(detail.data.version_n, 2);
    assert.equal(detail.data.version_id, "FIX-SUCC-2HOP.2");
  });

  it("scopes list and versions to project (M17, M18)", async () => {
    await ctx.pool.query(
      `INSERT INTO projects (id, client_id, name) VALUES ('cross-proj', 'reqalm-client', 'Cross') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, kind, title)
       VALUES ('CROSS-ONLY', 'cross-proj', 'requirement', 'x') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement)
       VALUES ('CROSS-ONLY', 'CROSS-ONLY', 'cross-proj', 0, 'active', 'x') ON CONFLICT DO NOTHING`,
    );
    const list = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements?q=CROSS-ONLY", headers: bearer })
    ).json() as { data: { total: number } };
    assert.equal(list.data.total, 0);
    const nf = async (url: string) => {
      const res = await inject({ method: "GET", url, headers: bearer });
      return { status: res.statusCode, code: (res.json() as { code: string }).code };
    };
    assert.deepEqual(
      await nf("/api/v1/projects/reqalm/requirements/CROSS-ONLY"),
      await nf("/api/v1/projects/reqalm/requirements/NO-SUCH-REQ"),
    );
    assert.deepEqual(
      await nf("/api/v1/projects/reqalm/requirements/CROSS-ONLY/versions"),
      await nf("/api/v1/projects/reqalm/requirements/NO-SUCH-REQ/versions"),
    );
  });

  it("paging caps: list offset boundary, versions limit (M06, M23, M24)", async () => {
    assert.equal(
      (await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements?limit=500", headers: bearer })).statusCode,
      400,
    );
    assert.equal(
      (await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements?offset=100000&limit=1", headers: bearer }))
        .statusCode,
      200,
    );
    assert.equal(
      (await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements?offset=100001", headers: bearer })).statusCode,
      400,
    );
    assert.equal(
      (await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements/A01/versions?limit=101", headers: bearer }))
        .statusCode,
      400,
    );
  });

  it("Key custodian denied on list, detail, and versions (M19, M21)", async () => {
    const saved = (
      await ctx.pool.query<{ id: string; role: string }>(
        `SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm' AND revoked_at IS NULL`,
      )
    ).rows;
    await ctx.pool.query(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-temp', 'reqalm', 'casey-reader', 'Key custodian')`,
    );
    try {
      const h = { authorization: `Bearer ${readerToken}` };
      for (const url of [
        "/api/v1/projects/reqalm/requirements?limit=1",
        "/api/v1/projects/reqalm/requirements/A01",
        "/api/v1/projects/reqalm/requirements/A01/versions",
      ]) {
        assert.equal((await inject({ method: "GET", url, headers: h })).statusCode, 403, url);
      }
    } finally {
      await ctx.pool.query(`DELETE FROM project_grants WHERE id = 'grant-kc-temp'`);
      await restoreCaseyGrants(saved);
    }
  });

  it("agent Reader token denied on list, detail, and versions when only non-Reader grant applies (N08, N10)", async () => {
    await ctx.pool.query(
      `INSERT INTO clients (id, name) VALUES ('browse-client-p2', 'Browse P2') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO projects (id, client_id, name) VALUES ('browse-p2', 'browse-client-p2', 'Browse P2') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role)
       VALUES ('grant-agent-padmin-p2-req', 'browse-p2', 'agent-cursor-cloud', 'Project admin') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, kind, title)
       VALUES ('P2-REQ', 'browse-p2', 'requirement', 'agent narrowing bed') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement)
       VALUES ('P2-REQ', 'P2-REQ', 'browse-p2', 0, 'active', 'bed') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role)
       VALUES ('grant-casey-reader-p2-req', 'browse-p2', 'casey-reader', 'Reader') ON CONFLICT DO NOTHING`,
    );
    try {
      const narrowed = { authorization: `Bearer ${await agentToken("Reader")}` };
      for (const url of [
        "/api/v1/projects/browse-p2/requirements?limit=1",
        "/api/v1/projects/browse-p2/requirements/P2-REQ",
        "/api/v1/projects/browse-p2/requirements/P2-REQ/versions",
      ]) {
        assert.equal((await inject({ method: "GET", url, headers: narrowed })).statusCode, 403, url);
      }
      for (const url of [
        "/api/v1/projects/browse-p2/requirements/P2-REQ",
        "/api/v1/projects/browse-p2/requirements/P2-REQ/versions",
      ]) {
        assert.equal((await inject({ method: "GET", url, headers: bearer })).statusCode, 200, url);
      }
    } finally {
      await ctx.pool.query(`DELETE FROM project_grants WHERE id IN ('grant-agent-padmin-p2-req', 'grant-casey-reader-p2-req')`);
      await ctx.pool.query(`DELETE FROM requirement_versions WHERE base_uid = 'P2-REQ'`);
      await ctx.pool.query(`DELETE FROM requirement_lines WHERE base_uid = 'P2-REQ'`);
      await ctx.pool.query(`DELETE FROM projects WHERE id = 'browse-p2'`);
      await ctx.pool.query(`DELETE FROM clients WHERE id = 'browse-client-p2'`);
    }
  });

  it("malformed requirement id: 400, audit, redaction", async () => {
    resetTelemetrySpans();
    const res = await inject({
      method: "GET",
      url: "/api/v1/projects/reqalm/requirements/!!bad!!",
      headers: { ...bearer, "x-request-id": "req-bad-id" },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(
      (await ctx.pool.query(`SELECT target_id FROM audit_events WHERE request_id = 'req-bad-id'`)).rows[0]?.target_id,
      null,
    );
    assert.ok(finishedSpans().some((s) => String(s.attributes["url.path"] ?? "").includes("/requirements/[invalid]")));
  });
});
