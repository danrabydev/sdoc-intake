# ReqALM API feature modules

Each feature lives under `src/modules/<feature>/` with:

- `*.service.ts` — business logic returning `ServiceResult<T>` (never raw HTTP).
- `routes.ts` — register handlers only via `defineOperationRoute` (see below).
- `*.test.ts` — in-process tests via `createTestApp()` (optional colocated).

## Adding a module, operation, and route

1. **Service** — implement `execute(ctx, input)` returning `ServiceResult<T>` in `*.service.ts`.
2. **Operation** — declare an `OperationDef` with `name`, optional `permission`, optional `projectScoped` / `projectIdFromInput`, and `auditMeta` when audited.
3. **Route** — in `routes.ts`, call `defineOperationRoute(app, deps, { method, url, op, parseInput, schema? })`:
   - Parses `params` / `query` / `body` in `parseInput` (use `parseZodInput` + Zod); invalid input becomes a `validation` `ServiceResult` → HTTP 400 Problem Details (`application/problem+json`).
   - Builds `RequestContext`, runs `runOperation`, maps success to the `{ data, request_id }` envelope or errors to Problem Details.
   - Sets `reqalmSecurity` from the operation (authenticated vs permission) so the route marker cannot drift from enforcement.
4. **OpenAPI** — document the route in `openapi/openapi.yaml`. `/docs` serves that static file; Fastify `schema` validates and serializes only.
5. **Register** — add `registerXRoutes` to `register.ts`.

Auth- and OAuth-shaped endpoints under `/api/v1/auth/*` stay hand-registered in `src/auth/routes.ts`. Dev-only `/api/v1/seed/summary` is registered in `http/server.ts`.

## Policies

- **Project scope:** `projectScoped: true` returns `not_found` when the caller has no grant (no existence leak).
- **Auth events** stay in `auth_audit_events`; business ops use append-only `audit_events`.
- **Fail-closed audit:** `route-security.test.ts` requires every `/api/v1` business route to use `defineOperationRoute` and keeps `reqalmSecurity` aligned with the operation.
