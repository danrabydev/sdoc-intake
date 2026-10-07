import type { FastifyInstance } from "fastify";

/** Route security declaration (fail-closed registration test requires one per API route). */
export type RouteSecurity =
  | { kind: "public" }
  | { kind: "authenticated" }
  | { kind: "permission"; permission: string };

export type ReqalmRouteConfig = {
  reqalmSecurity?: RouteSecurity;
};

declare module "fastify" {
  interface FastifyContextConfig {
    reqalmSecurity?: RouteSecurity;
  }
}



export type RegisteredRouteSecurity = {
  method: string;
  url: string;
  security: RouteSecurity | undefined;
};

export function collectRouteSecurity(app: FastifyInstance): RegisteredRouteSecurity[] {
  const out: RegisteredRouteSecurity[] = [];
  const routes = app.printRoutes({ commonPrefix: false });
  // printRoutes returns a tree string in Fastify 5 — use route list from internal if needed
  void routes;
  // Walk the radix tree via app's internal route store
  const stack = (app as unknown as { [k: string]: unknown }).routes as
    | Array<{ method: string; url: string; config?: ReqalmRouteConfig }>
    | undefined;
  if (Array.isArray(stack)) {
    for (const r of stack) {
      out.push({
        method: r.method,
        url: r.url,
        security: r.config?.reqalmSecurity,
      });
    }
    return out;
  }
  // Fallback: iterate getRoutes if available (Fastify 5)
  const getRoutes = (app as { getRoutes?: () => Map<string, unknown> }).getRoutes;
  if (typeof getRoutes === "function") {
    for (const [key, route] of getRoutes.call(app)) {
      const r = route as { method: string; url: string; config?: ReqalmRouteConfig };
      const method = r.method ?? String(key).split(" ")[0];
      const url = r.url ?? String(key).split(" ").slice(1).join(" ");
      out.push({ method, url, security: r.config?.reqalmSecurity });
    }
  }
  return out;
}

/** Every route registered after {@link installRouteCapture}, as captured by its onRoute hook. */
export function listRoutesForSecurityAudit(app: FastifyInstance): RegisteredRouteSecurity[] {
  // A missing capture must fail the audit, never yield an empty (passing) list.
  const captured = (app as unknown as { __reqalmRoutes?: RegisteredRouteSecurity[] }).__reqalmRoutes;
  if (!captured) throw new Error("installRouteCapture(app) was not called before routes were registered");
  return captured;
}

/**
 * Exact routes that are public by protocol (probes, OAuth endpoints that authenticate in-band,
 * sign-in) plus Swagger UI and the static web bundle. Anything else, including new routes under
 * /oauth/ or /api/v1/auth/, must declare `config.reqalmSecurity` explicitly.
 */
const IMPLICIT_PUBLIC_ROUTES = new Set([
  "/health",
  "/ready",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource/api",
  "/.well-known/oauth-protected-resource/mcp",
  "/oauth/jwks",
  "/oauth/web/start",
  "/oauth/web/callback",
  "/oauth/authorize",
  "/oauth/token",
  "/oauth/revoke",
  "/oauth/register",
  "/api/v1/auth/local/login",
  "/api/v1/auth/session",
  "/api/v1/auth/signout",
  "/*",
]);

function isImplicitPublicPath(url: string): boolean {
  return IMPLICIT_PUBLIC_ROUTES.has(url) || url === "/docs" || url.startsWith("/docs/");
}

/** Single onRoute hook: implicit public markers for auth/oauth probes, then capture for audit test. */
export function installRouteCapture(app: FastifyInstance): void {
  const list: RegisteredRouteSecurity[] = [];
  (app as unknown as { __reqalmRoutes: RegisteredRouteSecurity[] }).__reqalmRoutes = list;
  app.addHook("onRoute", (routeOptions) => {
    routeOptions.config = routeOptions.config ?? {};
    if (!routeOptions.config.reqalmSecurity && isImplicitPublicPath(routeOptions.url)) {
      routeOptions.config.reqalmSecurity = { kind: "public" };
    }
    const methods = routeOptions.method;
    const methodList = Array.isArray(methods)
      ? methods
      : typeof methods === "string"
        ? methods.split(",")
        : ["GET"];
    for (const method of methodList) {
      list.push({
        method: method.trim().toUpperCase(),
        url: routeOptions.url,
        security: routeOptions.config.reqalmSecurity,
      });
    }
  });
}

export function assertAllApiRoutesDeclared(routes: RegisteredRouteSecurity[]): string[] {
  const missing: string[] = [];
  for (const r of routes) {
    if (!r.security) {
      missing.push(`${r.method} ${r.url}`);
    }
  }
  return missing;
}
