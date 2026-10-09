# ReqALM / sdoc-intake — handoff for Dan (Cursor)

Last updated for seed **ReqALM contracts** on **main @ `dd43cc1`** (2026-10-09). Application code on main through **PR #37** (header/nav UI); this doc tracks how to run the stack and how we slice PRs.

## What is on main (merged PRs #12–#37, one line each)

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
| **#32** | Browse UI **relationships** panel on requirement detail. |
| **#33** | **Catalogs read API** (catalogs, imprints, controls). |
| **#35** | Git **LF line endings** for Compose entrypoints (`.gitattributes`). |
| **#37** | **Header and project navigation** (breadcrumb, tabs, list/tree toggle). |

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

## In-flight / parallel (not owned by contracts seed PR)

| Track | Release / capability | Notes |
|-------|----------------------|--------|
| Seed grooming | `rel-r1-seed-grooming` / `CAP-SEED-GROOMING` | Parallel documentation-only grooming PR. |
| Browse UI catalogs | `rel-r1-browse-ui-catalogs` | After catalogs API; not in this PR. |
| LF endings | `rel-r1-lf-endings` | May already be shipped on main via #35 — check seed before duplicate ship PR. |

## Next-up (ordered)

1. **`rel-r1-reqalm-contracts`** (this seed PR) — product + maintenance contract overlays.
2. **`rel-r1-browse-ui-catalogs`** (uses catalogs API).
3. **Planning read** (`rel-r1-read-planning` → browse UI).
4. **Artifacts, workflow, people/access, audit** read APIs + UIs (see `ARCH-BROWSE-ROADMAP` in seed).
5. **Two-column trace views** (`rel-r1-browse-ui-trace-views`) after relations UI + worker layout.
6. **Security follow-ups before first edge write route** (`ARCH-SEC-*` in seed).
7. **Write foundation** (`ARCH-WRITE-FOUNDATION`).

## Seed artifact (ReqALM contracts PR)

- **Ship (parallel):** `rel-r1-ui-header-nav` → **`CAP-UI-HEADER-NAV`** at merge **`dd43cc1523544d0f6375a628bc9d7d45a31fa738`** (2026-10-09), `active` / `pass`.
- **Release (this PR):** `rel-r1-reqalm-contracts` → **`CAP-REQALM-CONTRACTS`** (seed-only, planned).
- **Contracts (extended model):**
  - **`ctr-reqalm-product`** — build contract; `covers_releases` = all reqalm release ids; `in_scope_of` = union of all `release.delivers` version UIDs.
  - **`ctr-reqalm-maintenance`** — maintenance contract; `covers_releases` empty; `in_scope_of` = planned **`MAINT-*`** recurring obligations (draft, not shipped) with NIST/STIG `conforms_to` where catalog has items.
- **Patch (idempotent):** `docs/design/seed/scripts/patch_reqalm_contracts_release.py`
- **Grammar:** `covers_releases` on `contract` (see `schema.md` / `reqseed.schema.json`); exported as Parent + `CoversRelease` on `contracts-releases.sdoc`.
- **Source of truth:** `docs/design/seed/dogfood.yaml` + regenerated `docs/design/seed/out/`

When continuing in Cursor: read `dogfood.yaml` releases and `ARCH-BROWSE-ROADMAP` first; pick the next **planned** release; implement; update seed via a dedicated `patch_*_release.py`; validate and test.
