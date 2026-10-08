/**
 * GET/HEAD paths that serve the vanilla web UI shell (index.html).
 * Must stay aligned with apps/reqalm/src/web/public/app.js client routing.
 *
 * OAuth browser flow: /oauth/web/start → /oauth/authorize → /login?h=… (shell).
 * MFA enrollment runs on the login shell; sign-out returns to /login.
 */
export function pathGetsWebSpaShell(pathOnly: string): boolean {
  if (pathOnly === "/") return true;
  if (/^\/login(\/|$)/.test(pathOnly)) return true;
  if (/^\/app(\/|$)/.test(pathOnly)) return true;
  return false;
}

/** Representative entry URLs — each must return HTML via SPA fallback (GET). */
export const WEB_UI_SPA_ENTRY_GET_PATHS = [
  "/",
  "/login?h=test-handoff",
  "/app",
  "/app/clients",
  "/app/projects",
] as const;
