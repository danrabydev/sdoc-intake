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

describe("requirements read API", () => {
  it("lists, filters, and escapes q wildcards", async () => {
    const page = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements?limit=5", headers: bearer })
    ).json() as { data: { items: unknown[]; total: number } };
    assert.ok(page.data.total > 100 && page.data.items.length === 5);
    const cap = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements?kind=capability&limit=50", headers: bearer })
    ).json() as { data: { items: Array<{ kind: string }> } };
    assert.ok(cap.data.items.length > 0 && cap.data.items.every((i) => i.kind === "capability"));
    await ctx.pool.query(
      `INSERT INTO requirement_lines (base_uid, project_id, parent, kind, title)
       VALUES ('FIX-Q-PCT', 'reqalm', 'SEC-DEVENV', 'requirement', 'percent_%under_test') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement, title)
       VALUES ('FIX-Q-PCT', 'FIX-Q-PCT', 'reqalm', 0, 'active', 'probe', 'percent_%under_test') ON CONFLICT DO NOTHING`,
    );
    const ids = (
      (await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements?q=percent_%25under", headers: bearer })).json() as {
        data: { items: Array<{ id: string }> };
      }
    ).data.items.map((i) => i.id);
    assert.ok(ids.includes("FIX-Q-PCT"));
  });

  it("detail, versions, caps, authz, redaction, and agent narrowing", async () => {
    const detail = (
      await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements/A01", headers: bearer })
    ).json() as { data: { id: string; statement: string; attributes: object } };
    assert.equal(detail.data.id, "A01");
    assert.match(detail.data.statement, /SSO/);
    const versions = (
      await inject({
        method: "GET",
        url: "/api/v1/projects/reqalm/requirements/FIX-SUCC-2HOP/versions?limit=10",
        headers: bearer,
      })
    ).json() as { data: { items: Array<{ version_n: number }> } };
    assert.deepEqual(
      versions.data.items.map((v) => v.version_n),
      [...versions.data.items.map((v) => v.version_n)].sort((a, b) => b - a),
    );
    assert.equal(
      (await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements?limit=500", headers: bearer })).statusCode,
      400,
    );
    assert.equal(
      (await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements/A01/versions?offset=100001", headers: bearer }))
        .statusCode,
      400,
    );
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
    const nf = async (url: string) => {
      const res = await inject({ method: "GET", url, headers: bearer });
      return { status: res.statusCode, code: (res.json() as { code: string }).code };
    };
    assert.deepEqual(await nf("/api/v1/projects/reqalm/requirements/CROSS-ONLY"), await nf("/api/v1/projects/reqalm/requirements/NO-SUCH-REQ"));
    await ctx.pool.query(`INSERT INTO identities (id, display_name) VALUES ('no-grant-req', 'x') ON CONFLICT DO NOTHING`);
    await ctx.pool.query(
      `INSERT INTO local_credentials (identity_id, username, password_hash, is_dev_seeded)
       SELECT 'no-grant-req', 'no-grant-req@dev.local', password_hash, true FROM local_credentials WHERE identity_id = 'casey-reader' LIMIT 1
       ON CONFLICT (identity_id) DO NOTHING`,
    );
    assert.equal(
      (
        await inject({
          method: "GET",
          url: "/api/v1/projects/reqalm/requirements/A01",
          headers: { authorization: `Bearer ${await issueTestAccessToken(ctx.app, "no-grant-req@dev.local")}` },
        })
      ).statusCode,
      404,
    );
    const saved = await ctx.pool.query<{ id: string; role: string }>(
      `SELECT id, role FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm' AND revoked_at IS NULL`,
    );
    await ctx.pool.query(`DELETE FROM project_grants WHERE identity_id = 'casey-reader' AND project_id = 'reqalm'`);
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ('grant-kc-temp', 'reqalm', 'casey-reader', 'Key custodian')`,
    );
    assert.equal(
      (await inject({ method: "GET", url: "/api/v1/projects/reqalm/requirements/A01", headers: { authorization: `Bearer ${readerToken}` } }))
        .statusCode,
      403,
    );
    await ctx.pool.query(`DELETE FROM project_grants WHERE id = 'grant-kc-temp'`);
    for (const g of saved.rows) {
      await ctx.pool.query(
        `INSERT INTO project_grants (id, project_id, identity_id, role) VALUES ($1, 'reqalm', 'casey-reader', $2) ON CONFLICT DO NOTHING`,
        [g.id, g.role],
      );
    }
    resetTelemetrySpans();
    assert.equal(
      (await inject({
        method: "GET",
        url: "/api/v1/projects/reqalm/requirements/!!bad!!",
        headers: { ...bearer, "x-request-id": "req-bad-id" },
      })).statusCode,
      400,
    );
    assert.equal(
      (await ctx.pool.query(`SELECT target_id FROM audit_events WHERE request_id = 'req-bad-id'`)).rows[0]?.target_id,
      null,
    );
    assert.ok(finishedSpans().some((s) => String(s.attributes["url.path"] ?? "").includes("/requirements/[invalid]")));
    assert.equal(
      (
        await inject({
          method: "GET",
          url: "/api/v1/projects/reqalm/requirements?limit=1",
          headers: { authorization: `Bearer ${await agentToken("Reader")}` },
        })
      ).statusCode,
      200,
    );
  });
});
