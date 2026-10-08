# ReqALM API feature modules

Each feature lives under `src/modules/<feature>/` with:

- `*.service.ts` — business logic returning `ServiceResult<T>` (never raw HTTP).
- `routes.ts` — register handlers only via `defineOperationRoute` (see below).
- `*.test.ts` — in-process tests via `createTestApp()` (optional colocated).

## Adding a module, operation, and route

1. **Service** — implement `execute(ctx, input)` returning `ServiceResult<T>` in `*.service.ts`.
2. **Operation** — declare an `OperationDef` with `name`, `execute`, and either `permission` (with `projectScoped: true` and `projectIdFromInput`) or `authenticatedOnly: true`; add `auditMeta` when audited. `defineOperationRoute` throws at registration if any of these bindings is missing (a permission without a project would be checked against the caller's grants in every project).
3. **Route** — in `routes.ts`, call `defineOperationRoute(app, deps, { method, url, op, parseInput, schema? })`:
   - Order is fixed: authenticate → project scope → permission → `parseInput` → execute → append-only `audit_events` → log. An unauthenticated caller gets the same 401 whatever the input; a caller outside the project gets the same 404 whatever the input.
   - Project scope comes from the `:projectId` path param (required for `projectScoped` routes, checked at registration) and is parsed with `projectIdSchema` before any validation; an unparsable id is a 404, identical to a missing or ungranted project. The validated input must name the same project (`projectIdFromInput`), else the call fails closed.
   - `parseInput` is the only input validation: parse `params` / `query` / `body` with `parseZodInput` (Zod, no transforms on identifiers). Failures are HTTP 400 Problem Details (`application/problem+json`) and are audited (`outcome=error`, `detail.error_code=validation`, no input values).
   - `schema` is documentation and response serialization only; the helper refuses `params` / `querystring` / `body` / `headers` schemas so there is one validator.
   - Builds `RequestContext`, runs `runOperationCall`, maps success to the `{ data, request_id }` envelope and errors to Problem Details. Fastify errors before the handler (malformed JSON, media type, size) go through the same auth → scope → permission steps first, then answer 400/413/415 Problem Details; unexpected throws are a 500 that never echoes the error message.
   - Sets `reqalmSecurity` from the operation (authenticated vs permission) so the route marker cannot drift from enforcement.
4. **OpenAPI** — document the route in `openapi/openapi.yaml`. `/docs` serves that static file.
5. **Register** — add `registerXRoutes` to `register.ts`.

Auth- and OAuth-shaped endpoints under `/api/v1/auth/*` stay hand-registered in `src/auth/routes.ts`; dev-only `GET /api/v1/seed/summary` is registered in `http/server.ts`. They are listed by exact `METHOD url` in `API_NON_OPERATION_ROUTES`.

## Policies

- **Project scope:** `projectScoped: true` returns `not_found` when the caller has no grant or the id is unparsable (no existence leak).
- **Unknown `/api` paths** answer 404 Problem Details with the request id.
- **Auth events** stay in `auth_audit_events`; business ops use append-only `audit_events`.
- **Fail-closed audit:** `route-security.test.ts` requires every `/api/` route outside the exact allowlist, and every route anywhere with a `permission` marker, to use `defineOperationRoute`, and keeps `reqalmSecurity` aligned with the operation.
