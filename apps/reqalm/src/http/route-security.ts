import type { FastifyInstance } from "fastify";

/** Route security declaration (fail-closed registration test requires one per API route). */
export type RouteSecurity =
  | { kind: "public" }
  | { kind: "authenticated" }
  | { kind: "permission"; permission: string };

/** Metadata captured from {@link defineOperationRoute} for audit tests. */
export type OperationRouteRef = {
  name: string;
  permission?: string;
  projectScoped?: boolean;
};

export type ReqalmRouteConfig = {
  reqalmSecurity?: RouteSecurity;
  reqalmOperationRoute?: true;
  reqalmOperationRef?: OperationRouteRef;
};

declare module "fastify" {
  interface FastifyContextConfig {
    reqalmSecurity?: RouteSecurity;
    reqalmOperationRoute?: true;
    reqalmOperationRef?: OperationRouteRef;
  }
}

export type RegisteredRouteSecurity = {
  method: string;
  url: string;
  security: RouteSecurity | undefined;
  operationRoute?: boolean;
  operationRef?: OperationRouteRef;
};

/** Derive the route marker from an operation definition (must match {@link defineOperationRoute}). */
export function securityFromOperationRef(ref: OperationRouteRef): RouteSecurity {
  if (ref.permission) {
    return { kind: "permission", permission: ref.permission };
  }
  return { kind: "authenticated" };
}

function securityEqual(a: RouteSecurity | undefined, b: RouteSecurity | undefined): boolean {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "permission" && b.kind === "permission") {
    return a.permission === b.permission;
  }
  return true;
}

/**
 * Exact `METHOD url` pairs under `/api/` that are not business operations (OAuth-shaped auth endpoints
 * and the dev seed summary). They stay hand-registered; every other `/api/` route must use
 * {@link defineOperationRoute}. HEAD is checked as GET (Fastify derives HEAD routes from GET routes).
 */
export const API_NON_OPERATION_ROUTES = new Set([
  "POST /api/v1/auth/local/login",
  "GET /api/v1/auth/session",
  "POST /api/v1/auth/signout",
  "GET /api/v1/auth/upstream/connectors",
  "GET /api/v1/seed/summary",
]);

function requiresOperationRoute(r: RegisteredRouteSecurity): boolean {
  if (r.security?.kind === "permission") return true;
  if (!r.url.startsWith("/api/")) return false;
  const method = r.method === "HEAD" ? "GET" : r.method;
  return !API_NON_OPERATION_ROUTES.has(`${method} ${r.url}`);
}

/** Every route registered after {@link installRouteCapture}, as captured by its onRoute hook. */
export function listRoutesForSecurityAudit(app: FastifyInstance): RegisteredRouteSecurity[] {
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
        operationRoute: routeOptions.config.reqalmOperationRoute === true,
        operationRef: routeOptions.config.reqalmOperationRef,
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

/**
 * Fail-closed: every `/api/` route outside the exact allowlist, and every route anywhere that carries a
 * `permission` marker, must come from defineOperationRoute with a marker matching its operation.
 */
export function assertBusinessApiRoutesCompliant(routes: RegisteredRouteSecurity[]): string[] {
  const violations: string[] = [];
  for (const r of routes) {
    if (!requiresOperationRoute(r)) continue;

    const label = `${r.method} ${r.url}`;
    if (!r.operationRoute || !r.operationRef) {
      violations.push(`${label}: must register via defineOperationRoute`);
      continue;
    }
    const expected = securityFromOperationRef(r.operationRef);
    if (!securityEqual(r.security, expected)) {
      violations.push(
        `${label}: reqalmSecurity disagrees with operation (expected ${expected.kind}${
          expected.kind === "permission" ? `:${expected.permission}` : ""
        })`,
      );
    }
  }
  return violations;
}
