# ReqALM API feature modules

Each feature lives under `src/modules/<feature>/` with:

- `*.service.ts` — business logic returning `ServiceResult<T>` (never raw HTTP).
- `routes.ts` — thin Fastify handlers: build `RequestContext`, `runOperation`, `mapServiceResultToHttp`.
- `*.test.ts` — in-process tests via `createTestApp()` (optional colocated).

## Adding an operation

1. Declare permission on the route: `config.reqalmSecurity = { kind: "permission", permission: "…" }` (or `public` / `authenticated`).
2. Define an `OperationDef` with `name`, `permission`, optional `projectScoped`, and `execute`.
3. Call `runOperation(ctx, def, input)` from the route — authorization, audit (`audit_events`), structured logs, and typed errors are automatic.
4. Add schema under `schema` on the route so OpenAPI stays current.
5. Register the module in `register.ts`.

## Policies

- **Project scope:** `projectScoped: true` returns `not_found` when the caller has no grant (no existence leak).
- **Auth events** stay in `auth_audit_events`; business ops use append-only `audit_events`.
