import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createTestApp,
  pkcePair,
  TEST_API_RESOURCE,
  TEST_AGENT_SECRET,
  TEST_ISSUER,
  TEST_PASSWORD,
  type TestApp,
} from "../test/harness.js";

let ctx: TestApp;

before(async () => {
  ctx = await createTestApp();
});

after(async () => {
  await ctx.close();
});

type InjectResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  json(): unknown;
};

async function inject(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  payload?: string | object;
}): Promise<InjectResponse> {
  return ctx.app.inject({
    ...opts,
    remoteAddress: "203.0.113.50",
    headers: { host: "localhost:3000", ...opts.headers },
  } as never) as Promise<InjectResponse>;
}

async function loginToken(username = "casey-reader@dev.local"): Promise<string> {
  const { verifier, challenge } = pkcePair();
  const redirectUri = `${TEST_ISSUER}/oauth/callback`;
  const authz = await inject({
    method: "GET",
    url: `/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: "reqalm-web",
      redirect_uri: redirectUri,
      scope: "openid profile",
      state: "s",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: TEST_API_RESOURCE,
    })}`,
  });
  const loc = String(authz.headers.location ?? "");
  const handoff = new URL(loc, TEST_ISSUER).searchParams.get("h");
  assert.ok(handoff);
  const login = await inject({
    method: "POST",
    url: "/api/v1/auth/local/login",
    headers: { "content-type": "application/json" },
    payload: { username, password: TEST_PASSWORD, h: handoff },
  });
  assert.equal(login.statusCode, 200);
  const body = login.json() as { redirect: string };
  const code = new URL(body.redirect, TEST_ISSUER).searchParams.get("code");
  assert.ok(code);
  const token = await inject({
    method: "POST",
    url: "/oauth/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: "reqalm-web",
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: TEST_API_RESOURCE,
    }).toString(),
  });
  assert.equal(token.statusCode, 200);
  return (token.json() as { access_token: string }).access_token;
}

async function agentToken(): Promise<string> {
  const res = await inject({
    method: "POST",
    url: "/oauth/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: "reqalm-agent-dev",
      client_secret: TEST_AGENT_SECRET,
      agent_name: "cursor-cloud",
      resource: TEST_API_RESOURCE,
    }).toString(),
  });
  assert.equal(res.statusCode, 200);
  return (res.json() as { access_token: string }).access_token;
}

async function auditCount(outcome?: string): Promise<number> {
  const params = outcome ? [outcome] : [];
  const q = outcome
    ? `SELECT count(*)::int AS c FROM audit_events WHERE outcome = $1`
    : `SELECT count(*)::int AS c FROM audit_events`;
  const r = await ctx.pool.query<{ c: number }>(q, params);
  return r.rows[0]?.c ?? 0;
}

