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
9. **Release state in seed** — when a release is planned, started, or shipped, update `dogfood.yaml` in a **tiny seed-only commit** (idempotent `patch_*` script + regenerated `out/`). Do not fold those status changes into the next feature PR.

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

- **Release (planned):** `rel-r1-seed-attach-figma` → **`CAP-SEED-ATTACH-FIGMA`** (seed-only; this capability release stays planned while this PR ships PR #39’s trace-inherit release per rule 3 below).
- **Requirements (draft):** **`ARCH-ATTACH*`**, **`ARCH-ATTACH-SCAN`**, **`ARCH-FIGMA*`**, **`SPIKE-FIGMA-FEASIBILITY`**; **`ARCH-KEY-SCOPE.1`** content mint (v0 stays active, unedited; outbound edges duplicated on `.1`).
- **Capabilities (draft):** **`CAP-ATTACH-READ`**, **`CAP-ATTACH-WRITE`** (`CAP-FIGMA-LINK` removed in Cyber v2).
- **Edges:** **156** trace edges total (**113** from snippet v2 + **43** from delta v3). Snippet kinds: 65 `conforms_to`, 18 `refines`, 21 `uses`, 9 `satisfies`; targets resolve to active version uids where applicable.
- **Product contract:** **`ctr-reqalm-product`** `in_scope_of` refreshed (drops **`CAP-FIGMA-LINK`**; adds **`ARCH-ATTACH-SCAN`**, **`SPIKE-FIGMA-FEASIBILITY`**; pins active **`ARCH-KEY-SCOPE`** v0 only per #38 — draft **`.1`** omitted until activation).
- **Delta v3 (file versioning):** `docs/design/seed/fixtures/delta-versions.yaml` — **`ARCH-ATTACH-VERSIONS`** line + **`.1`** content mints on **`ARCH-ATTACH-PIN-VERSION`**, **`ARCH-ATTACH-SCOPE`**, **`ARCH-ATTACH-ENCRYPT`** (v0 unchanged; 43 edges).
- **Patch (idempotent):** `docs/design/seed/scripts/patch_attach_figma_seed_release.py` — applies snippet + delta; product contract pins **`ARCH-ATTACH-VERSIONS`** v0 and active/draft v0 tips only (draft **`.1`** successors omitted per #38).
- **Validate:** `python3 docs/design/seed/scripts/yaml_to_strictdoc.py --validate` (regenerates `docs/design/seed/out/`).
- **Parallel PR pair (rule 3):** This PR ships **`rel-r1-trace-inherit-uses`** / **`CAP-TRACE-INHERIT-USES`** at main merge **`56bfc4d6a9fe04559ccddae636ec4052d84ae907`** (PR #39). **`rel-r1-seed-attach-figma`** stays planned.
- **PR #42 ship (main @ `1eb8482`):** **`rel-r1-seed-attach-figma`** / **`CAP-SEED-ATTACH-FIGMA`** shipped **2026-10-09** at merge **`1eb8482b533b5f656240bc7b53a60b1a58c5a203`** via `patch_ui_layout_capabilities_release.py` (do not re-edit merged **`patch_attach_figma_seed_release.py`**).
- **Patch idempotency:** Merged seed **`patch_*_release.py`** scripts are point-in-time history and are not re-run on later seeds; each follow-on PR ships through its own idempotent patch.

## Addendum — UI layout capability statements (seed PR #42, main @ `1eb8482`)

- **Release (planned):** `rel-r1-ui-layout-capabilities` → **`CAP-UI-LAYOUT`** (draft; documents header + content region patterns and navigation).
- **Content mints (layout prose):** shipped browse caps **`CAP-BROWSE-UI-*`**, **`CAP-UI-HEADER-NAV`**, **`CAP-UI-FRAME.2`**; draft layout intent only on **`CAP-CONTRACT-UI.1`** / **`CAP-VERSION-UI.1`**; draft edits **`CAP-UI-KIT`**, **`CAP-UI-KIT-CHROME`**, **`CAP-UI-KIT-TREE`** (WAI-ARIA + paging label restored on tree draft).
- **Mock view drafts:** six **`CAP-UI-VIEW-*`** capabilities; mock URIs under **`mockups/reqalm-two-column/shots/`** (see `docs/design/mockups/README.md`).
- **Patch (idempotent):** `docs/design/seed/scripts/patch_ui_layout_capabilities_release.py` — ships attach-figma release above; never removes baseline outbound edges; **`--validate-baseline-edges`**; baseline fixture **`docs/design/seed/fixtures/dogfood-baseline-outbound-edges.json`** @ **`1eb8482`**; run before `yaml_to_strictdoc.py --validate`.
- **Counts (post-patch):** 453 lines, 486 versions, **1934** edges, 33 releases.

## Addendum — browse catalogs UI (PR #41, rebased main @ `4d82bf9`)

- **Ship (this PR’s seed patch):** `rel-r1-ui-layout-capabilities` → **`CAP-UI-LAYOUT`** at merge **`4d82bf9ab35ed63db675de8b187952cf60a434e5`** (2026-10-09), `active` / `pass` (PR #42 landed on main; ship step lives in **`patch_browse_ui_catalogs_release.py`** only).
- **Release (planned):** `rel-r1-browse-ui-catalogs` → **`CAP-BROWSE-UI-CATALOGS`** (read-only `/app/.../catalogs` list, imprint detail, control detail; Catalogs project tab).
- **Patch (idempotent):** `docs/design/seed/scripts/patch_browse_ui_catalogs_release.py` — baseline fixture **`docs/design/seed/fixtures/dogfood-baseline-outbound-edges.json`** @ **`4d82bf9`**; **`--validate-baseline-edges`**; allow-list ship rows **`rel-r1-ui-layout-capabilities`** / **`CAP-UI-LAYOUT`** only; regenerate **`docs/design/seed/out/`** after apply.
- **Counts (post-patch):** 454 lines, 487 versions, **1938** edges, 34 releases.

## Addendum — contracts loader (storage PR #44, baseline @ `cbee54e`)

- **Ship (this PR’s seed patch):** `rel-r1-browse-ui-catalogs` → **`CAP-BROWSE-UI-CATALOGS`** at merge **`cbee54e9484d89430b461789052cea296e1669c5`** (2026-10-09), `active` / `pass` (merged #41; do not edit **`patch_browse_ui_catalogs_release.py`**).
- **Release (planned):** `rel-r1-contracts-loader` → **`CAP-CONTRACTS-LOADER`** (migration + dogfood loader only; read API is PR #43).
- **Runtime:** `012_contracts_read.sql`; loader upserts `contracts`, `contract_scope`, `contract_releases`; seed reset wipes junction tables before `releases`; junction FKs **`ON DELETE RESTRICT`**; loader validates **`CONTRACT_ID`**, product/maintenance scope disjointness, and cross-project scope lines (intended).
- **Patch:** `docs/design/seed/scripts/patch_contracts_loader_release.py` — baseline fixture @ **`cbee54e`**; allow-list ship rows browse catalogs + planned loader only; **`--validate-baseline-edges`**.
- **Validate:** `python3 patch_contracts_loader_release.py && python3 yaml_to_strictdoc.py --validate`.
- **Counts (post-patch):** 455 lines, 488 versions, **1941** edges, 35 releases (4 planned including loader).

## Addendum — contracts read API (PR #43)

- **Ship (this PR patch):** `rel-r1-contracts-loader` → **`CAP-CONTRACTS-LOADER`** @ **`a3ebdcdc23d9032eefa4109603e527b4e80d6c77`** (2026-10-10); baseline fixture @ **`a3ebdcd`**; allow-list loader ship rows only (earlier ship rows byte-identical).
- **Release (planned):** `rel-r1-read-contracts` → **`CAP-READ-CONTRACTS`** (not shipped until Dan says so).
- **API:** four GET routes under `/api/v1/projects/:projectId/contracts`; **`contract:read`** (no separate **`contract:list`** grant); grant-filtered counts; hidden scope lines omitted; authz/missing → **404**; releases routes stay **403** when denied.
- **Patch:** `patch_read_contracts_release.py` — **`--validate-baseline-edges`**.
- **Counts (post-patch):** 456 lines, 489 versions, **1945** edges, 36 releases (4 planned + read API tranche).

## Addendum — browse contracts UI (PR browse-ui-contracts, main @ `aa7e856`)

- **Ship (this PR’s seed patch):** `rel-r1-read-contracts` → **`CAP-READ-CONTRACTS`** @ **`aa7e85631819d45ac04852831ab305d655f1eddd`** (2026-10-10), `active` / `pass`; baseline fixture @ **`aa7e856`**; allow-list read API ship rows only.
- **Release (planned):** `rel-r1-browse-ui-contracts` → **`CAP-BROWSE-UI-CONTRACTS`** (read-only `/app/.../contracts` list + detail; Contracts project tab).
- **Out of scope (mockups 02–03 / CAP-CONTRACT-UI):** document view from contract, overlap timeline, cyber_gate display — no read API fields yet.
- **Patch (idempotent):** `docs/design/seed/scripts/patch_browse_ui_contracts_release.py` — **`--validate-baseline-edges`**; regenerate **`docs/design/seed/out/`** after apply.
- **Counts (post-patch):** 457 lines, 490 versions, **1950** edges, 37 releases.

## Addendum — RBAC authorize fail closed (PR #46, baseline @ `86d3154`)

- **Ship (this PR’s seed patch):** `rel-r1-browse-ui-contracts` → **`CAP-BROWSE-UI-CONTRACTS`** @ **`86d315462b67446e605d6c898c15df2c8066b5d3`** (2026-10-10), `active` / `pass`; baseline fixture @ **`86d3154`**; allow-list browse UI ship rows only.
- **Release (planned):** `rel-r1-rbac-authorize-fail-closed` → **`CAP-SVC-RBAC-NO-PROJECT`** (not shipped until merge).
- **Runtime:** `listActiveRoles` ignores project grants when `projectId` is omitted; `authorize` denies all permissions except platform Key custodian **`key:manage`** and **`audit:read`** without a project scope.
- **Patch (idempotent):** `docs/design/seed/scripts/patch_rbac_authorize_fail_closed_release.py` — **`--validate-baseline-edges`**; regenerate **`docs/design/seed/out/`** after apply.
- **Counts (post-patch):** 458 lines, 491 versions, **1953** edges, 38 releases.

## Addendum — release state seed (main @ `d54c5a6`, PR #46 shipped)

- **Ship (this PR’s seed patch):** `rel-r1-rbac-authorize-fail-closed` → **`CAP-SVC-RBAC-NO-PROJECT`** @ **`d54c5a67235fd56e49bdbc2a939dce89ff5a4f36`** (2026-10-10), `active` / `pass`; baseline fixture @ **`d54c5a6`**; allow-list RBAC ship rows only.
- **Started (planned + note):** `rel-r1-planning-read-api` / **`CAP-READ-PLANNING`** (bc-a71c6948); `rel-r1-artifacts-read-api` / **`CAP-READ-ARTIFACTS`** (bc-72846206); `rel-r1-hardening-followup-1` / **`CAP-SVC-HARDENING-FOLLOWUP`** (bc-7132b537).
- **Patch (idempotent):** `docs/design/seed/scripts/patch_r1_release_state_seed.py` — **`--validate-baseline-edges`**; regenerate **`docs/design/seed/out/`** after apply.
- **Counts (post-patch):** 461 lines, 494 versions, **1959** edges, 41 releases.

## Addendum — Cursor Cloud Agent environment (repo tooling)

- **Agent guide:** [`docs/design/AGENTS.md`](./AGENTS.md) — typecheck/test/seed commands, typical durations, PGlite-in-process test contract (no Docker for `pnpm --filter @reqalm/app test`), and standing rules (`[skip ci]`, LF, additions-only HANDOFF, seed-only release rows).
- **Environment config:** [`.cursor/environment.json`](../../.cursor/environment.json) — Node 22 base image, `pnpm install --frozen-lockfile`, Python 3 + PyYAML for seed scripts; install/start scripts are LF-safe shell entrypoints under `.cursor/`.
