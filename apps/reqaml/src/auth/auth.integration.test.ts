import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { isIpThrottled } from "../credential/ip-throttle.js";
import { getLockoutState, LOCKOUT_DURATION_MS } from "../credential/lockout.js";
import {
  createTestApp,
  pkcePair,
  TEST_API_RESOURCE,
  TEST_ISSUER,
  TEST_MFA_SECRET,
  TEST_AGENT_SECRET,
  TEST_PASSWORD,
  totpNow,
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
  body: string;
};

function inject(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  payload?: string | object;
  remoteAddress?: string;
}): Promise<InjectResponse> {
  const { remoteAddress = "203.0.113.50", headers, ...rest } = opts;
  return ctx.app.inject({
    ...rest,
    remoteAddress,
    headers: {
      host: "localhost:3000",
      ...headers,
    },
  } as never) as Promise<InjectResponse>;
}

async function authorizeHandoff(remoteAddress?: string) {
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(8).toString("hex");
  const redirectUri = `${TEST_ISSUER}/oauth/callback`;
  const res = await inject({
    remoteAddress,
    method: "GET",
    url: `/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: "reqaml-web",
      redirect_uri: redirectUri,
      scope: "openid profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: TEST_API_RESOURCE,
    })}`,
  });
  assert.equal(res.statusCode, 302);
  const loc = String(res.headers.location ?? "");
  const handoff = new URL(loc, TEST_ISSUER).searchParams.get("h");
  assert.ok(handoff);
  return { handoff, verifier, redirectUri, state };
}

async function localLogin(
  username: string,
  password: string,
  handoff: string,
  extra: Record<string, string> = {},
  remoteAddress?: string,
) {
  return inject({
    remoteAddress,
    method: "POST",
    url: "/api/v1/auth/local/login",
    headers: { "content-type": "application/json" },
    payload: { username, password, h: handoff, ...extra },
  });
}

async function postForm(path: string, params: Record<string, string>) {
  return inject({
    method: "POST",
    url: path,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(params).toString(),
  });
}

async function loginAndExchange(username = "casey-reader@dev.local") {
  const { handoff, verifier, redirectUri } = await authorizeHandoff();
  const login = await localLogin(username, TEST_PASSWORD, handoff);
  assert.equal(login.statusCode, 200);
  const body = login.json() as { redirect: string };
  const code = new URL(body.redirect, TEST_ISSUER).searchParams.get("code");
  assert.ok(code);
  const token = await postForm("/oauth/token", {
    grant_type: "authorization_code",
    code,
    client_id: "reqaml-web",
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: TEST_API_RESOURCE,
  });
  assert.equal(token.statusCode, 200);
  return token.json() as { access_token: string; refresh_token: string };
}

