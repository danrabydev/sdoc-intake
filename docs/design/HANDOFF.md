# ReqALM / sdoc-intake — handoff for Dan (Cursor)

Last updated for **inherit-uses control mapping** rebased on **main @ `88df54d`** (2026-10-09). Application code on main through **PR #38** (contracts seed); **PR in flight:** trace inheritable loader + seed (`rel-r1-trace-inherit-uses`, PR #39).

## What is on main (merged PRs #12–#38, one line each)

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
| **#32** | Requirements **relationships browse UI** (detail panel, read-only). |
| **#33** | **Catalogs read API** (catalogs / imprints / controls). |
| **#35** | Git **LF line endings** for Compose entrypoints (.gitattributes). |
| **#37** | Mockup-style **header and project navigation** (UI + seed). |
| **#38** | **Product + maintenance contracts** seed (`ctr-reqalm-product`, `ctr-reqalm-maintenance`, `CAP-UPKEEP-*`, overlap validate). |

## Dev environment

- **Compose project:** `sdoc-intake-dev` — app on **`127.0.0.1:3000`** (use hostports overlay when needed).
- **Bootstrap:** `pnpm devenv:init` → secrets in **`.reqalm/devenv.env`** (gitignored, mode 600) and `.env`; then `docker compose up --build -d --wait` or hybrid `pnpm dev:reqalm`.
- **Sign-in:** `<identity-id>@dev.local` — e.g. **`dan@dev.local`** with password from **`REQALM_DEV_ACCOUNT_PASSWORD`** in `.reqalm/devenv.env` (never commit).
- **Checks:** `pnpm devenv:smoke` (Docker integration); `pnpm test` (PGlite in-process, real migrations); `pnpm typecheck`; seed validate: `python3 docs/design/seed/scripts/yaml_to_strictdoc.py --validate`.

## Standing rules (carry into every PR)

1. **Small, single-concern PRs** — ≤800 hand-written lines (exclude vendor, OpenAPI dumps, patch scripts, regenerated `out/`).
2. **One PR = one seed release** with honest capability/release statuses (no pass/shipped unless merged and verified).
3. **Parallel PR pair:** the second PR ships the first’s release at the **full merge SHA** of the first (no partial pins). PR #39 ships **`rel-r1-reqalm-contracts`** at **`88df54dea5c8d2bfd895e2613b17dbf2c5b3405f`** (PR #38 merge).
4. **Every commit includes `[skip ci]`** — no GitHub Actions spend on push (smoke remains manual / local).
5. **QA + Cyber review gates** on security-sensitive routes (relations, auth, write paths).
6. **Lean by default** — plain TypeScript, Web Workers for heavy UI layout; WASM only if measurements demand it.
7. **Never drop the production approach for test convenience** (prod self-check, no dev OpenBao in prod, etc.).
8. **Tests use PGlite in-process** with **real SQL migrations**, not mocked schema.

## In-flight / parallel

| Track | Release / capability | Notes |
|-------|----------------------|--------|
| **Inherit uses (common-control)** | `rel-r1-trace-inherit-uses` / `CAP-TRACE-INHERIT-USES` | PR #39: loader + seed beds; **read-time inheritance deferred.** |
| Seed grooming | `rel-r1-seed-grooming` / `CAP-SEED-GROOMING` | Documentation-only grooming PR. |
| Browse UI catalogs | `rel-r1-browse-ui-catalogs` | After catalogs API. |

## Next-up (ordered)

1. Merge **inherit-uses loader** PR #39; follow with **read API** for inherited + hybrid control display.
2. **`rel-r1-browse-ui-catalogs`** (uses catalogs API).
3. **Planning read** (`rel-r1-read-planning` → browse UI).
4. **Artifacts, workflow, people/access, audit** read APIs + UIs (see `ARCH-BROWSE-ROADMAP` in seed).
5. **Two-column trace views** (`rel-r1-browse-ui-trace-views`) after relations UI + worker layout.
6. **Security follow-ups before first edge write route** (`ARCH-SEC-*` in seed).
7. **Write foundation** (`ARCH-WRITE-FOUNDATION`).

## Seed artifact (ReqALM contracts — shipped in PR #39 patch)

- **Shipped:** `rel-r1-reqalm-contracts` → **`CAP-REQALM-CONTRACTS`** at merge **`88df54dea5c8d2bfd895e2613b17dbf2c5b3405f`** (2026-10-09), `active` / `pass` (via `patch_trace_inherit_uses_release.py` after PR #38 landed).
- **Also shipped on main:** `rel-r1-ui-header-nav` → **`CAP-UI-HEADER-NAV`** at **`dd43cc1523544d0f6375a628bc9d7d45a31fa738`**.
- **Contracts (extended model):**
  - **`ctr-reqalm-product`** — build contract; `covers_releases` = all reqalm release ids; `in_scope_of` = active tip or newest non-superseded draft per line (excludes upkeep + **`SYS-CYBER-UPKEEP`**).
  - **`ctr-reqalm-maintenance`** — draft **`CAP-UPKEEP-*`** only; overlap guard in `yaml_to_strictdoc --validate`.
- **Patch:** `docs/design/seed/scripts/patch_reqalm_contracts_release.py` (on main); **`patch_trace_inherit_uses_release.py`** refreshes product `in_scope_of` after inherit beds.

## Seed grooming artifact (main track)

- **Release:** `rel-r1-seed-grooming` → **`CAP-SEED-GROOMING`** (documentation-only).
- **Patch (idempotent):** `docs/design/seed/scripts/patch_seed_grooming_release.py`
- **Honesty (content `.1` mints):** **`CAP-RBAC.1`**, **`CAP-UI-FRAME.1`**, **`CAP-SSO.1`**, **`CAP-SCOPED-VIEW.1`**, **`ARCH-API-RBAC.1`**, **`ARCH-SUSPECT.1`**.

## Inherit-uses artifact (PR #39)

- **Release:** `rel-r1-trace-inherit-uses` → **`CAP-TRACE-INHERIT-USES`** (planned).
- **Architecture:** **`ARCH-TRACE-INHERIT-USES`**, **`ARCH-TRACE-INHERIT-HYBRID`** (Cyber 2026-10-09 text, `rbac_op: trace:edit`).
- **Seed beds:** `CAP-SVC-OPERATION-EXECUTOR.1` / `CAP-AUTH-HARDEN.1` supersede v0; inheritable pins; product contract pins **active tips** (not superseded v0).
- **Patch:** `docs/design/seed/scripts/patch_trace_inherit_uses_release.py` — run **after** `patch_reqalm_contracts_release.py` on rebased main; idempotent re-run on `origin/main` dogfood → **zero diff**.
- **Loader:** `trace_edges.inheritable`; validate **≤1 active version per line**.

When continuing in Cursor: read `ARCH-TRACE-INHERIT-USES` in `dogfood.yaml`; implement read-time rollup in a separate small PR.
