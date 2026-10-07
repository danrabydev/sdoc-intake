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

export const API_ROUTE_PREFIXES = ["/api/", "/oauth/", "/mcp", "/health", "/ready"] as const;

export function isApiRoutePath(path: string): boolean {
  return API_ROUTE_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p));
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

/** Enumerate routes using Fastify's `printRoutes` companion: route hooks registry. */
export function listRoutesForSecurityAudit(app: FastifyInstance): RegisteredRouteSecurity[] {
  type RouteEntry = { method: string; url: string; config?: { reqalmSecurity?: RouteSecurity } };
  const router = (app as unknown as { radix?: { all?: () => RouteEntry[] } }).radix;
  if (router?.all) {
    return router.all().map((r) => ({
      method: r.method,
      url: r.url,
      security: r.config?.reqalmSecurity,
    }));
  }
  // Fastify 5: use onRoute-captured list
  const captured = (app as unknown as { __reqalmRoutes?: RegisteredRouteSecurity[] }).__reqalmRoutes;
  return captured ?? [];
}

const PUBLIC_ROUTE_PREFIXES = ["/oauth/", "/api/v1/auth/", "/docs"] as const;

function isImplicitPublicPath(url: string): boolean {
  if (url === "/health" || url === "/ready") return true;
  return PUBLIC_ROUTE_PREFIXES.some((p) => url.startsWith(p));
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
    if (!isApiRoutePath(r.url)) continue;
    if (!r.security) {
      missing.push(`${r.method} ${r.url}`);
    }
  }
  return missing;
}
