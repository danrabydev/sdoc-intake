# ReqALM API feature modules

Each feature lives under `src/modules/<feature>/` with:

- `*.service.ts` — business logic returning `ServiceResult<T>` (never raw HTTP).
- `routes.ts` — register handlers only via `defineOperationRoute` (see below).
- `*.test.ts` — in-process tests via `createTestApp()` (optional colocated).

## Adding a module, operation, and route

1. **Service** — implement `execute(ctx, input)` returning `ServiceResult<T>` in `*.service.ts`.
2. **Operation** — declare an `OperationDef` with `name`, optional `permission`, optional `projectScoped` / `projectIdFromInput`, and `auditMeta` when audited.
3. **Route** — in `routes.ts`, call `defineOperationRoute(app, deps, { method, url, op, parseInput, schema? })`:
   - `parseInput` is the only input validation: parse `params` / `query` / `body` with `parseZodInput` (Zod, no transforms on identifiers). Failures are HTTP 400 Problem Details (`application/problem+json`).
   - `schema` is documentation and response serialization only; the helper refuses `params` / `querystring` / `body` / `headers` schemas so there is one validator.
   - Builds `RequestContext`, runs `runOperation`, maps success to the `{ data, request_id }` envelope and errors to Problem Details. Fastify errors before the handler (malformed JSON, media type) and unexpected throws are Problem Details too (500 never echoes the error message).
   - Sets `reqalmSecurity` from the operation (authenticated vs permission) so the route marker cannot drift from enforcement.
4. **OpenAPI** — document the route in `openapi/openapi.yaml`. `/docs` serves that static file.
5. **Register** — add `registerXRoutes` to `register.ts`.

Auth- and OAuth-shaped endpoints under `/api/v1/auth/*` stay hand-registered in `src/auth/routes.ts`; dev-only `GET /api/v1/seed/summary` is registered in `http/server.ts`. They are listed by exact `METHOD url` in `API_NON_OPERATION_ROUTES`.

## Policies

- **Project scope:** `projectScoped: true` returns `not_found` when the caller has no grant (no existence leak).
- **Auth events** stay in `auth_audit_events`; business ops use append-only `audit_events`.
- **Fail-closed audit:** `route-security.test.ts` requires every `/api/` route outside the exact allowlist, and every route anywhere with a `permission` marker, to use `defineOperationRoute`, and keeps `reqalmSecurity` aligned with the operation.
