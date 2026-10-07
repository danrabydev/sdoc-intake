#!/usr/bin/env node
/**
 * Auth integration checks for R1 (run against a live ReqALM stack).
 * Used by pnpm devenv:smoke after the base health/seed checks.
 */
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "../apps/reqalm/package.json"));
const { Secret, TOTP } = require("otpauth");

const baseUrl = process.env.REQALM_SMOKE_URL ?? "http://127.0.0.1:3000";

function fail(msg, detail) {
  const err = new Error(msg);
  err.detail = detail;
  throw err;
}

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

async function postForm(path, params) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

async function getJson(path, init) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const body = await res.json();
  return { status: res.status, body };
}

async function authorizeHandoff(resource) {
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(8).toString("hex");
  const redirectUri = `${baseUrl}/oauth/callback`;
  const authz = await fetch(
    `${baseUrl}/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: "reqalm-web",
      redirect_uri: redirectUri,
      scope: "openid profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
    })}`,
    { redirect: "manual" },
  );
  if (authz.status !== 302) {
    fail("authorize redirect expected", { status: authz.status });
  }
  const loc = authz.headers.get("location") ?? "";
  const handoff = new URL(loc, baseUrl).searchParams.get("h");
  if (!handoff) fail("missing server-side login handoff (h)", loc);
  return { handoff, verifier, redirectUri, state };
}

async function localLogin(username, password, handoff, extra = {}) {
  const res = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, h: handoff, ...extra }),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

function totpNow(secretBase32) {
  const totp = new TOTP({ secret: Secret.fromBase32(secretBase32) });
  return totp.generate();
}

async function loginAndExchange(username, password, resource, mfaCode) {
  const { handoff, verifier, redirectUri } = await authorizeHandoff(resource);
  let login = await localLogin(username, password, handoff, mfaCode ? { mfa_code: mfaCode } : {});
  if (login.body?.status === "mfa_required" && !mfaCode) {
    fail("unexpected mfa_required without enrolled MFA or secret", login.body);
  }
  const loginBody = login.body;
  if (!login.ok) fail("local login failed", loginBody);
  const cb = new URL(loginBody.redirect);
  const code = cb.searchParams.get("code");
  if (!code) fail("missing authorization code", loginBody);

  const token = await postForm("/oauth/token", {
    grant_type: "authorization_code",
    code,
    client_id: "reqalm-web",
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource,
  });
  if (token.status !== 200 || !token.body.access_token) {
    fail("token exchange failed", token);
  }
  return token.body;
}

async function webSessionLogin(username, password) {
  const start = await fetch(`${baseUrl}/oauth/web/start`, { redirect: "manual" });
  if (start.status !== 302) fail("/oauth/web/start should redirect", start.status);
  const authz = await fetch(new URL(start.headers.get("location"), baseUrl), { redirect: "manual" });
  if (authz.status !== 302) fail("web authorize should redirect to /login", authz.status);
  const h = new URL(authz.headers.get("location"), baseUrl).searchParams.get("h");
  if (!h) fail("web login handoff missing", authz.headers.get("location"));
  const res = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, h }),
  });
  const body = await res.json();
  if (!res.ok || !body.csrf_token) fail("web session login failed", body);
  const setCookies = res.headers.getSetCookie();
  const sessionCookie = setCookies.find((c) => c.startsWith("reqalm_session="));
  if (!sessionCookie) fail("no reqalm_session cookie", setCookies);
  const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
  return { sessionCookie, cookieHeader, csrf: body.csrf_token };
}

