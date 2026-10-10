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
| LF endings | `rel-r1-lf-endings` / `CAP-DEVENV-LF-ENDINGS` | **Shipped** on main via PR #35 (seed marks shipped; no duplicate ship PR). |

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
  - **`ctr-reqalm-product`** — build contract; `covers_releases` = all reqalm release ids; `in_scope_of` = each reqalm cap/requirement at **active tip or newest non-superseded draft**, excluding upkeep caps and **`SYS-CYBER-UPKEEP`** (owned under maintenance).
  - **`ctr-reqalm-maintenance`** — maintenance contract; `covers_releases` empty; `in_scope_of` = draft **`CAP-UPKEEP-*`** capabilities (planned, not shipped) that **`satisfies` → `SYS-CYBER-UPKEEP`** with per-capability NIST `conforms_to` pins.
  - **`SYS-CYBER-UPKEEP`** — system requirement under **SEC-SEC** (draft); umbrella `conforms_to` **CA-7, RA-5, SI-2, AC-2, AU-6** @ NIST imprint.
- **Patch (idempotent):** `docs/design/seed/scripts/patch_reqalm_contracts_release.py`
- **Grammar:** `covers_releases` on `contract` (see `schema.md` / `reqseed.schema.json`); exported as Parent + `CoversRelease` on `contracts-releases.sdoc`.
- **Source of truth:** `docs/design/seed/dogfood.yaml` + regenerated `docs/design/seed/out/`

When continuing in Cursor: read `dogfood.yaml` releases and `ARCH-BROWSE-ROADMAP` first; pick the next **planned** release; implement; update seed via a dedicated `patch_*_release.py`; validate and test.

## Addendum — main @ `88df54d` (2026-10-09, PR #38 merged)

- **Merged on main:** **PR #38** — product + maintenance contracts seed (`rel-r1-reqalm-contracts` / `CAP-REQALM-CONTRACTS` at merge **`88df54dea5c8d2bfd895e2613b17dbf2c5b3405f`**).
- **Parallel PR pair (rule 3):** PR #39 ships **`rel-r1-reqalm-contracts`** at that full merge SHA when landing inherit-uses seed (no partial pins).

## Addendum — inherit-uses common control (PR #39, branch `cursor/inherit-uses-controls-0606`)

- **Release (planned):** `rel-r1-trace-inherit-uses` → **`CAP-TRACE-INHERIT-USES`**.
- **Architecture:** **`ARCH-TRACE-INHERIT-USES`**, **`ARCH-TRACE-INHERIT-HYBRID`** (Cyber 2026-10-09 text, `rbac_op: trace:edit`).
- **Seed beds:** `CAP-SVC-OPERATION-EXECUTOR.1` / `CAP-AUTH-HARDEN.1` supersede v0; inheritable `conforms_to` pins; **`uses`** from `CAP-UI-FRAME.1` and route executor; product contract `in_scope_of` refreshed to **active tips** (not superseded v0).
- **Patch (idempotent, run after `patch_reqalm_contracts_release.py`):** `docs/design/seed/scripts/patch_trace_inherit_uses_release.py` — also marks **`rel-r1-reqalm-contracts`** shipped at **`88df54d`**; idempotent re-run on `origin/main` dogfood → zero diff.
- **Loader:** migration `011_trace_edges_inheritable.sql`; `trace_edges.inheritable` on capability `conforms_to` only; validate **≤1 active version per line** in `yaml_to_strictdoc.py`.
- **Schema:** edge field **`inheritable`** (see `schema.md` / `reqseed.schema.json`); contract **`covers_releases`** / **`notes`** unchanged from PR #38.
- **Deferred:** read-time inherited + hybrid control display (follow-on PR after loader merge).

When continuing inherit-uses in Cursor: read **`ARCH-TRACE-INHERIT-USES`** in `dogfood.yaml` first; keep read API inheritance for the next small PR.

## Addendum — main @ `56bfc4d` (2026-10-10, seed attachments + Figma)

- **Release (planned):** `rel-r1-seed-attach-figma` → **`CAP-SEED-ATTACH-FIGMA`** (seed-only; no release shipped in this PR).
- **Requirements (draft):** **`ARCH-ATTACH`**, **`ARCH-ATTACH-PIN-VERSION`**, **`ARCH-ATTACH-SCOPE`**, **`ARCH-ATTACH-AUDIT`**, **`ARCH-ATTACH-SERVE`**, **`ARCH-ATTACH-UPLOAD`**, **`ARCH-ATTACH-ENCRYPT`**, **`ARCH-FIGMA`**, **`ARCH-FIGMA-AUTH`**, **`ARCH-FIGMA-EGRESS`**.
- **Capabilities (draft):** **`CAP-ATTACH-READ`**, **`CAP-ATTACH-WRITE`**, **`CAP-FIGMA-LINK`**.
- **Edges (snippet):** 103 new trace edges — 58 `conforms_to` (39 NIST, 19 STIG), 15 `refines`, 19 `uses`, 11 `satisfies`; targets resolve to active version uids where applicable.
- **Product contract:** all 13 new lines added to **`ctr-reqalm-product`** `in_scope_of` (via scope refresh).
- **Patch (idempotent):** `docs/design/seed/scripts/patch_attach_figma_seed_release.py` — source snippet `docs/design/seed/fixtures/cyber-attach-figma-snippet.yaml`.
- **Validate:** `python3 docs/design/seed/scripts/yaml_to_strictdoc.py --validate` (regenerates `docs/design/seed/out/`).
- **Parallel PRs:** Catalogs browse UI and Contracts API may merge first; whichever PR merges after them owns shipping their planned releases — this PR does not ship any release.
