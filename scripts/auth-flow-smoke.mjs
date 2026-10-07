#!/usr/bin/env node
/**
 * Auth integration checks for R1 (run against a live ReqAML stack).
 * Used by pnpm devenv:smoke after the base health/seed checks.
 */
import { createHash, randomBytes } from "node:crypto";

const baseUrl = process.env.REQAML_SMOKE_URL ?? "http://127.0.0.1:3000";

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

async function getJson(path) {
  const res = await fetch(`${baseUrl}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

async function authorizePending(resource) {
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(8).toString("hex");
  const redirectUri = `${baseUrl}/oauth/callback`;
  const authz = await fetch(
    `${baseUrl}/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: "reqaml-web",
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
  const pending = new URL(loc, baseUrl).searchParams.get("pending");
  if (!pending) fail("missing pending login handoff", loc);
  return { pending, verifier, redirectUri };
}

async function localLogin(username, password, pending) {
  const res = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, pending }),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

async function loginAndExchange(username, password, resource) {
  const { pending, verifier, redirectUri } = await authorizePending(resource);
  const login = await localLogin(username, password, pending);
  const loginBody = login.body;
  if (!login.ok) fail("local login failed", loginBody);
  const cb = new URL(loginBody.redirect);
  const code = cb.searchParams.get("code");
  if (!code) fail("missing authorization code", loginBody);

  const token = await postForm("/oauth/token", {
    grant_type: "authorization_code",
    code,
    client_id: "reqaml-web",
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource,
  });
  if (token.status !== 200 || !token.body.access_token) {
    fail("token exchange failed", token);
  }
  return token.body;
}

export async function runAuthFlowSmoke(devPassword) {
  const apiResource = `${baseUrl}/api`;
  const mcpResource = `${baseUrl}/mcp`;

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
      client_id: "reqaml-web",
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

  const readerUser = "casey-reader@dev.local";
  const tokens = await loginAndExchange(readerUser, devPassword, apiResource);

  const me = await fetch(`${baseUrl}/api/v1/me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (me.status !== 200) fail("/api/v1/me unauthorized", await me.text());

  const rbacDeny = await fetch(`${baseUrl}/api/v1/projects/reqaml/grants`, {
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
    client_id: "reqaml-web",
    resource: apiResource,
  });
  if (refresh1.status !== 200) fail("refresh failed", refresh1);
  const oldRefresh = tokens.refresh_token;
  const reuse = await postForm("/oauth/token", {
    grant_type: "refresh_token",
    refresh_token: oldRefresh,
    client_id: "reqaml-web",
    resource: apiResource,
  });
  if (reuse.status === 200) fail("refresh reuse should be denied", reuse);
  // Reuse revokes the whole family, including the token issued by the legitimate rotation.
  const afterReuse = await postForm("/oauth/token", {
    grant_type: "refresh_token",
    refresh_token: refresh1.body.refresh_token,
    client_id: "reqaml-web",
    resource: apiResource,
  });
  if (afterReuse.status === 200) fail("reuse should revoke the rotated token's family", afterReuse);

  // Revocation (RFC 7009) on a fresh login: refresh token and access token.
  const fresh = await loginAndExchange(readerUser, devPassword, apiResource);
  await postForm("/oauth/revoke", {
    token: fresh.refresh_token,
    token_type_hint: "refresh_token",
  });
  const afterRevoke = await postForm("/oauth/token", {
    grant_type: "refresh_token",
    refresh_token: fresh.refresh_token,
    client_id: "reqaml-web",
    resource: apiResource,
  });
  if (afterRevoke.status === 200) fail("revoked refresh should fail", afterRevoke);
  await postForm("/oauth/revoke", { token: fresh.access_token, token_type_hint: "access_token" });
  const revokedAccess = await fetch(`${baseUrl}/api/v1/me`, {
    headers: { Authorization: `Bearer ${fresh.access_token}` },
  });
  if (revokedAccess.status !== 401) fail("revoked access token should 401", revokedAccess.status);

  // The pending handoff round-trips through the browser: a tampered redirect_uri must be refused.
  {
    const { pending } = await authorizePending(apiResource);
    const decoded = JSON.parse(Buffer.from(pending, "base64url").toString("utf8"));
    decoded.redirectUri = "https://attacker.example/cb";
    const tampered = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const res = await localLogin(readerUser, devPassword, tampered);
    if (res.ok) fail("tampered pending redirect_uri must be refused", res);
  }

  const lockUser = "taylor-tester@dev.local";
  for (let i = 0; i < 3; i++) {
    const { pending } = await authorizePending(apiResource);
    await localLogin(lockUser, "definitely-wrong", pending);
  }
  {
    const { pending } = await authorizePending(apiResource);
    const locked = await localLogin(lockUser, devPassword, pending);
    if (locked.status !== 423) fail("lockout expected after failures", locked);
  }
  // Case/whitespace variants of the username must not get around the lock.
  for (const variant of ["TAYLOR-TESTER@dev.local", " taylor-tester@dev.local", "taylor-tester@dev.local "]) {
    const { pending } = await authorizePending(apiResource);
    const res = await localLogin(variant, devPassword, pending);
    if (res.ok) fail(`lockout bypassed via username variant ${JSON.stringify(variant)}`, res);
  }

  return {
    ok: true,
    as_metadata: true,
    pkce_plain_denied: true,
    dcr_disabled: true,
    auth_code_pkce: true,
    refresh_rotation: true,
    refresh_reuse_denied: true,
    refresh_reuse_revokes_family: true,
    revocation: true,
    access_token_revocation: true,
    pending_tamper_refused: true,
    lockout_variants_refused: true,
    rbac_deny: true,
    wrong_audience_denied: true,
    lockout: true,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const password = process.env.REQAML_DEV_ACCOUNT_PASSWORD;
  if (!password) {
    console.error("REQAML_DEV_ACCOUNT_PASSWORD required for auth-flow-smoke");
    process.exit(1);
  }
  runAuthFlowSmoke(password)
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((err) => {
      console.error(err.message);
      if (err.detail) console.error(JSON.stringify(err.detail, null, 2));
      process.exit(1);
    });
}
