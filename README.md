# ReqAML monorepo

pnpm workspace for **ReqAML** (requirements / ALM) and the **SDoc Intake** editor.

| Path | Role |
| --- | --- |
| [`apps/reqaml`](apps/reqaml) | ReqAML platform shell — API, web placeholder, MCP stub, sync worker (roles via `REQAML_ROLES`). |
| [`packages/intake`](packages/intake) | StrictDoc `.sdoc` editor and `sdoc-intake` CLI. |
| [`docs/design`](docs/design) | Architecture, C4, and dogfood seed (`seed/dogfood.yaml`). |
| [`specforge`](specforge) | Optional SpecForge Docker harness (unchanged). |

Design source of truth: `docs/design/seed/dogfood.yaml` and `docs/design/c4/ARCHITECTURE.md`.

## Quick start — ReqAML dev (ARCH-DEVENV-CLONE)

**Prerequisites:** Node 22+, pnpm 10+, Docker with Compose v2.

```sh
git clone <repo-url> reqaml && cd reqaml
pnpm install
cp .env.example .env
```

### Full-container mode (2 containers)

Runs the **app** and **peripherals** (Postgres + OpenBao) images from the root `Dockerfile`:

```sh
docker compose up --build
```

Open **http://localhost:3000** (web placeholder). Probes: `/health`, `/ready`, `/docs` (OpenAPI UI), `/api/v1/seed/summary`.

First start applies migrations and loads the dogfood seed (`REQAML_SEED_ON_START=true`). OpenBao initializes Transit with a **dev-marked** mount and KEK (`reqaml-kek`); unseal key and root token are stored in the `reqaml-secrets` volume (never committed).

Seeded dev local accounts are `<identity-id>@dev.local`. Their password comes from `REQAML_DEV_ACCOUNT_PASSWORD` in your `.env`; if it is empty, the first seed generates one and prints it once (`docker compose logs app | grep "reqaml seed"`). No default credential is committed.

### Hybrid mode (hot reload)

Peripherals only in Docker; app runs natively:

```sh
docker compose up peripherals -d
pnpm dev:reqaml
```

Same `.env` DSN (`DATABASE_URL=postgresql://reqaml:reqaml@127.0.0.1:5432/reqaml`) and `OPENBAO_ADDR=http://127.0.0.1:8200`. `pnpm dev:reqaml` loads the root `.env` and, when `OPENBAO_TOKEN` is empty, reads the dev OpenBao root token from the running peripherals container (`reqaml-secrets` volume) and passes it to the app process only — nothing is written to disk. Stop the app container first (`docker compose stop app`) if you switch from full-container mode, since both use port 3000.

### One-shot migrate / seed

```sh
pnpm reqaml:migrate
pnpm reqaml:seed
```

Re-running seed is idempotent (`FIX-ALLOW-DEVENV-SEED-IDEMPOTENT`).

### Smoke test (FIX-ALLOW-DEVENV-SMOKE)

```sh
pnpm devenv:smoke
```

This is the primary check: it builds and starts the 2-container stack (`docker compose up --build -d --wait`), checks `/health`, `/ready` and `/api/v1/seed/summary`, re-runs migrate + seed twice (no new rows), asserts exactly 2 healthy containers, and asserts production mode refuses the dev seed loader, dev accounts and dev OpenBao. Any failing command's stdout/stderr is printed, followed by `docker compose ps -a` and recent logs. The stack is left running; set `REQAML_SMOKE_DOWN=1` to run `docker compose down -v` at the end. The GitHub workflow (`.github/workflows/devenv-smoke.yml`) is manual-dispatch only to save Actions minutes.

## SDoc Intake editor

Unchanged workflow — see [`packages/intake/README.md`](packages/intake/README.md):

```sh
pnpm dev          # editor on port 8087
pnpm build:cli
pnpm exec sdoc-intake ./packages/intake/data
```

## Production notes

- Set `REQAML_MODE=production`. Startup **refuses** dev OpenBao markers, dev seed loaders, and seeded dev accounts (`FIX-DENY-DEV-KEK-IN-PROD`, `FIX-DENY-DEVENV-PROD-LOGIN.1`).
- Production deploy splits Postgres and OpenBao; the **peripherals** image target is dev/test only (`ARCH-DEPLOY-PERIPHERALS`).

## Process model (open question documented)

**Single Node process** with role toggles (`REQAML_ROLES`) is the default — simplest path that satisfies `ARCH-DEPLOY-MINIMAL` and `FIX-ALLOW-APP-ROLE-SPLIT` without a supervisor. A lightweight supervisor can be added later if ops need isolated restart per role.

**StrictDoc export** is intentionally **not** a Compose role in this slice (open question §3 in `docs/design/roles/open-questions.md`).

## License

MIT. Copyright (c) 2026 Dan Raby.
