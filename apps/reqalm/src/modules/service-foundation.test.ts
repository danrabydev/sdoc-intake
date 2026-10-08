import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createTestApp,
  issueTestAccessToken,
  TEST_API_RESOURCE,
  TEST_AGENT_SECRET,
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
  body: string;
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
  return issueTestAccessToken(ctx.app, username);
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

  it("an unparsable project id is 404 after auth, identical to a missing project", async () => {
    const access = await loginToken();
    const get = async (id: string) =>
      inject({ method: "GET", url: `/api/v1/projects/${id}`, headers: { authorization: `Bearer ${access}` } });
    const strip = (res: InjectResponse) => {
      const { request_id: _rid, ...rest } = res.json() as Record<string, unknown>;
      return { status: res.statusCode, ctype: res.headers["content-type"], body: rest };
    };
    const missing = strip(await get("no-such-project"));
    assert.equal(missing.status, 404);
    assert.match(String(missing.ctype), /^application\/problem\+json/);
    // Blank or padded ids never resolve to the real project and never leak validation details.
    for (const id of ["%20", "%20reqalm", "reqalm%20", "%09reqalm", "%0a", "%41"]) {
      assert.deepEqual(strip(await get(id)), missing, id);
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

describe("authenticate → scope → permission → validate", () => {
  const bareProblem = (res: { statusCode: number; headers: Record<string, unknown>; json(): unknown }) => {
    assert.match(String(res.headers["content-type"]), /^application\/problem\+json/);
    const { request_id: _rid, ...rest } = res.json() as Record<string, unknown>;
    return { status: res.statusCode, body: rest };
  };
  async function auditDetail(requestId: string) {
    const r = await ctx.pool.query<{ outcome: string; project_id: string | null; detail: Record<string, unknown> }>(
      `SELECT outcome, project_id, detail FROM audit_events WHERE request_id = $1`,
      [requestId],
    );
    assert.equal(r.rows.length, 1, `one audit row for ${requestId}`);
    return r.rows[0]!;
  }
  const call = (rid: string, method: string, url: string, headers: Record<string, string> = {}, payload?: string) =>
    ctx.app.inject({
      method: method as "GET",
      url,
      remoteAddress: "203.0.113.50",
      headers: { host: "localhost:3000", "x-request-id": rid, ...headers },
      ...(payload !== undefined ? { payload } : {}),
    });
  const badJson = { "content-type": "application/json" };

  it("unauthenticated: malformed id or body is the same 401 as any unauthenticated call", async () => {
    const plain = bareProblem(await call("order-401-plain", "GET", "/api/v1/projects/reqalm"));
    assert.equal(plain.status, 401);
    assert.equal("details" in plain.body, false);
    for (const [rid, method, url, headers, payload] of [
      ["order-401-blank", "GET", "/api/v1/projects/%20"],
      ["order-401-padded", "GET", "/api/v1/projects/%20reqalm"],
      ["order-401-ctrl", "GET", "/api/v1/projects/%0areqalm"],
      ["order-401-nul", "GET", "/api/v1/projects/reqalm%00"],
      ["order-401-upper", "GET", "/api/v1/projects/Reqalm"],
      ["order-401-long65", "GET", `/api/v1/projects/${"x".repeat(65)}`],
      ["order-401-long101", "GET", `/api/v1/projects/${"x".repeat(101)}`],
      ["order-401-long4k", "GET", `/api/v1/projects/${"x".repeat(4096)}`],
      ["order-401-long4k-badjson", "POST", `/api/v1/projects/${"x".repeat(4096)}/grants`, badJson, "{"],
      ["order-401-badjson", "POST", "/api/v1/projects/reqalm/grants", badJson, "{"],
      ["order-401-badid-badjson", "POST", "/api/v1/projects/%20/grants", badJson, "{"],
    ] as const) {
      assert.deepEqual(bareProblem(await call(rid, method, url, headers, payload)), plain, rid);
      const row = await auditDetail(rid);
      assert.equal(row.outcome, "deny", rid);
      assert.equal(row.detail.error_code, "unauthenticated", rid);
    }
  });

  it("authenticated without a grant, or with a malformed id: 404 identical to a missing project", async () => {
    const access = await loginToken();
    const auth = { authorization: `Bearer ${access}` };
    const missing = bareProblem(await call("order-404-missing", "POST", "/api/v1/projects/no-such-project/grants", auth));
    assert.equal(missing.status, 404);
    for (const [rid, url, headers, payload] of [
      ["order-404-nogrant-badjson", "/api/v1/projects/secret-proj/grants", { ...auth, ...badJson }, "{"],
      ["order-404-badid", "/api/v1/projects/%20reqalm/grants", auth],
      ["order-404-badid-badjson", "/api/v1/projects/%20/grants", { ...auth, ...badJson }, "{"],
      ["order-404-ctrl", "/api/v1/projects/%0areqalm/grants", auth],
      ["order-404-long101", `/api/v1/projects/${"x".repeat(101)}/grants`, auth],
      ["order-404-long4k", `/api/v1/projects/${"x".repeat(4096)}/grants`, auth],
    ] as const) {
      assert.deepEqual(bareProblem(await call(rid, "POST", url, headers, payload)), missing, rid);
      assert.equal((await auditDetail(rid)).outcome, "deny", rid);
    }
    // The raw (unparsable) id is not written to the audit row.
    assert.equal((await auditDetail("order-404-badid")).project_id, null);
    assert.equal((await auditDetail("order-404-long4k")).project_id, null);
  });

  it("an invalid project id never reaches the logs or the audit row raw", async () => {
    const access = await loginToken();
    const ids = ["ZZQMARK", "%0azzqmark", "zzqmark_x", `zzqmark${"x".repeat(200)}`];
    const logs = await captureAppLogs(async () => {
      for (const [i, id] of ids.entries()) {
        for (const headers of [{}, { authorization: `Bearer ${access}` }] as Record<string, string>[]) {
          const res = await call(`raw-id-${i}`, "GET", `/api/v1/projects/${id}`, headers);
          assert.ok(res.statusCode === 401 || res.statusCode === 404, id);
        }
      }
    });
    assert.ok(logs.includes("raw-id-3"), "logs were captured");
    assert.ok(logs.includes("/api/v1/projects/[invalid]"), "request log keeps the redacted path");
    assert.doesNotMatch(logs, /zzqmark/i);
    const rows = await ctx.pool.query(
      `SELECT project_id FROM audit_events WHERE request_id LIKE 'raw-id-%' AND project_id IS NOT NULL`,
    );
    assert.equal(rows.rowCount, 0);
  });

  it("granted but missing the permission: 403 before the body is validated", async () => {
    const access = await loginToken();
    const res = await call("order-403-badjson", "POST", "/api/v1/projects/reqalm/grants", {
      authorization: `Bearer ${access}`,
      ...badJson,
    }, "{");
    assert.equal(bareProblem(res).status, 403);
    assert.equal((await auditDetail("order-403-badjson")).outcome, "deny");
  });

  // A caller holding grant:manage on reqalm: token first (Tester, no MFA step), then the Project admin
  // grant; RBAC is evaluated per request.
  let adminAccess = "";
  before(async () => {
    adminAccess = await loginToken("taylor-tester@dev.local");
    await ctx.pool.query(
      `INSERT INTO project_grants (id, project_id, identity_id, role)
       VALUES ('grant-taylor-admin', 'reqalm', 'taylor-tester', 'Project admin') ON CONFLICT DO NOTHING`,
    );
  });

  it("authorized caller: a body or query naming another project does not move the call", async () => {
    const res = await call(
      "order-admin-spoof",
      "POST",
      "/api/v1/projects/reqalm/grants?projectId=other",
      { authorization: `Bearer ${adminAccess}`, "content-type": "application/json", "x-project-id": "other" },
      JSON.stringify({ projectId: "other", project_id: "other" }),
    );
    assert.equal(res.statusCode, 200);
    const row = await auditDetail("order-admin-spoof");
    assert.equal(row.outcome, "allow");
    assert.equal(row.project_id, "reqalm");
  });

  it("authorized caller with an unreadable body: 400 Problem Details with the request id, audited", async () => {
    const res = await call("order-400-badjson", "POST", "/api/v1/projects/reqalm/grants", {
      authorization: `Bearer ${adminAccess}`,
      ...badJson,
    }, '{"role": "SECRET-RAW-4711"');
    const problem = bareProblem(res);
    assert.equal(problem.status, 400);
    assert.equal(problem.body.code, "validation");
    assert.equal((res.json() as { request_id: string }).request_id, "order-400-badjson");
    assert.doesNotMatch(res.body, /SECRET-RAW-4711/);
    const row = await auditDetail("order-400-badjson");
    assert.equal(row.outcome, "error");
    assert.equal(row.project_id, "reqalm");
    assert.deepEqual(row.detail, { error_code: "validation" });
  });
});

describe("unknown /api paths", () => {
  it("answer 404 Problem Details with the request id", async () => {
    for (const [method, url] of [
      ["GET", "/api/v1/nope"],
      ["POST", "/api/v1/projects/reqalm/nope"],
      ["GET", "/api"],
      ["DELETE", "/api/v2/anything?x=1"],
    ] as const) {
      const rid = `unknown-${method}-${url.length}`;
      const res = await call404(method, url, rid);
      assert.equal(res.statusCode, 404, url);
      assert.match(String(res.headers["content-type"]), /^application\/problem\+json/, url);
      const body = res.json() as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["code", "detail", "request_id", "status", "title", "type"], url);
      assert.equal(body.code, "not_found");
      assert.equal(body.request_id, rid);
    }
  });

  it("non-API paths still get the web app when the web role is enabled", async () => {
    for (const url of ["/app/some/page", "/apiary"]) {
      const res = await call404("GET", url, "unknown-web");
      assert.equal(res.statusCode, 200, url);
      assert.match(String(res.headers["content-type"]), /^text\/html/, url);
    }
  });

  it("non-API paths return 404 without the web role (no SPA fallback)", async () => {
    const apiOnly = await createTestApp({ roles: "api,mcp" });
    try {
      const res = await apiOnly.app.inject({
        method: "GET",
        url: "/app/some/page",
        remoteAddress: "203.0.113.50",
        headers: { host: "localhost:3000", "x-request-id": "no-web-spa" },
      });
      assert.equal(res.statusCode, 404);
      assert.deepEqual(res.json(), { error: "not_found" });
    } finally {
      await apiOnly.close();
    }
  });

  it("serves the web static bundle from the web role", async () => {
    const res = await inject({ method: "GET", url: "/" });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["content-type"]), /^text\/html/);
    assert.match(res.body, /<!DOCTYPE html>/i);
  });

  function call404(method: string, url: string, rid: string) {
    return ctx.app.inject({
      method: method as "GET",
      url,
      remoteAddress: "203.0.113.50",
      headers: { host: "localhost:3000", "x-request-id": rid },
    });
  }
});
