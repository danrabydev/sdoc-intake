function csrfToken() {
  const match = document.cookie.match(/(?:^|; )reqalm_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const csrf = csrfToken();
  if (csrf && (options.method === "POST" || options.method === "DELETE")) {
    headers["X-CSRF-Token"] = csrf;
  }
  const res = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (res.status === 401) {
    const testHook = globalThis.__REQALM_TEST_LOGIN_REDIRECT__;
    if (typeof testHook === "function") testHook("/login");
    else window.location.href = "/login";
    return null;
  }
  return res;
}