describe("service foundation (projects read)", () => {
  it("returns envelope on success for human reader", async () => {
    const access = await loginToken();
    const res = await inject({
      method: "GET",
      url: "/api/v1/projects/reqalm",
      headers: { authorization: `Bearer ${access}` },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { data: { id: string }; request_id: string };
    assert.equal(body.data.id, "reqalm");
    assert.ok(body.request_id);
    assert.ok((await auditCount("allow")) >= 1);
  });

  it("agent reader token can read granted project", async () => {
    const access = await agentToken();
    const res = await inject({
      method: "GET",
      url: "/api/v1/projects/reqalm",
      headers: { authorization: `Bearer ${access}` },
    });
    assert.equal(res.statusCode, 200);
  });

  it("returns 401 unauthenticated without credentials", async () => {
    const res = await inject({ method: "GET", url: "/api/v1/projects/reqalm" });
    assert.equal(res.statusCode, 401);
    const body = res.json() as { code: string; request_id: string };
    assert.equal(body.code, "unauthenticated");
    assert.ok(body.request_id);
    assert.match(String(res.headers["content-type"] ?? ""), /application\/problem\+json/);
  });

  it("returns 400 validation for malformed project id param", async () => {
    const access = await loginToken();
    const res = await inject({
      method: "GET",
      url: "/api/v1/projects/%20",
      headers: { authorization: `Bearer ${access}` },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { code: string };
    assert.equal(body.code, "validation");
    assert.match(String(res.headers["content-type"] ?? ""), /application\/problem\+json/);
  });

  it("rejects a padded project id instead of resolving it to the real project", async () => {
    const access = await loginToken();
    for (const id of ["%20reqalm", "reqalm%20", "%09reqalm"]) {
      const res = await inject({
        method: "GET",
        url: `/api/v1/projects/${id}`,
        headers: { authorization: `Bearer ${access}` },
      });
      assert.equal(res.statusCode, 400, id);
      assert.equal((res.json() as { code: string }).code, "validation");
    }
  });

  it("returns 404 for project outside grants (no leak)", async () => {
    await ctx.pool.query(
      `INSERT INTO clients (id, name) VALUES ('other-client', 'Other') ON CONFLICT DO NOTHING`,
    );
    await ctx.pool.query(
      `INSERT INTO projects (id, client_id, name) VALUES ('secret-proj', 'other-client', 'Secret') ON CONFLICT DO NOTHING`,
    );
    const access = await loginToken();
    const res = await inject({
      method: "GET",
      url: "/api/v1/projects/secret-proj",
      headers: { authorization: `Bearer ${access}` },
    });
    assert.equal(res.statusCode, 404);
    assert.equal((res.json() as { code: string }).code, "not_found");
  });

  it("writes audit on allow, deny, and error paths", async () => {
    const before = await auditCount();
    await inject({ method: "GET", url: "/api/v1/projects/reqalm" });
    const afterDeny = await auditCount();
    assert.ok(afterDeny > before);

    const access = await loginToken();
    await inject({
      method: "GET",
      url: "/api/v1/projects/reqalm",
      headers: { authorization: `Bearer ${access}` },
    });
    assert.ok((await auditCount("allow")) >= 1);
    assert.ok((await auditCount("deny")) >= 1);
  });

  it("rejects UPDATE and DELETE on audit_events", async () => {
    await ctx.pool.query(
      `INSERT INTO audit_events (request_id, operation, outcome) VALUES ('t', 'test', 'allow')`,
    );
    await assert.rejects(async () => {
      await ctx.pool.query(`UPDATE audit_events SET operation = 'x' WHERE request_id = 't'`);
    });
    await assert.rejects(async () => {
      await ctx.pool.query(`DELETE FROM audit_events WHERE request_id = 't'`);
    });
  });
});

describe("service envelope (/me)", () => {
  it("wraps /me payload", async () => {
    const access = await loginToken();
    const res = await inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${access}` },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { data: { identity_id: string }; request_id: string };
    assert.equal(body.data.identity_id, "casey-reader");
  });
});

/** Everything the app logger writes while `fn` runs (pino's destination stream, wrapped). */
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

async function auditRow(requestId: string) {
  const r = await ctx.pool.query<{ outcome: string; project_id: string | null; client_id: string | null; operation: string }>(
    `SELECT outcome, project_id, client_id, operation FROM audit_events WHERE request_id = $1 ORDER BY id`,
    [requestId],
  );
  assert.equal(r.rows.length, 1, `one audit row for ${requestId}`);
  return r.rows[0]!;
}

describe("denied calls", () => {
  it("401/403 are the same Problem Details shape, audited, with no secrets in body or logs", async () => {
    const access = await loginToken();
    const fakeBearer = "eyJhbGciOiJub25lIn0.not-a-real-token-SECRET-4711";
    const cases = [
      { rid: "deny-401-none", method: "GET", url: "/api/v1/projects/reqalm", headers: {}, status: 401, code: "unauthenticated" },
      { rid: "deny-401-bad", method: "GET", url: "/api/v1/projects/reqalm", headers: { authorization: `Bearer ${fakeBearer}` }, status: 401, code: "unauthenticated" },
      { rid: "deny-401-me", method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${fakeBearer}` }, status: 401, code: "unauthenticated" },
      { rid: "deny-403-grants", method: "POST", url: "/api/v1/projects/reqalm/grants", headers: { authorization: `Bearer ${access}` }, status: 403, code: "forbidden" },
    ];
    const bodies: string[] = [];
    const logs = await captureAppLogs(async () => {
      for (const c of cases) {
        const res = await ctx.app.inject({
          method: c.method as "GET",
          url: c.url,
          remoteAddress: "203.0.113.50",
          headers: { host: "localhost:3000", "x-request-id": c.rid, ...c.headers },
        });
        assert.equal(res.statusCode, c.status, c.rid);
        assert.match(String(res.headers["content-type"]), /^application\/problem\+json/, c.rid);
        const body = res.json() as Record<string, unknown>;
        assert.deepEqual(Object.keys(body).sort(), ["code", "detail", "request_id", "status", "title", "type"], c.rid);
        assert.equal(body.status, c.status);
        assert.equal(body.code, c.code);
        assert.equal(body.request_id, c.rid);
        bodies.push(res.body);
        const row = await auditRow(c.rid);
        assert.equal(row.outcome, "deny", c.rid);
      }
    });
    assert.ok(logs.includes("deny-403-grants"), "logs were captured");
    for (const [where, text] of [["body", bodies.join("\n")], ["logs", logs]] as const) {
      assert.ok(!text.includes(access), `${where}: no access token`);
      assert.ok(!text.includes(fakeBearer) && !text.includes("SECRET-4711"), `${where}: no presented bearer`);
      assert.doesNotMatch(text, /Bearer |authorization|cookie|password/i, `${where}: no credential material`);
    }
  });
});

describe("scope comes from the session and grants only", () => {
  before(async () => {
    await ctx.pool.query(
      `INSERT INTO projects (id, client_id, name) VALUES ('other', 'reqalm-client', 'Other') ON CONFLICT DO NOTHING`,
    );
  });

  const spoof = {
    "x-project-id": "reqalm",
    "x-reqalm-project": "reqalm",
    "x-client-id": "evil-client",
    "x-reqalm-client": "evil-client",
  };

  it("query or headers naming a granted project do not open an ungranted one", async () => {
    const access = await loginToken();
    const res = await inject({
      method: "GET",
      url: "/api/v1/projects/other?projectId=reqalm&project_id=reqalm&client_id=evil-client",
      headers: { authorization: `Bearer ${access}`, "x-request-id": "scope-spoof-get", ...spoof },
    });
    assert.equal(res.statusCode, 404);
    const row = await auditRow("scope-spoof-get");
    assert.equal(row.project_id, "other");
    assert.equal(row.client_id, "reqalm-web");
  });

  it("query or headers naming another project do not change a granted read", async () => {
    const access = await loginToken();
    const res = await inject({
      method: "GET",
      url: "/api/v1/projects/reqalm?projectId=other",
      headers: { authorization: `Bearer ${access}`, "x-request-id": "scope-spoof-read", "x-project-id": "other" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as { data: { id: string } }).data.id, "reqalm");
    assert.equal((await auditRow("scope-spoof-read")).project_id, "reqalm");
  });

  it("a body naming a granted project does not open an ungranted one", async () => {
    const access = await loginToken();
    const res = await inject({
      method: "POST",
      url: "/api/v1/projects/other/grants",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json", "x-request-id": "scope-spoof-body", ...spoof },
      payload: { projectId: "reqalm", project_id: "reqalm", client_id: "evil-client", role: "Client admin" },
    });
    assert.equal(res.statusCode, 404);
    const row = await auditRow("scope-spoof-body");
    assert.equal(row.project_id, "other");
    assert.equal(row.client_id, "reqalm-web");
  });

  it("client headers do not change who the caller is", async () => {
    const access = await loginToken();
    const res = await inject({
      method: "GET",
      url: "/api/v1/me?client_id=evil-client",
      headers: { authorization: `Bearer ${access}`, "x-request-id": "scope-spoof-me", ...spoof },
    });
    assert.equal(res.statusCode, 200);
    const me = (res.json() as { data: { identity_id: string; grants: Array<{ project_id: string }> } }).data;
    assert.equal(me.identity_id, "casey-reader");
    assert.deepEqual(me.grants.map((g) => g.project_id), ["reqalm"]);
    assert.equal((await auditRow("scope-spoof-me")).client_id, "reqalm-web");
  });
});
