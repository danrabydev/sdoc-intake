# ReqALM / sdoc-intake — handoff for Dan (Cursor)

Last updated for seed grooming on **main @ `cb8a8c9`** (2026-10-09). Application code on main through **PR #31**; this doc tracks how to run the stack and how we slice PRs.

## What is on main (merged PRs #12–#31, one line each)

| PR | Summary |
|----|---------|
| **#12** | Devenv foundation: pnpm monorepo, 2-container Compose, Dockerfile roles, `/health` + `/ready`, migrate/seed, `pnpm devenv:smoke` (manual CI). |
| **#13** | R1 foundation shell + internal OAuth AS, local creds/MFA, UI frame/guards, OpenBao Transit keys, auth audit beds. |
| **#14** | In-process test harness: PGlite migrations, memory KeyProvider, auth integration tests, pnpm gate. |
| **#15** | Test/build hygiene: prod build excludes tests, auth test cleanup, Compose project isolation in smoke. |
| **#16** | Product rename to ReqALM (`@reqalm/app`, paths, seed strings). |
| **#17** | API service foundation: ServiceResult, RequestContext, runOperation, business audit, route registry, sample project read. |
| **#18** | OpenTelemetry tracing (W3C, operation spans, KeyProvider dep spans, test harness). |
| **#19** | `defineOperationRoute` — single business-route pipeline + Problem Details. |
| **#20** | Route-helper hardening (Cyber/QA): project id slug, static dep patch, span-safe errors, implicit-public exact match. |
| **#21** | `pnpm devenv:seed:reset` — dev-only transactional dogfood reset (keeps auth/OpenBao). |
| **#22** | Grant-scoped read APIs for clients and projects. |
| **#23** | Read-only browse UI for clients and projects (`/app`). |
| **#24** | Requirements read API + listScope hardening. |
| **#25** | Releases read API (list/detail, delivers). |
| **#26** | Requirements browse UI (list, detail, version history). |
| **#27** | Releases browse UI. |
| **#28** | Requirement hierarchy read API (lazy tree, sibling order in loader). |
| **#29** | Requirements tree browse UI + ancestor breadcrumbs. |
| **#30** | MFA enrollment QR on sign-in card (client-side otpauth QR). |
| **#31** | Requirement **relations read API** + `trace_edges` / catalog label seed load (redaction, dedupe, security tests). |

## Dev environment

- **Compose project:** `sdoc-intake-dev` — app on **`127.0.0.1:3000`** (use hostports overlay when needed).
- **Bootstrap:** `pnpm devenv:init` → secrets in **`.reqalm/devenv.env`** (gitignored, mode 600) and `.env`; then `docker compose up --build -d --wait` or hybrid `pnpm dev:reqalm`.
- **Sign-in:** `<identity-id>@dev.local` — e.g. **`dan@dev.local`** with password from **`REQALM_DEV_ACCOUNT_PASSWORD`** in `.reqalm/devenv.env` (never commit).
- **Checks:** `pnpm devenv:smoke` (Docker integration); `pnpm test` (PGlite in-process, real migrations); `pnpm typecheck`; seed validate: `python3 docs/design/seed/scripts/yaml_to_strictdoc.py --validate`.

## Standing rules (carry into every PR)

1. **Small, single-concern PRs** — ≤800 hand-written lines (exclude vendor, OpenAPI dumps, patch scripts, regenerated `out/`).
2. **One PR = one seed release** with honest capability/release statuses (no pass/shipped unless merged and verified).
3. **Parallel PR pair:** the second PR ships the first’s release at the **full merge SHA** of the first (no partial pins).
4. **Every commit includes `[skip ci]`** — no GitHub Actions spend on push (smoke remains manual / local).
5. **QA + Cyber review gates** on security-sensitive routes (relations, auth, write paths).
6. **Lean by default** — plain TypeScript, Web Workers for heavy UI layout; WASM only if measurements demand it.
7. **Never drop the production approach for test convenience** (prod self-check, no dev OpenBao in prod, etc.).
8. **Tests use PGlite in-process** with **real SQL migrations**, not mocked schema.

## In-flight / parallel (not owned by seed-grooming PR)

| Track | Release / capability | Notes |
|-------|----------------------|--------|
| Relations seed ship | `rel-r1-relations-api` / `CAP-RELATIONS-API` | Code on main (#31); seed release still **planned** until dedicated seed PR marks shipped. |
| Relations UI | `rel-r1-browse-ui-relations` | Do not edit in grooming; parallel UI PR. |
| Catalogs API | `rel-r1-catalogs-api` / `CAP-CATALOGS-API` | API PR #33 in flight; roadmap text only in this grooming PR (no release stub). |

## Next-up (ordered)

1. Ship **`rel-r1-relations-api`** seed at #31 merge SHA (parallel seed PR).
2. **`rel-r1-catalogs-api`** (PR #33) then **`rel-r1-browse-ui-catalogs`** (catalogs / imprints / controls read).
3. **`rel-r1-browse-ui-relations`** (uses relations API; parallel).
4. **Planning read** (`rel-r1-read-planning` → browse UI).
5. **Artifacts, workflow, people/access, audit** read APIs + UIs (see `ARCH-BROWSE-ROADMAP` in seed).
6. **Two-column trace views** (`rel-r1-browse-ui-trace-views`) after relations UI + worker layout.
7. **Security follow-ups before first edge write route** (`ARCH-SEC-*` in seed): dedupe index, loader integrity, cross-project read gate, stub design, paging, FK, edge sync, imprint-scoped labels.
8. **Security headers** (`ARCH-SEC-HEADERS`) before any non-127.0.0.1 bind.
9. **Write foundation** (`ARCH-WRITE-FOUNDATION`) — UoW, repository layer, TRUNCATE guard + runtime role, audit flood controls, UNIQUE version constraint, reserved id segments.
10. **Key cache + span flush** (`ARCH-KEY-RUNTIME-CACHE`); **test teardown** (`ARCH-TEST-HARNESS-TEARDOWN`).

## Seed grooming artifact (this PR)

- **Release:** `rel-r1-seed-grooming` → **`CAP-SEED-GROOMING`** (documentation-only).
- **Patch (idempotent):** `docs/design/seed/scripts/patch_seed_grooming_release.py`
- **Source of truth:** `docs/design/seed/dogfood.yaml` + regenerated `docs/design/seed/out/`
- **Honesty (content `.1` mints, v0 byte-identical to main):** **`CAP-RBAC.1`**, **`CAP-UI-FRAME.1`**, **`CAP-SSO.1`**, **`CAP-SCOPED-VIEW.1`**, **`ARCH-API-RBAC.1`**, **`ARCH-SUSPECT.1`**. Only **`CAP-SCOPED-VIEW.1`** sets **`verification_outcome: pending`**; **`CAP-SSO.1`** has no pass outcome (same as v0 on main). **`CAP-RBAC.1`** / **`CAP-UI-FRAME.1`** keep partial pass with PR #13 verification citation. **No** new `conforms_to` pins on `.1` devenv caps.
- **V-222518:** `conforms_to` pins on **v0** `ARCH-DEVENV-IDENTITY` and `FIX-DENY-DEVENV-PROD-LOGIN` are **restored** (not removed). Whether `.1` devenv versions should also pin V-222518 is a **Dan decision** — this PR does not add them.

When continuing in Cursor: read `dogfood.yaml` releases and `ARCH-BROWSE-ROADMAP` first; pick the next **planned** release; implement; update seed via a dedicated `patch_*_release.py`; validate and test.