describe("auth routes (in-process)", () => {
  it("rejects unregistered redirect_uri at authorize", async () => {
    const { challenge } = pkcePair();
    const res = await inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: "reqaml-web",
        redirect_uri: "https://evil.example/callback",
        state: "s",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: TEST_API_RESOURCE,
      })}`,
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { error_description?: string };
    assert.match(body.error_description ?? "", /redirect_uri/i);
  });

  it("authorization code + PKCE flow issues tokens", async () => {
    const tokens = await loginAndExchange();
    assert.ok(tokens.access_token);
    assert.ok(tokens.refresh_token);
  });

  it("refresh rotation and reuse revokes the family", async () => {
    const tokens = await loginAndExchange();
    const r1 = await postForm("/oauth/token", {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: "reqaml-web",
      resource: TEST_API_RESOURCE,
    });
    assert.equal(r1.statusCode, 200);
    const old = tokens.refresh_token;
    const reuse = await postForm("/oauth/token", {
      grant_type: "refresh_token",
      refresh_token: old,
      client_id: "reqaml-web",
      resource: TEST_API_RESOURCE,
    });
    assert.notEqual(reuse.statusCode, 200);
    const r1Body = r1.json() as { refresh_token: string };
    const afterReuse = await postForm("/oauth/token", {
      grant_type: "refresh_token",
      refresh_token: r1Body.refresh_token,
      client_id: "reqaml-web",
      resource: TEST_API_RESOURCE,
    });
    assert.notEqual(afterReuse.statusCode, 200);
  });

  async function lockOutTaylor() {
    await ctx.pool.query(
      `UPDATE local_credentials
       SET failed_attempts = 0, locked_until = NULL, last_failed_at = NULL
       WHERE identity_id = 'taylor-tester'`,
    );
    for (let i = 0; i < 3; i++) {
      const { handoff } = await authorizeHandoff();
      await localLogin("taylor-tester@dev.local", "wrong", handoff);
    }
  }

  it("lockout after 3 failures and username normalization", async () => {
    await lockOutTaylor();
    const { handoff } = await authorizeHandoff();
    const locked = await localLogin("taylor-tester@dev.local", TEST_PASSWORD, handoff);
    assert.equal(locked.statusCode, 423);
    const { handoff: h2 } = await authorizeHandoff();
    const variant = await localLogin(" TAYLOR-TESTER@dev.local ", TEST_PASSWORD, h2);
    assert.equal(variant.statusCode, 423);
  });

  it("lockout stays enforced during the lock window and clears after it", async () => {
    await lockOutTaylor();
    const during = await getLockoutState(ctx.pool, "taylor-tester");
    assert.equal(during.locked, true);
    assert.ok(during.lockedUntil);
    const lockedMs = during.lockedUntil!.getTime() - Date.now();
    assert.ok(lockedMs > 0 && lockedMs <= LOCKOUT_DURATION_MS + 5_000);
    const { handoff: mid } = await authorizeHandoff();
    assert.equal(
      (await localLogin("taylor-tester@dev.local", TEST_PASSWORD, mid)).statusCode,
      423,
    );

    await ctx.pool.query(
      `UPDATE local_credentials
       SET locked_until = now() - interval '1 minute',
           last_failed_at = now() - interval '16 minutes',
           failed_attempts = 0
       WHERE identity_id = 'taylor-tester'`,
    );
    const after = await getLockoutState(ctx.pool, "taylor-tester");
    assert.equal(after.locked, false);
    const { handoff: okHandoff } = await authorizeHandoff();
    assert.equal(
      (await localLogin("taylor-tester@dev.local", TEST_PASSWORD, okHandoff)).statusCode,
      200,
    );
  });

  it("IP throttle counts failures only", async () => {
    const ip = "198.51.100.77";
    const failLogin = async () => {
      const { handoff } = await authorizeHandoff(ip);
      await inject({
        method: "POST",
        url: "/api/v1/auth/local/login",
        remoteAddress: ip,
        headers: { "content-type": "application/json" },
        payload: { username: "nobody@dev.local", password: "x", h: handoff },
      });
    };
    for (let i = 0; i < 19; i++) await failLogin();
    assert.equal(await isIpThrottled(ctx.pool, ip), false);
    const { handoff } = await authorizeHandoff(ip);
    const ok = await localLogin("casey-reader@dev.local", TEST_PASSWORD, handoff, {}, ip);
    assert.equal(ok.statusCode, 200);
    assert.equal(await isIpThrottled(ctx.pool, ip), false);
    await failLogin();
    assert.equal(await isIpThrottled(ctx.pool, ip), true);
  });

  it("TOTP replay rejected; one wrong MFA code does not lock", async () => {
    const totpIp = "198.51.100.88";
    const { handoff } = await authorizeHandoff(totpIp);
    const step1 = await localLogin("sam-security@dev.local", TEST_PASSWORD, handoff, {}, totpIp);
    assert.equal((step1.json() as { status?: string }).status, "mfa_required");
    const code = totpNow(TEST_MFA_SECRET);
    const step2 = await localLogin(
      "sam-security@dev.local",
      TEST_PASSWORD,
      handoff,
      { mfa_code: code },
      totpIp,
    );
    assert.equal(step2.statusCode, 200);
    const { handoff: h2 } = await authorizeHandoff(totpIp);
    const replay = await localLogin(
      "sam-security@dev.local",
      TEST_PASSWORD,
      h2,
      { mfa_code: code },
      totpIp,
    );
    assert.equal((replay.json() as { error?: string }).error, "invalid_mfa");
    // The wrong code counts exactly once; password-only steps give their reservation back.
    const afterWrong = await getLockoutState(ctx.pool, "sam-security");
    assert.equal(afterWrong.failedAttempts, 1);
    assert.equal(afterWrong.locked, false);
    for (let i = 0; i < 3; i++) {
      const { handoff: hNew } = await authorizeHandoff(totpIp);
      const again = await localLogin("sam-security@dev.local", TEST_PASSWORD, hNew, {}, totpIp);
      assert.equal((again.json() as { status?: string }).status, "mfa_required");
    }
    assert.equal((await getLockoutState(ctx.pool, "sam-security")).failedAttempts, 1);
  });

  it("CSRF required on cookie-authenticated mutations", async () => {
    const csrfIp = "198.51.100.79";
    const start = await inject({ method: "GET", url: "/oauth/web/start", remoteAddress: csrfIp });
    assert.equal(start.statusCode, 302);
    const authz = await inject({
      method: "GET",
      url: String(start.headers.location ?? ""),
      remoteAddress: csrfIp,
    });
    const h = new URL(String(authz.headers.location ?? ""), TEST_ISSUER).searchParams.get("h");
    assert.ok(h);
    const login = await localLogin("casey-reader@dev.local", TEST_PASSWORD, h, {}, csrfIp);
    assert.equal(login.statusCode, 200);
    const loginBody = login.json() as { csrf_token: string };
    const setCookie = login.headers["set-cookie"];
    const cookieHeader = (Array.isArray(setCookie) ? setCookie : [setCookie])
      .filter(Boolean)
      .map((c) => String(c).split(";")[0])
      .join("; ");
    const noCsrf = await inject({
      method: "POST",
      url: "/api/v1/projects/reqaml/grants",
      remoteAddress: csrfIp,
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      payload: "{}",
    });
    assert.equal(noCsrf.statusCode, 401);
    const withCsrf = await inject({
      method: "POST",
      url: "/api/v1/projects/reqaml/grants",
      remoteAddress: csrfIp,
      headers: {
        cookie: cookieHeader,
        "x-csrf-token": loginBody.csrf_token,
        "content-type": "application/json",
      },
      payload: "{}",
    });
    assert.equal(withCsrf.statusCode, 403);
  });

  it("agent token role narrowing and TTL cap", async () => {
    const mint = (extra: Record<string, string>) =>
      postForm("/oauth/token", {
        grant_type: "client_credentials",
        client_id: "reqaml-agent-dev",
        client_secret: TEST_AGENT_SECRET,
        agent_name: "cursor-cloud",
        resource: TEST_API_RESOURCE,
        ...extra,
      });
    const cc = await mint({ ttl_seconds: "86400" });
    assert.equal(cc.statusCode, 200);
    const ccBody = cc.json() as { reqaml_role: string; expires_in: number; access_token: string };
    assert.equal(ccBody.reqaml_role, "Reader");
    assert.ok(ccBody.expires_in <= 3600);
    const author = await mint({ role: "Author" });
    assert.equal((author.json() as { reqaml_role: string }).reqaml_role, "Author");
    for (const role of ["Developer", "Security", "Project admin"]) {
      const denied = await mint({ role });
      assert.equal(denied.statusCode, 400);
      assert.equal((denied.json() as { error: string }).error, "invalid_scope");
    }
    const wrongAud = await inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${ccBody.access_token}`,
        "content-type": "application/json",
      },
      payload: "{}",
    });
    assert.equal(wrongAud.statusCode, 401);

    const mcpResource = `${TEST_ISSUER}/mcp`;
    const mcpMint = await mint({ resource: mcpResource });
    assert.equal(mcpMint.statusCode, 200);
    const mcpToken = (mcpMint.json() as { access_token: string }).access_token;
    const mcpOk = await inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${mcpToken}`,
        "content-type": "application/json",
      },
      payload: "{}",
    });
    assert.equal(mcpOk.statusCode, 200);

    const revoke = await postForm("/oauth/revoke", {
      token: ccBody.access_token,
      token_type_hint: "access_token",
    });
    assert.equal(revoke.statusCode, 200);
    const afterRevoke = await inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${ccBody.access_token}` },
    });
    assert.equal(afterRevoke.statusCode, 401);
  });
});