async function privilegedLoginWithMfa(username, password, resource, mfaDevSecret) {
  const { handoff } = await authorizeHandoff(resource);
  const step1 = await localLogin(username, password, handoff);
  if (step1.body?.status !== "mfa_required") {
    fail("privileged login should require MFA", step1);
  }
  const code = totpNow(mfaDevSecret);
  const step2 = await localLogin(username, password, handoff, { mfa_code: code });
  if (!step2.ok || !step2.body?.redirect) {
    fail("privileged MFA login failed", step2);
  }
  const cb = new URL(step2.body.redirect);
  if (!cb.searchParams.get("code")) fail("missing code after MFA login", step2.body);
  // Replay: the same TOTP code must not work twice.
  const { handoff: h2 } = await authorizeHandoff(resource);
  const replay = await localLogin(username, password, h2, { mfa_code: code });
  if (replay.ok || replay.body?.error !== "invalid_mfa") fail("replayed TOTP code must be rejected", replay);
  // One wrong code counts once and the password-only step counts zero, so a typo does not lock
  // the account (it used to: password step 1 + wrong code 2 = threshold 3).
  for (let i = 0; i < 2; i++) {
    const again = await localLogin(username, password, h2);
    if (again.body?.status !== "mfa_required") fail("one wrong MFA code must not lock the account", again);
  }
  return { ok: true, code: cb.searchParams.get("code") };
}

