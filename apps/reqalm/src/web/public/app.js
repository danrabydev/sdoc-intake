import {
  mountBrowseView,
  parseAppRoute,
  el,
  loadJson,
} from "./browse.js";
import { api } from "./api-client.js";
import { buildMfaEnrollmentChildren, clearMfaEnrollmentUi } from "./mfa-enroll-ui.js";
import { buildShellHeader } from "./shell-nav.js";

export function rootRedirectPath(sessionOk) {
  return sessionOk ? "/app/clients" : "/login";
}

async function sessionOk() {
  const res = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
  if (!res.ok) return false;
  const body = await res.json();
  return body.authenticated === true;
}

export async function loadShellMeta(route, apiFn = api) {
  const meta = { identityId: "", agentName: null, client: undefined, project: undefined };
  const meRes = await loadJson(apiFn, "/api/v1/me");
  if (meRes.kind === "ok") {
    meta.identityId = meRes.data.identity_id ?? "";
    meta.agentName = meRes.data.agent_name ?? null;
  }
  if (route.projectId) {
    const projRes = await loadJson(apiFn, `/api/v1/projects/${encodeURIComponent(route.projectId)}`);
    if (projRes.kind === "ok") {
      meta.project = {
        id: projRes.data.id,
        name: projRes.data.name,
        client_id: projRes.data.client_id,
      };
      const clientRes = await loadJson(apiFn, `/api/v1/clients/${encodeURIComponent(projRes.data.client_id)}`);
      if (clientRes.kind === "ok") {
        meta.client = { id: clientRes.data.id, name: clientRes.data.name };
      } else {
        meta.client = { id: projRes.data.client_id, name: projRes.data.client_id };
      }
    }
  } else if (route.clientId) {
    const clientRes = await loadJson(apiFn, `/api/v1/clients/${encodeURIComponent(route.clientId)}`);
    if (clientRes.kind === "ok") {
      meta.client = { id: clientRes.data.id, name: clientRes.data.name };
    }
  }
  return meta;
}

export function renderAppShell(currentPath, route, meta) {
  document.body.replaceChildren();
  const content = el("main", { className: "content", id: "app-content" });
  const shell = el("div", { className: "shell" }, [
    buildShellHeader(el, route, currentPath, meta),
    content,
  ]);
  document.body.append(shell);
  document.getElementById("signout").addEventListener("click", signOut);
  return content;
}

export async function signOut(apiFn = api, redirect = (url) => {
  window.location.href = url;
}) {
  await apiFn("/api/v1/auth/signout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  redirect("/login");
}

export function renderLogin(h, options = {}) {
  const fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  const redirect = options.redirect ?? ((url) => {
    window.location.href = url;
  });
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
    const res = await fetchFn("/api/v1/auth/local/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.status === "mfa_enrollment_required") {
      enrollmentTicket = data.enrollment_ticket;
      enrollBox.hidden = false;
      enrollBox.replaceChildren(...buildMfaEnrollmentChildren(document, el, data));
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
    clearMfaEnrollmentUi(enrollBox);
    enrollmentTicket = null;
    if (data.redirect) {
      redirect(data.redirect);
    }
  });
}

async function bootApp() {
  const currentPath = window.location.pathname;
  if (currentPath === "/app" || currentPath === "/app/") {
    window.location.replace("/app/clients");
    return;
  }
  const route = parseAppRoute(currentPath);
  const meta = await loadShellMeta(route);
  const content = renderAppShell(currentPath, route, meta);
  await mountBrowseView(content, route, {
    apiFn: api,
    search: window.location.search,
  });
}

if (typeof window !== "undefined") {
  const params = new URLSearchParams(window.location.search);
  const path = window.location.pathname;
  if (path === "/login" || path.startsWith("/login")) {
    const h = params.get("h");
    if (!h) window.location.href = "/oauth/web/start";
    else renderLogin(h);
  } else if (path.startsWith("/app")) {
    sessionOk().then((ok) => {
      if (!ok) window.location.href = "/login";
      else bootApp();
    });
  } else if (path === "/") {
    sessionOk().then((ok) => {
      window.location.href = rootRedirectPath(ok);
    });
  }
}
