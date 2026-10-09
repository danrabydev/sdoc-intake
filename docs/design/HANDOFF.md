# ReqALM / sdoc-intake — handoff for Dan (Cursor)

Last updated for **Cyber control-placement + browse relations ship** on **main @ `c827234`** (2026-10-09). Application code on main through **PR #35**; this doc tracks how to run the stack and how we slice PRs.

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
| **#32** | Relationships browse UI on requirement detail (`CAP-BROWSE-UI-RELATIONS`). |
| **#33** | Catalogs / imprints / controls read API (`CAP-CATALOGS-API`). |
| **#35** | LF endings / line-ending hygiene (seed `rel-r1-lf-endings`). |

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

## In-flight / parallel (not owned by this seed PR)

| Track | Release / capability | Notes |
|-------|----------------------|--------|
| Catalogs browse UI | `rel-r1-browse-ui-catalogs` | Catalogs API shipped on main (#33); UI tranche next. |

## Next-up (ordered)

1. **`rel-r1-browse-ui-catalogs`** (catalogs / imprints / controls browse UI).
2. **Planning read** (`rel-r1-read-planning` → browse UI).
3. **Artifacts, workflow, people/access, audit** read APIs + UIs (see `ARCH-BROWSE-ROADMAP` in seed).
4. **Two-column trace views** (`rel-r1-browse-ui-trace-views`) after relations UI + worker layout.
5. **Security follow-ups before first edge write route** (`ARCH-SEC-*` in seed): dedupe index, loader integrity, cross-project read gate, stub design, paging, FK, edge sync, imprint-scoped labels.
6. **Security headers** (`ARCH-SEC-HEADERS`) before any non-127.0.0.1 bind.
7. **Write foundation** (`ARCH-WRITE-FOUNDATION`) — UoW, repository layer, TRUNCATE guard + runtime role, audit flood controls, UNIQUE version constraint, reserved id segments.
8. **Key cache + span flush** (`ARCH-KEY-RUNTIME-CACHE`); **test teardown** (`ARCH-TEST-HARNESS-TEARDOWN`).

On main @ **`c827234`**, **`rel-r1-relations-api`** / **`CAP-RELATIONS-API`** and **`rel-r1-browse-ui-relations`** / **`CAP-BROWSE-UI-RELATIONS`** are already **shipped** in seed (relations API via prior seed PR; browse UI shipped in PR #36).

## Seed artifacts (Cyber control-placement PR #36)

### Shipped in this PR (parallel rule)

- **`rel-r1-browse-ui-relations`** → **`CAP-BROWSE-UI-RELATIONS`** shipped **2026-10-09** at merge **`c8272340b67a0e505b63483bd2ef1550accb4635`** (PR #32).
- **Patch:** `docs/design/seed/scripts/patch_browse_ui_relations_release.py` (also idempotently ships **`rel-r1-catalogs-api`** if not already shipped).

### Planned in this PR

- **`rel-r1-cyber-control-placement`** → **`CAP-CYBER-CONTROL-PLACEMENT`** (documentation-only until Security accepts pins).
- **Patch (idempotent):** `docs/design/seed/scripts/patch_cyber_control_placement.py` + `cyber_control_placement_mapping.yaml` (mapping authored @ `2de51e2`, applied on **`c827234`** seed).
- **Regenerate:** `python3 docs/design/seed/scripts/yaml_to_strictdoc.py --validate` (second run zero diff under `out/`).
- **Scope:** conforms_to add/move/remove for ARCH/CAP; pin-kind successors where shipped releases freeze prior version UIDs; no SA-11 adds; shipped **`delivers`** lists and delivered version **statements** unchanged vs pre-patch **`c827234`**.

When continuing in Cursor: read `dogfood.yaml` releases and `ARCH-BROWSE-ROADMAP` first; pick the next **planned** release; implement; update seed via a dedicated `patch_*_release.py`; validate and test.
