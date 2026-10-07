const params = new URLSearchParams(window.location.search);
const path = window.location.pathname;

const state = {
  tokens: JSON.parse(sessionStorage.getItem("reqaml_tokens") || "null"),
  pending: params.get("pending"),
};

function saveTokens(tokens) {
  state.tokens = tokens;
  sessionStorage.setItem("reqaml_tokens", JSON.stringify(tokens));
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.tokens?.access_token) {
    headers.Authorization = `Bearer ${state.tokens.access_token}`;
  }
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    sessionStorage.removeItem("reqaml_tokens");
    window.location.href = "/login";
    return null;
  }
  return res;
}

function renderShell() {
  document.body.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">ReqAML</div>
        <nav>
          <a href="/app">Home</a>
          <a href="/app/requirements">Requirements</a>
          <a href="/app/releases">Releases</a>
        </nav>
        <button id="signout" type="button">Sign out</button>
      </header>
      <aside class="sidebar">
        <p class="muted">Client scoped view</p>
        <strong>Acme Clinic</strong>
        <p class="muted">Project: reqaml</p>
      </aside>
      <main class="content">
        <h1>Foundation shell</h1>
        <p>Authenticated UI frame (nav, layout, guards). Feature pages are placeholders in R1.</p>
        <section id="me"></section>
      </main>
    </div>`;
  document.getElementById("signout").addEventListener("click", signOut);
  loadMe();
}

async function loadMe() {
  const res = await api("/api/v1/me");
  if (!res) return;
  const me = await res.json();
  const section = document.getElementById("me");
  section.innerHTML = "<h2>Signed in</h2><pre></pre>";
  section.querySelector("pre").textContent = JSON.stringify(me, null, 2);
}

async function signOut() {
  if (state.tokens?.refresh_token) {
    await fetch("/oauth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: state.tokens.refresh_token,
        token_type_hint: "refresh_token",
      }),
    });
  }
  sessionStorage.removeItem("reqaml_tokens");
  window.location.href = "/login";
}

function renderLogin() {
  const pending = params.get("pending") || state.pending;
  document.body.innerHTML = `
    <div class="auth-card">
      <h1>Sign in to ReqAML</h1>
      <p class="muted">Internal OAuth authorization server (local dev account)</p>
      <form id="login-form">
        <label>Username <input name="username" required autocomplete="username" /></label>
        <label>Password <input name="password" type="password" required autocomplete="current-password" /></label>
        <label id="mfa-wrap" hidden>MFA code <input name="mfa_code" inputmode="numeric" /></label>
        <button type="submit">Continue</button>
      </form>
      <p id="error" class="error" hidden></p>
    </div>`;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      username: fd.get("username"),
      password: fd.get("password"),
      pending,
      mfa_code: fd.get("mfa_code") || undefined,
    };
    const res = await fetch("/api/v1/auth/local/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.status === "mfa_required") {
      document.getElementById("mfa-wrap").hidden = false;
      return;
    }
    if (!res.ok) {
      const err = document.getElementById("error");
      err.hidden = false;
      err.textContent = data.error || "Sign-in failed";
      return;
    }
    if (data.redirect) {
      window.location.href = data.redirect;
    }
  });
}

async function handleOAuthCallback() {
  const code = params.get("code");
  const verifier = sessionStorage.getItem("pkce_verifier");
  const expectedState = sessionStorage.getItem("oauth_state");
  sessionStorage.removeItem("oauth_state");
  if (!code || !verifier || !expectedState || params.get("state") !== expectedState) {
    window.location.href = "/login";
    return;
  }
  const resource = `${window.location.origin}/api`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: "reqaml-web",
    redirect_uri: `${window.location.origin}/oauth/callback`,
    code_verifier: verifier,
    resource,
  });
  const res = await fetch("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokens = await res.json();
  if (!res.ok) {
    document.body.innerHTML = `<p>Token exchange failed: ${tokens.error}</p>`;
    return;
  }
  saveTokens(tokens);
  sessionStorage.removeItem("pkce_verifier");
  window.location.href = "/app";
}

function startPkceLogin() {
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const oauthState = crypto.randomUUID();
  sessionStorage.setItem("pkce_verifier", verifier);
  sessionStorage.setItem("oauth_state", oauthState);
  const digest = crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)).then((buf) => {
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const q = new URLSearchParams({
      response_type: "code",
      client_id: "reqaml-web",
      redirect_uri: `${window.location.origin}/oauth/callback`,
      scope: "openid profile",
      state: oauthState,
      code_challenge: b64,
      code_challenge_method: "S256",
      resource: `${window.location.origin}/api`,
    });
    window.location.href = `/oauth/authorize?${q}`;
  });
  void digest;
}

if (path === "/oauth/callback") {
  handleOAuthCallback();
} else if (path === "/login" || path.startsWith("/login")) {
  if (!params.get("pending")) {
    startPkceLogin();
  } else {
    renderLogin();
  }
} else if (path.startsWith("/app")) {
  if (!state.tokens?.access_token) {
    window.location.href = "/login";
  } else {
    renderShell();
  }
} else if (path === "/") {
  window.location.href = state.tokens?.access_token ? "/app" : "/login";
}
