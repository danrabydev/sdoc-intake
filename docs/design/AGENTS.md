# Cursor Cloud Agents — ReqALM monorepo

Short operating guide for agents working in this repository. Human handoff history and PR slicing rules live in [`HANDOFF.md`](./HANDOFF.md).

## Environment

- **Node:** 22+ (see root `packageManager` / `engines`).
- **Package manager:** `pnpm` via Corepack (`pnpm install --frozen-lockfile`).
- **Python 3:** seed scripts under `docs/design/seed/scripts/` (**PyYAML** + **ruamel.yaml** required for `yaml_to_strictdoc.py` and `patch_*` scripts).
- **Database for tests:** `@reqalm/app` uses **in-process PGlite** + **`pg`** against a local TCP socket (`@electric-sql/pglite-socket`). **Docker is not required** for `pnpm --filter @reqalm/app test`.
- **Docker Compose:** only for full devenv smoke (`pnpm devenv:smoke`) and hybrid local app runs — not for the unit/integration test gate.

Repo-managed Cursor environment: [`.cursor/environment.json`](../../.cursor/environment.json) with [`.cursor/cloud-agent-install.sh`](../../.cursor/cloud-agent-install.sh) and [`.cursor/cloud-agent-start.sh`](../../.cursor/cloud-agent-start.sh).

## Commands (from repo root)

| Task | Command | Typical wall time (Linux cloud VM, warm cache) |
|------|---------|-----------------------------------------------|
| Typecheck (all packages) | `pnpm typecheck` | ~25–45s |
| Typecheck (ReqALM app only) | `pnpm --filter @reqalm/app typecheck` | ~8–15s |
| Full ReqALM test suite | `pnpm --filter @reqalm/app test` | ~90–120s (PGlite + full dogfood loads) |
| Single test file | `pnpm --filter @reqalm/app exec node scripts/run-tests.mjs src/seed/seed-reset.test.ts` | varies (~5–70s for heavy seed files) |
| Seed validate (no commit) | `python3 docs/design/seed/scripts/yaml_to_strictdoc.py --validate` | ~15–40s |
| Seed regenerate (writes `out/`) | run the relevant idempotent `docs/design/seed/scripts/patch_*_release.py`, then `python3 docs/design/seed/scripts/yaml_to_strictdoc.py --validate` | ~20–60s per patch |
| Full monorepo tests | `pnpm test` | ReqALM suite + `sdoc-intake` scripts |

Per-test hang guard: `REQALM_TEST_TIMEOUT_MS` (default **120000** ms) via `apps/reqalm/scripts/run-tests.mjs`.

## Standing rules (every commit / PR)

1. **`[skip ci]` in every commit message** — GitHub Actions are manual/dispatch only; avoid Actions spend on push.
2. **LF line endings** — respect `.gitattributes`; do not reintroduce CRLF on shell/SQL/TS sources.
3. **`HANDOFF.md` is additions-only** — append addenda; do not rewrite or delete prior handoff sections.
4. **Release rows only via seed-only PRs** — ship/plan/start release state in `dogfood.yaml` through dedicated idempotent `patch_*_release.py` + regenerated `docs/design/seed/out/`; never fold release-status edits into feature PRs.
5. **No seed or release row drive-by edits** on feature branches unless the task is explicitly a seed PR.
6. **Production approach in tests** — real SQL migrations, real `pg` driver against PGlite; no mocked schema.

## Where to look first

- [`HANDOFF.md`](./HANDOFF.md) — merged PR map, devenv, next-up releases.
- [`docs/design/seed/dogfood.yaml`](./seed/dogfood.yaml) — product source of truth.
- [`apps/reqalm/src/test/harness.ts`](../../apps/reqalm/src/test/harness.ts) — in-process app + auth helpers.
