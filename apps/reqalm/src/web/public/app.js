const params = new URLSearchParams(window.location.search);
const path = window.location.pathname;

function csrfToken() {
  const match = document.cookie.match(/(?:^|; )reqalm_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "className") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const csrf = csrfToken();
  if (csrf && (options.method === "POST" || options.method === "DELETE")) {
    headers["X-CSRF-Token"] = csrf;
  }
  const res = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (res.status === 401) {
    window.location.href = "/login";
    return null;
  }
  return res;
}

async function sessionOk() {
  const res = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
  if (!res.ok) return false;
  const body = await res.json();
  return body.authenticated === true;
}

function renderShell() {
  document.body.replaceChildren();
  const shell = el("div", { className: "shell" }, [
    el("header", { className: "topbar" }, [
      el("div", { className: "brand", text: "ReqALM" }),
      el("nav", {}, [
        el("a", { href: "/app", text: "Home" }),
        el("a", { href: "/app/clients", text: "Clients" }),
        el("a", { href: "/app/requirements", text: "Requirements" }),
        el("a", { href: "/app/releases", text: "Releases" }),
      ]),
      el("button", { id: "signout", type: "button", text: "Sign out" }),
    ]),
    el("aside", { className: "sidebar" }, [
      el("p", { className: "muted", text: "Client scoped view" }),
      el("strong", { text: "Acme Clinic" }),
      el("p", { className: "muted", text: "Project: reqalm" }),
    ]),
    el("main", { className: "content" }, [
      el("h1", { text: "Foundation shell" }),
      el("p", {
        text: "Authenticated UI frame (nav, layout, guards). Feature pages are placeholders in R1.",
      }),
      el("section", { id: "me" }),
    ]),
  ]);
  document.body.append(shell);
  document.getElementById("signout").addEventListener("click", signOut);
  loadMe();
}

async function loadMe() {
  const res = await api("/api/v1/me");
  if (!res) return;
  const body = await res.json();
  const me = body.data ?? body;
  const section = document.getElementById("me");
  section.replaceChildren(
    el("h2", { text: "Signed in" }),
    el("pre", { text: JSON.stringify(me, null, 2) }),
  );
}

async function renderBrowsePage(kind, id) {
  renderShell();
  const main = document.querySelector("main.content");
  main.querySelector("h1").textContent = kind === "clients" ? "Clients" : "Project";
  const section = el("section", { id: "browse" });
  main.append(section);
  const url =
    kind === "clients"
      ? "/api/v1/clients"
      : `/api/v1/projects/${encodeURIComponent(id)}`;
  const res = await api(url);
  if (!res) return;
  if (res.status === 404) {
    section.replaceChildren(el("p", { className: "error", text: "Not found." }));
    return;
  }
  section.replaceChildren(el("pre", { text: JSON.stringify((await res.json()).data, null, 2) }));
}

async function signOut() {
  await api("/api/v1/auth/signout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  window.location.href = "/login";
}

function renderLogin(h, stateParam) {
  document.body.replaceChildren();
  const card = el("div", { className: "auth-card" });
  card.append(el("h1", { text: "Sign in to ReqALM" }));
  card.append(el("p", { className: "muted", text: "Internal OAuth authorization server (local dev account)" }));
  const form = el("form", { id: "login-form" });
  form.append(
    el("label", {}, [document.createTextNode("Username "), el("input", { name: "username", required: "true", autocomplete: "username" })]),
  );
  form.append(
    el("label", {}, [
      document.createTextNode("Password "),
      el("input", { name: "password", type: "password", required: "true", autocomplete: "current-password" }),
    ]),
  );
  const mfaWrap = el("label", { id: "mfa-wrap", hidden: "true" }, [
    document.createTextNode("MFA code "),
    el("input", { name: "mfa_code", inputmode: "numeric" }),
  ]);
  form.append(mfaWrap);
  const enrollBox = el("div", { id: "enroll-box", hidden: "true" });
  form.append(enrollBox);
  form.append(el("button", { type: "submit", text: "Continue" }));
  const err = el("p", { id: "error", className: "error", hidden: "true" });
  card.append(form, err);
  document.body.append(card);

  let enrollmentTicket = null;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      username: fd.get("username"),
      password: fd.get("password"),
      h,
      mfa_code: fd.get("mfa_code") || undefined,
      enrollment_ticket: enrollmentTicket || undefined,
    };
    const res = await fetch("/api/v1/auth/local/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.status === "mfa_enrollment_required") {
      enrollmentTicket = data.enrollment_ticket;
      enrollBox.hidden = false;
      enrollBox.replaceChildren(
        el("p", {
          className: "muted",
          text: "Add this account to your authenticator app (enter the setup key, or use the otpauth URI), then enter the 6-digit code:",
        }),
        el("p", {}, [
          document.createTextNode("Setup key: "),
          el("code", { text: new URL(data.otpauth_uri).searchParams.get("secret") || "" }),
        ]),
        el("code", { text: data.otpauth_uri }),
      );
      mfaWrap.hidden = false;
      return;
    }
    if (data.status === "mfa_required") {
      mfaWrap.hidden = false;
      return;
    }
    if (!res.ok) {
      err.hidden = false;
      err.textContent = data.error || "Sign-in failed";
      return;
    }
    if (data.redirect) {
      window.location.href = data.redirect;
    }
  });
}

if (path === "/login" || path.startsWith("/login")) {
  const h = params.get("h");
  if (!h) {
    window.location.href = "/oauth/web/start";
  } else {
    renderLogin(h, params.get("state"));
  }
} else if (path.startsWith("/app")) {
  sessionOk().then((ok) => {
    if (!ok) window.location.href = "/login";
    else if (path === "/app/clients") renderBrowsePage("clients");
    else if (path.startsWith("/app/projects/")) {
      renderBrowsePage("project", decodeURIComponent(path.slice("/app/projects/".length).split("/")[0] || ""));
    } else renderShell();
  });
} else if (path === "/") {
  sessionOk().then((ok) => {
    window.location.href = ok ? "/app" : "/login";
  });
}
