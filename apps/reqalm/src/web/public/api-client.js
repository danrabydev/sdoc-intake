function csrfToken() {
  const match = document.cookie.match(/(?:^|; )reqalm_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Optional override (e.g. tests); default assigns window.location.href. */
let unauthorizedRedirect = null;

export function setUnauthorizedRedirect(fn) {
  unauthorizedRedirect = fn;
}

export function clearUnauthorizedRedirect() {
  unauthorizedRedirect = null;
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const csrf = csrfToken();
  if (csrf && (options.method === "POST" || options.method === "DELETE")) {
    headers["X-CSRF-Token"] = csrf;
  }
  const res = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (res.status === 401) {
    if (typeof unauthorizedRedirect === "function") unauthorizedRedirect("/login");
    else window.location.href = "/login";
    return null;
  }
  return res;
}
