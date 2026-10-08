import {
  mountBrowseView,
  navItemsForRoute,
  parseAppRoute,
} from "./browse.js";
import { api } from "./api-client.js";

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

export function rootRedirectPath(sessionOk) {
  return sessionOk ? "/app/clients" : "/login";
}

async function sessionOk() {
  const res = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
  if (!res.ok) return false;
  const body = await res.json();
  return body.authenticated === true;
}

function navLink(item) {
  const a = el("a", { href: item.href, text: item.label });
  if (item.active) a.classList.add("nav-active");
  return a;
}

export function renderAppShell(currentPath, route) {
  document.body.replaceChildren();
  const content = el("main", { className: "content", id: "app-content" });
  const nav = navItemsForRoute(route, currentPath);
  const shell = el("div", { className: "shell" }, [
    el("header", { className: "topbar" }, [
      el("div", { className: "brand", text: "ReqALM" }),
      el("nav", { id: "top-nav" }, nav.map(navLink)),
      el("button", { id: "signout", type: "button", text: "Sign out" }),
    ]),
    el("aside", { className: "sidebar" }, [
      el("p", { className: "muted", text: "Grant-scoped browse" }),
      el("p", { className: "muted", text: "Lists reflect your project roles." }),
    ]),
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

function renderLogin(h) {
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

async function bootApp() {
  const currentPath = window.location.pathname;
  if (currentPath === "/app" || currentPath === "/app/") {
    window.location.replace("/app/clients");
    return;
  }
  const route = parseAppRoute(currentPath);
  const content = renderAppShell(currentPath, route);
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