export async function runAuthFlowSmoke(devPassword, opts = {}) {
  const { mfaDevSecret, agentClientSecret } = opts;
  const apiResource = `${baseUrl}/api`;

  const asMeta = await getJson("/.well-known/oauth-authorization-server");
  if (asMeta.status !== 200 || !asMeta.body.authorization_endpoint) {
    fail("AS metadata missing", asMeta);
  }
  const prm = await getJson("/.well-known/oauth-protected-resource/api");
  if (prm.status !== 200 || prm.body.resource !== apiResource) {
    fail("protected resource metadata missing", prm);
  }

  const plain = await fetch(
    `${baseUrl}/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: "reqalm-web",
      redirect_uri: `${baseUrl}/oauth/callback`,
      state: "x",
      code_challenge: "plaintext",
      code_challenge_method: "plain",
      resource: apiResource,
    })}`,
  );
  const plainBody = await plain.json();
  if (plain.status !== 400) fail("plain PKCE should be denied", plainBody);

  const dcr = await postForm("/oauth/register", { client_name: "evil" });
  if (dcr.status !== 403) fail("DCR should be disabled", dcr);

  const unauthConnectors = await getJson("/api/v1/auth/upstream/connectors");
  if (unauthConnectors.status !== 401) {
    fail("upstream connectors must require auth", unauthConnectors.status);
  }

  const readerUser = "casey-reader@dev.local";
  const tokens = await loginAndExchange(readerUser, devPassword, apiResource);

  const me = await fetch(`${baseUrl}/api/v1/me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (me.status !== 200) fail("/api/v1/me unauthorized", await me.text());

  const rbacDeny = await fetch(`${baseUrl}/api/v1/projects/reqalm/grants`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (rbacDeny.status !== 403) fail("RBAC deny expected for Reader", rbacDeny.status);

  const wrongAud = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (wrongAud.status !== 401) fail("wrong audience should 401 at MCP", wrongAud.status);

  const refresh1 = await postForm("/oauth/token", {
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: "reqalm-web",
    resource: apiResource,
  });
  if (refresh1.status !== 200) fail("refresh failed", refresh1);
  const oldRefresh = tokens.refresh_token;
  const reuse = await postForm("/oauth/token", {
    grant_type: "refresh_token",
    refresh_token: oldRefresh,
    client_id: "reqalm-web",
    resource: apiResource,
  });
  if (reuse.status === 200) fail("refresh reuse should be denied", reuse);
  const afterReuse = await postForm("/oauth/token", {
    grant_type: "refresh_token",
    refresh_token: refresh1.body.refresh_token,
    client_id: "reqalm-web",
    resource: apiResource,
  });
  if (afterReuse.status === 200) fail("reuse should revoke the rotated token's family", afterReuse);

  const fresh = await loginAndExchange(readerUser, devPassword, apiResource);
  await postForm("/oauth/revoke", {
    token: fresh.refresh_token,
    token_type_hint: "refresh_token",
  });
  const afterRevoke = await postForm("/oauth/token", {
    grant_type: "refresh_token",
    refresh_token: fresh.refresh_token,
    client_id: "reqalm-web",
    resource: apiResource,
  });
  if (afterRevoke.status === 200) fail("revoked refresh should fail", afterRevoke);
  await postForm("/oauth/revoke", { token: fresh.access_token, token_type_hint: "access_token" });
  const revokedAccess = await fetch(`${baseUrl}/api/v1/me`, {
    headers: { Authorization: `Bearer ${fresh.access_token}` },
  });
  if (revokedAccess.status !== 401) fail("revoked access token should 401", revokedAccess.status);

  {
    const bogus = randomBytes(16).toString("hex");
    const res = await localLogin(readerUser, devPassword, bogus);
    if (res.ok) fail("unknown/expired handoff must be refused", res);
  }

  const lockUser = "taylor-tester@dev.local";
  for (let i = 0; i < 3; i++) {
    const { handoff } = await authorizeHandoff(apiResource);
    await localLogin(lockUser, "definitely-wrong", handoff);
  }
  {
    const { handoff } = await authorizeHandoff(apiResource);
    const locked = await localLogin(lockUser, devPassword, handoff);
    if (locked.status !== 423) fail("lockout expected after failures", locked);
  }
  for (const variant of ["TAYLOR-TESTER@dev.local", " taylor-tester@dev.local", "taylor-tester@dev.local "]) {
    const { handoff } = await authorizeHandoff(apiResource);
    const res = await localLogin(variant, devPassword, handoff);
    if (res.ok) fail(`lockout bypassed via username variant ${JSON.stringify(variant)}`, res);
  }

  // BFF web session: HttpOnly cookie + CSRF on state-changing requests.
  const web = await webSessionLogin(readerUser, devPassword);
  const flags = web.sessionCookie.toLowerCase();
  if (!flags.includes("httponly") || !flags.includes("samesite=lax")) {
    fail("session cookie must be HttpOnly and SameSite=Lax", web.sessionCookie);
  }
  if (flags.includes("secure")) fail("dev (http) session cookie should not be Secure-only", web.sessionCookie);
  const webMe = await fetch(`${baseUrl}/api/v1/me`, { headers: { Cookie: web.cookieHeader } });
  if (webMe.status !== 200) fail("cookie session /api/v1/me failed", webMe.status);
  const noCsrf = await fetch(`${baseUrl}/api/v1/projects/reqalm/grants`, {
    method: "POST",
    headers: { Cookie: web.cookieHeader, "Content-Type": "application/x-www-form-urlencoded" },
    body: "role=Reader",
  });
  if (noCsrf.status !== 401) fail("cookie form POST without CSRF token must be rejected", noCsrf.status);
  const withCsrf = await fetch(`${baseUrl}/api/v1/projects/reqalm/grants`, {
    method: "POST",
    headers: { Cookie: web.cookieHeader, "X-CSRF-Token": web.csrf, "Content-Type": "application/json" },
    body: "{}",
  });
  if (withCsrf.status !== 403) fail("cookie POST with CSRF should reach RBAC (403 for Reader)", withCsrf.status);
  const signout = await fetch(`${baseUrl}/api/v1/auth/signout`, {
    method: "POST",
    headers: { Cookie: web.cookieHeader, "X-CSRF-Token": web.csrf },
  });
  if (signout.status !== 200) fail("signout failed", signout.status);
  const afterSignout = await fetch(`${baseUrl}/api/v1/me`, { headers: { Cookie: web.cookieHeader } });
  if (afterSignout.status !== 401) fail("session must be dead after signout", afterSignout.status);

  let privilegedMfa = false;
  if (mfaDevSecret) {
    await privilegedLoginWithMfa("sam-security@dev.local", devPassword, apiResource, mfaDevSecret);
    privilegedMfa = true;
  }

  let agentToken = false;
  let agentJti = null;
  if (agentClientSecret) {
    const mint = (extra) =>
      postForm("/oauth/token", {
        grant_type: "client_credentials",
        client_id: "reqalm-agent-dev",
        client_secret: agentClientSecret,
        agent_name: "cursor-cloud",
        resource: apiResource,
        ...extra,
      });
    // Default role is Reader; TTL is capped at 1h.
    const cc = await mint({ ttl_seconds: "86400" });
    if (cc.status !== 200 || !cc.body.access_token) fail("agent client_credentials failed", cc);
    if (cc.body.reqalm_role !== "Reader" || cc.body.expires_in > 3600) {
      fail("agent token should default to Reader with TTL <= 3600", cc.body);
    }
    const claims = JSON.parse(Buffer.from(cc.body.access_token.split(".")[1], "base64url").toString());
    if (claims.sub !== "agent-cursor-cloud" || claims.aud !== apiResource || claims.reqalm_role !== "Reader") {
      fail("agent token must be its own principal, audience-bound, Reader", claims);
    }
    agentJti = claims.jti;
    const agentMe = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { Authorization: `Bearer ${cc.body.access_token}` },
    });
    const agentMeBody = await agentMe.json();
    if (agentMe.status !== 200 || JSON.stringify(agentMeBody.data?.effective_roles) !== '["Reader"]') {
      fail("agent token effective roles should be [Reader]", agentMeBody);
    }
    const author = await mint({ role: "Author" });
    if (author.status !== 200 || author.body.reqalm_role !== "Author") fail("Author agent token should mint", author);
    for (const role of ["Project admin", "Developer", "Security"]) {
      const denied = await mint({ role });
      if (denied.status !== 400 || denied.body.error !== "invalid_scope") {
        fail(`agent role ${role} must be refused at mint`, denied);
      }
    }
    const wrongAudAgent = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cc.body.access_token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (wrongAudAgent.status !== 401) fail("API-audience agent token must 401 at MCP", wrongAudAgent.status);
    // Mutation attempt (audited with agent attribution), then revocation.
    const agentMut = await fetch(`${baseUrl}/api/v1/projects/reqalm/grants`, {
      method: "POST",
      headers: { Authorization: `Bearer ${author.body.access_token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (agentMut.status !== 403) fail("Author agent must not manage grants", agentMut.status);
    await postForm("/oauth/revoke", { token: cc.body.access_token, token_type_hint: "access_token" });
    const revokedAgent = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { Authorization: `Bearer ${cc.body.access_token}` },
    });
    if (revokedAgent.status !== 401) fail("revoked agent token should 401", revokedAgent.status);
    agentToken = true;
  }

  return {
    ok: true,
    as_metadata: true,
    pkce_plain_denied: true,
    dcr_disabled: true,
    upstream_connectors_auth_required: true,
    auth_code_pkce: true,
    refresh_rotation: true,
    refresh_reuse_denied: true,
    refresh_reuse_revokes_family: true,
    revocation: true,
    access_token_revocation: true,
    handoff_tamper_refused: true,
    lockout_variants_refused: true,
    rbac_deny: true,
    wrong_audience_denied: true,
    lockout: true,
    web_session_cookie_flags: true,
    csrf_required_for_cookie_mutation: true,
    signout_kills_session: true,
    privileged_mfa_login: privilegedMfa,
    totp_replay_rejected: privilegedMfa,
    agent_client_credentials: agentToken,
    agent_role_default_reader_and_refused_above_author: agentToken,
    agent_token_revocation: agentToken,
    agent_jti: agentJti,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const password = process.env.REQALM_DEV_ACCOUNT_PASSWORD;
  if (!password) {
    console.error("REQALM_DEV_ACCOUNT_PASSWORD required for auth-flow-smoke");
    process.exit(1);
  }
  runAuthFlowSmoke(password, {
    mfaDevSecret: process.env.REQALM_MFA_DEV_SECRET,
    agentClientSecret: process.env.REQALM_AGENT_CLIENT_SECRET,
  })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((err) => {
      console.error(err.message);
      if (err.detail) console.error(JSON.stringify(err.detail, null, 2));
      process.exit(1);
    });
}
