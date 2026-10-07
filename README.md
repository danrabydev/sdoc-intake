# ReqALM monorepo

pnpm workspace for **ReqALM** (requirements / ALM) and the **SDoc Intake** editor.

| Path | Role |
| --- | --- |
| [`apps/reqalm`](apps/reqalm) | ReqALM platform shell — API, web placeholder, MCP stub, sync worker (roles via `REQALM_ROLES`). |
| [`packages/intake`](packages/intake) | StrictDoc `.sdoc` editor and `sdoc-intake` CLI. |
| [`docs/design`](docs/design) | Architecture, C4, and dogfood seed (`seed/dogfood.yaml`). |
| [`specforge`](specforge) | Optional SpecForge Docker harness (unchanged). |

Design source of truth: `docs/design/seed/dogfood.yaml` and `docs/design/c4/ARCHITECTURE.md`.

## DEV-SETUP (ReqALM local)

**Prerequisites:** Node 22+, pnpm 10+, Docker Compose v2.

```sh
git clone <repo-url> sdoc-intake && cd sdoc-intake
pnpm install
pnpm devenv:init          # random secrets → .reqalm/devenv.env + .env (mode 600, printed once)
docker compose up --build # app listens on 127.0.0.1:3000 only
```

`pnpm devenv:init --rotate` issues new secrets; because Postgres keeps its first password in the volume, follow it with `docker compose down -v && docker compose up --build -d --wait` (dev data is reset).

1. Open **http://127.0.0.1:3000/login** (or `http://localhost:3000/login`).
2. Sign in as `<identity-id>@dev.local` using the dev password from `devenv:init`.
3. **Privileged roles (Security, AO, etc.)** must enroll MFA: use the first-login enrollment screen, or run  
   `pnpm devenv:mfa sam-security` (runs inside the app container; uses `REQALM_MFA_DEV_SECRET` from devenv for non-interactive dev enroll, or `--interactive` for a fresh secret + `--ticket=… --confirm=<code>`).
4. **Coding agents** (Cursor Cloud, etc.): run  
   `pnpm devenv:agent-token --agent cursor-cloud [--role Reader|Author] [--ttl 3600] [--acting-for dan]`  
   `REQALM_AGENT_CLIENT_SECRET` comes from `devenv:init`. Tokens are OAuth **client_credentials** on `reqalm-agent-dev` (TTL ≤ 1h, revocable like any access token). The agent is its own principal (`agent-cursor-cloud`) with explicit Reader + Author grants on `reqalm`; each token carries one role (default Reader), roles above Author or not granted are refused, and authorization uses only that role. Mutation attempts audit `agent_name`, token role and acting-for.

**Hybrid hot reload** (app on the host): expose Postgres/OpenBao on the loopback only:

```sh
docker compose -f docker-compose.yml -f docker-compose.hostports.yml up peripherals -d
pnpm dev:reqalm
```

**Production issuer:** set `REQALM_ISSUER_URL` to the public HTTPS origin (startup self-check requires it in production). Terminate TLS at your reverse proxy; leave `REQALM_TRUST_PROXY=false` unless the proxy sets trusted `X-Forwarded-*` headers, and then list the proxies in `REQALM_TRUSTED_PROXIES` (production refuses blanket trust).

**Signing (R1):** JWT signing uses Transit-**wrapped** ES256 keys in the app process. FIPS-validated modules and OpenBao Transit-**sign** (private key never leaves HSM) are documented follow-ups in the seed (`CAP-KEY-ENVELOPE`).

### Full-container mode (2 containers)

Runs the **app** and **peripherals** (Postgres + OpenBao) images from the root `Dockerfile`:

```sh
docker compose up --build
```

Open **http://127.0.0.1:3000**. Probes: `/health`, `/ready`, `/docs` (OpenAPI UI), `/api/v1/seed/summary`.

**Liveness vs readiness:** `/health` only confirms the app process is up (Compose liveness). `/ready` live-checks Postgres, pending migrations, OpenBao (unsealed + Transit KEK encrypt/decrypt), and each enabled role; it returns **503** when a dependency is down (Compose readiness). Startup waits for peripherals with backoff so the app container does not crash-loop while OpenBao unseals.

First start applies migrations and loads the dogfood seed (`REQALM_SEED_ON_START=true`). OpenBao initializes Transit with a **dev-marked** mount and KEK (`reqaml-kek`); unseal key and root token are stored in the `reqaml-secrets` volume (never committed). The Compose volume names and the Transit key name keep the legacy ReqAML spelling on purpose so existing dev stacks keep their data and ciphertexts across the rename.

Seeded dev local accounts are `<identity-id>@dev.local`. Passwords come from `pnpm devenv:init` (`REQALM_DEV_ACCOUNT_PASSWORD` in `.env`). No default credential is committed.

### Hybrid mode (hot reload)

See **DEV-SETUP** above (`docker-compose.hostports.yml`). `pnpm dev:reqalm` loads root `.env` and, when `OPENBAO_TOKEN` is empty, reads the dev OpenBao root token from the running peripherals container. Stop the app container first (`docker compose stop app`) if you switch from full-container mode.

### One-shot migrate / seed

```sh
pnpm reqalm:migrate
pnpm reqalm:seed
```

Re-running seed is idempotent (`FIX-ALLOW-DEVENV-SEED-IDEMPOTENT`).

### Smoke test (FIX-ALLOW-DEVENV-SMOKE)

```sh
pnpm devenv:smoke
```

This is the primary integration check (Docker required): it builds and starts the 2-container stack (`docker compose up --build -d --wait`), checks `/health`, `/ready` and `/api/v1/seed/summary`, re-runs migrate + seed twice (no new rows), asserts exactly 2 healthy containers, and asserts production mode refuses the dev seed loader, dev accounts and dev OpenBao. Any failing command's stdout/stderr is printed, followed by `docker compose ps -a` and recent logs. The stack is left running; set `REQALM_SMOKE_DOWN=1` to run `docker compose down -v` at the end. The GitHub workflow (`.github/workflows/devenv-smoke.yml`) is manual-dispatch only to save Actions minutes.

### Tests (no Docker)

Before pushing, run the fast in-process gate (cloud agents and contributors without Docker):

```sh
pnpm test
pnpm typecheck
```

`pnpm test` runs `@reqalm/app` unit tests plus in-process auth integration tests (PGlite + in-memory KeyProvider fake). Full-stack auth behaviour is still verified with `pnpm devenv:smoke` locally.

## SDoc Intake editor

Unchanged workflow — see [`packages/intake/README.md`](packages/intake/README.md):

```sh
pnpm dev          # editor on port 8087
pnpm build:cli
pnpm exec sdoc-intake ./packages/intake/data
```

## Production notes

- Set `REQALM_MODE=production`. Startup **refuses** dev OpenBao markers, dev seed loaders, and seeded dev accounts (`FIX-DENY-DEV-KEK-IN-PROD`, `FIX-DENY-DEVENV-PROD-LOGIN.1`).
- Production deploy splits Postgres and OpenBao; the **peripherals** image target is dev/test only (`ARCH-DEPLOY-PERIPHERALS`).

## Process model (open question documented)

**Single Node process** with role toggles (`REQALM_ROLES`) is the default — simplest path that satisfies `ARCH-DEPLOY-MINIMAL` and `FIX-ALLOW-APP-ROLE-SPLIT` without a supervisor. A lightweight supervisor can be added later if ops need isolated restart per role.

**StrictDoc export** is intentionally **not** a Compose role in this slice (open question §3 in `docs/design/roles/open-questions.md`).

## License

MIT. Copyright (c) 2026 Dan Raby.
