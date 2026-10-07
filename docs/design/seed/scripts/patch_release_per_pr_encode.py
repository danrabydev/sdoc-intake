#!/usr/bin/env python3
"""Encode "one PR = one release" + capabilities for real development (2026-10-07).

Dan (2026-10-07):
  * "the ReqALM dogfood seed should show releases, and for now each PR is one release."
  * "add capabilities and populate them well, so the dogfood keeps up with real development."
  * ReqALM will soon manage its own project: keep the seed import-ready.

Releases:
  * rel-pr11-planning-baseline — PR #11 (merged 50877ca, 2026-10-07), shipped. Planning /
    design docs + seed + folded reviews only; no runtime code, so it delivers no requirement or
    capability versions (no product features invented).
  * rel-pr12-devenv-foundation — PR #12 (planned until merge). Delivers the CapabilityLines it
    actually built (verified locally) plus the requirement versions it fully meets. Those
    requirement versions MOVE out of rel-r1-foundation-shell-auth; partially met ones stay in R1.
  * rel-r1-foundation-shell-auth — kept id (referenced by ARCH-BUILD-FOUNDATION + docs); renamed
    to make it the next PR (UI frame + internal auth); gains the planned CapabilityLines.

Capabilities are born with Satisfies (gate-satisfies-at-create / ARCH-CAP-LINK). Line-grain
ApprovalRecords are written `unapproved` (solution approval is Dan's; activate != approve).
Delivered caps: status active + verification_outcome pass (evidence in security.verification_note
and capability_artifacts). Planned caps: status draft, no verification_outcome.

Idempotent. Does NOT git commit. Run yaml_to_strictdoc.py --validate afterwards.
"""
from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
NIST = "nist-800-53@rev5-dogfood-20261006"
REPO = "../../.."  # capability_artifacts URIs are relative to docs/design/seed/

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 1200
yaml.indent(mapping=2, sequence=2, offset=0)


def cm(**kw):
    m = CommentedMap()
    for k, v in kw.items():
        m[k] = v
    return m


def statement_hash(text: str) -> str:
    canon = "\n".join(line.rstrip() for line in text.strip().replace("\r\n", "\n").split("\n"))
    return "sha256:" + hashlib.sha256(canon.encode("utf-8")).hexdigest()


def find(seq, key, val):
    for x in seq:
        if x.get(key) == val:
            return x
    return None


def upsert(seq, key, item):
    cur = find(seq, key, item[key])
    if cur is None:
        seq.append(item)
        return 1
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
    return 0


def ensure_edge(edges, edge):
    key = (edge.get("from"), edge.get("to"), edge.get("kind"), edge.get("catalog_imprint_id"))
    for e in edges:
        if (e.get("from"), e.get("to"), e.get("kind"), e.get("catalog_imprint_id")) == key:
            return 0
    edges.append(edge)
    return 1


# --------------------------------------------------------------------------------------------
# PR #12 — delivered capabilities (code on cursor/reqalm-devenv-foundation-b0e0, verified locally)
# --------------------------------------------------------------------------------------------
EVIDENCE_SMOKE = "`pnpm devenv:smoke` from clean (no volumes, no .env) passed 2026-10-07"

DELIVERED = [
    dict(
        uid="CAP-DEVENV-MONOREPO", parent="SEC-DEVENV",
        title="pnpm workspace monorepo (apps/reqalm + packages/intake)",
        statement=(
            "The repository is a pnpm workspace (pnpm-workspace.yaml: packages/*, apps/*) with one lockfile. "
            "The ReqALM platform app lives in apps/reqalm (@reqalm/app) and the SDoc Intake editor and CLI in packages/intake (sdoc-intake), "
            "so both build from one clone with `pnpm install`. Root scripts proxy per-package tasks (dev, dev:reqalm, build:cli, reqalm:migrate, reqalm:seed, devenv:smoke). "
            "Acceptance: `pnpm install --frozen-lockfile` succeeds on a clean clone; the editor still runs (`pnpm dev`) and builds (`pnpm build:cli`); the app typechecks and tests pass."
        ),
        satisfies=["ARCH-DEVENV-CLONE"],
        security=("CM-2", "CM-2 baseline: one lockfile pins the supported toolchain. Verified 2026-10-07: pnpm install --frozen-lockfile; pnpm build:cli OK; editor dev server on :8087; sdoc-intake typecheck + 39/39 tests; @reqalm/app typecheck + tests."),
        artifacts=[("other", "pnpm-workspace.yaml"), ("other", "package.json"), ("other", "apps/reqalm/package.json"), ("other", "packages/intake/package.json")],
    ),
    dict(
        uid="CAP-DEVENV-DOCKERFILE-ROLES", parent="SEC-DEVENV",
        title="Single Dockerfile; one app container with REQALM_ROLES toggles",
        statement=(
            "One multi-stage Dockerfile builds every image: app (Node 22, the deploy target), peripherals (dev/test only) and app-hsm-test. "
            "The app container runs one Node process whose roles are toggled by REQALM_ROLES (api, web, mcp, sync); /ready reports per enabled role, and routes for disabled roles are not mounted. "
            "Acceptance: the same image started with REQALM_ROLES=sync serves only probes (readiness lists sync only; /api and /mcp return 404) without a rebuild; with all roles it serves API, web, MCP stub and runs sync."
        ),
        satisfies=["ARCH-DEPLOY-MINIMAL", "ARCH-DEVENV-PARITY.1", "FIX-ALLOW-APP-ROLE-SPLIT"],
        security=("CM-7", "CM-7 least functionality: disabled roles expose no endpoints. Verified 2026-10-07: docker compose build; REQALM_ROLES=sync run → /ready roles=[sync], /api/v1/seed/summary 404, POST /mcp 404, /health 200. Internal OAuth AS role not built yet (R1), so FIX-ALLOW-APP-ROLE-SPLIT is only partly exercised."),
        artifacts=[("other", "Dockerfile"), ("other", ".dockerignore"), ("other", "apps/reqalm/src/main.ts"), ("other", "apps/reqalm/src/config.ts")],
    ),
    dict(
        uid="CAP-DEVENV-PERIPHERALS", parent="SEC-DEVENV",
        title="Dev peripherals container: Postgres + OpenBao",
        statement=(
            "The peripherals Dockerfile target runs Postgres 16 and OpenBao (checksum-verified release binary) in one dev/test container, each with its own named volume "
            "(reqalm-pg, reqalm-openbao) plus reqalm-secrets for the generated unseal key and root token. Its healthcheck passes only when Postgres accepts connections and OpenBao is initialized and unsealed. "
            "Acceptance: first start initializes both within seconds; restarting the container unseals OpenBao from the stored key and keeps data; production is documented as separate Postgres and OpenBao units."
        ),
        satisfies=["ARCH-DEPLOY-PERIPHERALS", "ARCH-DEVENV-KEYS"],
        security=("SC-12", "SC-12 dev key material isolated in its own volume; never committed. Verified 2026-10-07: fresh start healthy; docker compose restart → unsealed and healthy, data kept. Production split (separate units) is a deploy concern not exercised here."),
        artifacts=[("other", "docker/peripherals/entrypoint.sh"), ("other", "docker/peripherals/healthcheck.sh"), ("other", "docker/peripherals/openbao.hcl")],
    ),
    dict(
        uid="CAP-DEVENV-COMPOSE", parent="SEC-DEVENV",
        title="Clone-to-running Compose: full-container and hybrid modes",
        statement=(
            "docker-compose.yml defines the default 2-container stack (app + peripherals) from the one Dockerfile, with .env.example holding only safe dev defaults (empty OpenBao token, no dev password). "
            "Full-container: copy .env.example to .env and `docker compose up --build`. Hybrid: `docker compose up peripherals -d` then `pnpm dev:reqalm` (native tsx watch), which loads .env and takes the dev OpenBao token from the running peripherals container without writing it to disk. "
            "Acceptance: following the README from a clean clone yields a healthy app on :3000 with the seed loaded; `docker compose ps` shows exactly 2 containers; hybrid mode reaches /ready 200."
        ),
        satisfies=["ARCH-DEVENV-COMPOSE.1", "ARCH-DEVENV-MODES.1", "ARCH-DEVENV-CLONE", "ARCH-DEVENV-SECRETS", "FIX-ALLOW-DEVENV-MIN-CONTAINERS"],
        security=("CM-2", "CM-2 / IA-5: no secrets in the repo; Compose is the documented baseline. Verified 2026-10-07: " + EVIDENCE_SMOKE + "; exactly 2 containers; hybrid mode /health, /ready, seed summary OK. Optional hsm-test Compose profile not yet wired."),
        artifacts=[("other", "docker-compose.yml"), ("other", ".env.example"), ("other", "scripts/dev-reqalm.mjs"), ("other", "README.md")],
    ),
    dict(
        uid="CAP-HEALTH-LIVENESS", parent="SEC-AUDIT",
        title="/health liveness probe with version",
        statement=(
            "GET /health is liveness only: it returns 200 with status ok, the app version and mode whenever the process can serve HTTP, and never touches Postgres, OpenBao or client data. "
            "Acceptance: /health stays 200 while dependencies are down (OpenBao sealed, Postgres stopped) so orchestrators do not restart a healthy process for a dependency outage."
        ),
        satisfies=["M04"],
        security=("SI-4", "No client data in the probe (M04). Verified 2026-10-07: /health 200 throughout the OpenBao-sealed and Postgres-stopped fault tests."),
        artifacts=[("other", "apps/reqalm/src/http/server.ts"), ("openapi", "apps/reqalm/openapi/openapi.yaml")],
    ),
    dict(
        uid="CAP-READY-PROBES", parent="SEC-AUDIT",
        title="/ready live peripheral and per-role checks (cached, time-boxed)",
        statement=(
            "GET /ready live-probes Postgres (SELECT 1), pending migrations, OpenBao (initialized, unsealed, Transit encrypt/decrypt round-trip on reqalm-kek) and each enabled role, "
            "caching results for REQALM_READY_CACHE_MS (2 s) and bounding each probe by REQALM_READY_PROBE_TIMEOUT_MS (3 s). It returns 503 with the failing check named and recovers without a restart. "
            "Acceptance: sealing OpenBao gives 503 with openbao failing; stopping Postgres gives 503 with database failing; both return to 200 after recovery; the app container is not restarted."
        ),
        satisfies=["ARCH-DEVENV-HEALTH", "M04", "ARCH-KEY-FAILCLOSED"],
        security=("SI-4", "Readiness gates traffic on live dependencies (ARCH-DEVENV-HEALTH). Verified 2026-10-07: OpenBao seal → 503 openbao 'sealed', unseal → 200; Postgres stop → 503 database ECONNREFUSED, recovery → 200; app restart count 0; unit tests for cache, database (incl. hung-DB timeout), migrations, openbao, roles. Fail-closed for key operations is R1."),
        artifacts=[("other", "apps/reqalm/src/readiness/report.ts"), ("other", "apps/reqalm/src/readiness/cache.ts"), ("other", "apps/reqalm/src/readiness/checks/openbao.ts")],
    ),
    dict(
        uid="CAP-DEVENV-STARTUP-BACKOFF", parent="SEC-DEVENV",
        title="Startup backoff waiting for Postgres and OpenBao",
        statement=(
            "Before migrating or serving, the app waits for Postgres and a usable OpenBao with exponential backoff (1 s start, x1.5, capped at 15 s, up to REQALM_STARTUP_MAX_WAIT_MS = 120 s), "
            "then fails with a clear timeout. The pg pool survives server-side disconnects (idle-client errors are logged, not fatal). A dev-marked OpenBao in production is not retried; it goes straight to the self-check refusal. "
            "Acceptance: `docker compose restart` brings the stack back healthy with zero app container restarts, even while OpenBao is still sealed."
        ),
        satisfies=["ARCH-DEVENV-HEALTH"],
        security=("CP-10", "Recovery without crash-loops. Verified 2026-10-07: docker compose restart → app logged 'waiting for OpenBao: sealed' then healthy, RestartCount 0; unit tests for timeout and the production no-wait path."),
        artifacts=[("other", "apps/reqalm/src/startup/wait-for-peripherals.ts"), ("other", "apps/reqalm/src/db/pool.ts")],
    ),
    dict(
        uid="CAP-PROD-SELFCHECK", parent="SEC-DEVENV",
        title="Production startup self-check refuses dev keys and dev accounts",
        statement=(
            "With REQALM_MODE=production the app refuses to start, with one explicit error listing every violation, when seeded dev local accounts exist, REQALM_SEED_ON_START or REQALM_DEV_ACCOUNT_PASSWORD is set, "
            "or OpenBao is dev-marked (dev address, REQALM_OPENBAO_DEV_MARKED, or the reqalm_dev marker on the Transit mount). The dev seed loader also exits non-zero in production. "
            "Acceptance: production mode against the dev stack exits 1 within about a second naming the dev accounts and dev OpenBao; no keys are unwrapped."
        ),
        satisfies=["ARCH-DEVENV-IDENTITY.1", "ARCH-DEVENV-KEYS", "FIX-DENY-DEV-KEK-IN-PROD", "FIX-DENY-DEVENV-PROD-LOGIN.1"],
        security=("CM-6", "CM-6 / IA-5: no default credentials in production. Verified 2026-10-07: docker compose run with REQALM_MODE=production → 'Startup self-check failed' (seeded dev accounts; dev-marked OpenBao / Transit mount), exit 1 in ~1 s; `REQALM_MODE=production pnpm reqalm:seed` refused. Dev-account login denial (FIX-DENY-DEVENV-PROD-LOGIN.1 (a)) needs the R1 internal AS."),
        artifacts=[("other", "apps/reqalm/src/startup/self-check.ts"), ("other", "apps/reqalm/src/seed/load-dogfood.ts")],
    ),
    dict(
        uid="CAP-DEVENV-OPENBAO-BOOTSTRAP", parent="SEC-DEVENV",
        title="Dev OpenBao Transit KEK bootstrap and round-trip",
        statement=(
            "On first start the peripherals container initializes OpenBao (1 key share, dev-only), stores the unseal key and root token in the reqalm-secrets volume, enables Transit with a reqalm_dev=true mount description, "
            "and creates the non-exportable aes256-gcm96 KEK reqalm-kek; later starts unseal from the stored key. The app proves the KEK works with a Transit encrypt/decrypt round-trip in /ready. "
            "Acceptance: fresh volumes initialize in seconds; /ready reports openbao ok only after a successful round-trip; restarts keep the KEK."
        ),
        satisfies=["ARCH-DEVENV-KEYS", "ARCH-KEY-PROVIDER"],
        security=("SC-12", "SC-12 / SC-28: dev KEK is dev-marked and refused in production. Verified 2026-10-07: init log 'dev-marked Transit mount, KEK reqalm-kek'; /ready openbao ok via round-trip; seal/unseal and restart tests. The pluggable KeyProvider API for app data (wrap/unwrap DEKs) is R1."),
        artifacts=[("other", "docker/peripherals/openbao-init.sh"), ("other", "docker/peripherals/wait-and-init-openbao.sh"), ("other", "apps/reqalm/src/key/openbao.ts")],
    ),
    dict(
        uid="CAP-DEVENV-MIGRATE-SEED", parent="SEC-DEVENV",
        title="Idempotent DB migrations and dogfood seed load",
        statement=(
            "SQL migrations (schema_migrations ledger, one transaction) run at startup and via `pnpm reqalm:migrate`; the dogfood seed (docs/design/seed/dogfood.yaml) loads on first start (REQALM_SEED_ON_START) and via `pnpm reqalm:seed` "
            "using insert-if-absent upserts, including releases and their delivers junction. Dev local accounts get a password from .env or one generated and printed once; no default credential is committed. "
            "Acceptance: re-running migrate and seed inserts zero rows and leaves counts unchanged; seed is refused in production."
        ),
        satisfies=["ARCH-DEVENV-SEED", "FIX-ALLOW-DEVENV-SEED-IDEMPOTENT"],
        security=("CM-2", "Idempotent fixture load (FIX-ALLOW-DEVENV-SEED-IDEMPOTENT). Verified 2026-10-07: devenv smoke re-runs migrate + seed twice → 'Migrations up to date', inserted all 0, unchanged=true."),
        artifacts=[("other", "apps/reqalm/src/db/migrations/001_foundation.sql"), ("other", "apps/reqalm/src/db/migrate.ts"), ("other", "apps/reqalm/src/seed/load-dogfood.ts")],
    ),
    dict(
        uid="CAP-API-DOCS-SEED-SUMMARY", parent="SEC-API",
        title="OpenAPI docs (/docs) and seed summary endpoint",
        statement=(
            "The API role serves its static OpenAPI 3.1 spec (apps/reqalm/openapi/openapi.yaml) through Swagger UI at /docs (JSON at /docs/json) and exposes GET /api/v1/seed/summary with aggregate seed counts "
            "(identities, grants, requirement lines and versions, capabilities, releases) and a sample identity, without client content. "
            "Acceptance: /docs and /docs/json return 200; the summary reflects the loaded dogfood seed and is unchanged after a seed re-run."
        ),
        satisfies=["ARCH-API", "ARCH-DEVENV-CLONE"],
        security=("SA-5", "SA-5 system documentation served from the schema-first spec. Verified 2026-10-07: /docs 200, /docs/json 200, /api/v1/seed/summary 200 with seed counts (smoke asserts it)."),
        artifacts=[("openapi", "apps/reqalm/openapi/openapi.yaml"), ("other", "apps/reqalm/src/http/server.ts")],
    ),
    dict(
        uid="CAP-DEVENV-SMOKE", parent="SEC-DEVENV",
        title="Local devenv smoke harness; CI smoke is manual-only",
        statement=(
            "`pnpm devenv:smoke` is the primary dev-environment check: `docker compose up --build -d --wait`, /health, /ready and seed summary, migrate + seed re-run twice with no new rows, exactly 2 healthy containers, "
            "and production-mode refusal of the dev seed loader, dev accounts and dev OpenBao. Any failing command's stdout/stderr is printed, followed by `docker compose ps -a` and recent logs. "
            "The GitHub workflow runs only on workflow_dispatch to save Actions minutes. Acceptance: the smoke passes from a clean clone and a failure is diagnosable from its output alone."
        ),
        satisfies=["FIX-ALLOW-DEVENV-SMOKE", "FIX-ALLOW-DEVENV-SEED-IDEMPOTENT", "FIX-ALLOW-DEVENV-MIN-CONTAINERS"],
        security=("SA-11", "SA-11 developer testing. Verified 2026-10-07: " + EVIDENCE_SMOKE + " (exit 0); forced failure (bad COMPOSE_FILE) printed the command stderr plus compose ps/logs."),
        artifacts=[("other", "scripts/devenv-smoke.mjs"), ("other", ".github/workflows/devenv-smoke.yml")],
    ),
]

# Requirement versions PR #12 fully meets → move from R1 to the PR #12 release.
PR12_MOVED_FROM_R1 = [
    "ARCH-DEVENV-MODES.1", "ARCH-DEVENV-PARITY.1", "ARCH-DEVENV-KEYS", "ARCH-DEVENV-CLONE",
    "ARCH-DEVENV-SEED", "ARCH-DEVENV-SECRETS", "ARCH-DEVENV-HEALTH", "M04",
]
# Fixture beds PR #12 fully exercises (were in no release).
PR12_FIXTURES = ["FIX-ALLOW-DEVENV-SMOKE", "FIX-ALLOW-DEVENV-SEED-IDEMPOTENT"]

# --------------------------------------------------------------------------------------------
# Next PR (UI frame + internal auth) — planned capabilities (status draft)
# --------------------------------------------------------------------------------------------
PLANNED = [
    dict(
        uid="CAP-UI-FRAME", parent="SEC-UI",
        title="UI frame: app shell, layout, guarded routes",
        statement=(
            "Planned capability: the Web UI frame served by the web role: App providers (session, Client Scoped View), layout and navigation, and route guards that send unauthenticated users to sign-in "
            "and project pages without a server-bound scope to scope selection, instead of rendering empty shells. "
            "Acceptance (planned): protected routes never render data without a valid internal-AS session; guard decisions match server authorization."
        ),
        satisfies=["ARCH-UI", "ARCH-UI-GUARD"],
        security=("AC-3", "Planned. Verify with guard redirect tests and an unauthenticated crawl of protected routes."),
        artifacts=[("other", "../c4/sequences/A01-sign-in-sso.puml"), ("other", "../c4/sequences/A03-select-client-scoped-view.puml")],
    ),
    dict(
        uid="CAP-OAUTH-AS", parent="SEC-IA",
        title="Internal OAuth 2.1 authorization server",
        statement=(
            "Planned capability: ReqALM's internal OAuth 2.1 AS in the API role, the single token issuer for Web UI, API and MCP: authorization code + PKCE S256 only, RFC 8414 AS metadata and RFC 9728 protected-resource metadata, "
            "RFC 8707 resource indicators with audience-bound tokens, refresh-token rotation with reuse detection, revocation with session-linked teardown, and pre-registered clients (CIMD/DCR policy-gated). "
            "Acceptance (planned): the AS01 MCP authorize flow and the FIX-DENY-PKCE-PLAIN / wrong-audience / refresh-reuse / revoked-token beds."
        ),
        satisfies=["ARCH-AUTH-AS", "ARCH-AUTH-PKCE", "ARCH-AUTH-METADATA", "ARCH-AUTH-AUDIENCE", "ARCH-AUTH-REFRESH",
                   "ARCH-AUTH-REVOKE", "ARCH-AUTH-CLIENTREG", "ARCH-AUTH-MCP-REQUIRED", "ARCH-AUTH-PROFILE"],
        security=("IA-2", "Planned. REQALM-SEC-OAUTH; IA-2 / IA-5 / SC-23. Verify with FIX-ALLOW-MCP-OAUTH-PKCE and the FIX-DENY-* OAuth beds."),
        artifacts=[("other", "../c4/sequences/AS01-mcp-oauth-authorize.puml"), ("other", "../auth/mcp-upstream-identity.md")],
    ),
    dict(
        uid="CAP-CRED-STORE", parent="SEC-SEC",
        title="Credential store: hashes, lockout, MFA, sessions, step-up",
        statement=(
            "Planned capability: the local-account credential store behind the AS: Argon2id (PBKDF2 in FIPS mode) salted one-way hashes with configurable parameters, password policy presets, throttling and lockout, "
            "MFA required for privileged roles, server-side tokens and client secrets stored hashed, session management (idle/absolute timeout, fixation protection, secure cookies) and step-up re-authentication for sensitive actions. "
            "Acceptance (planned): AS02 local login with lockout and MFA; FIX-DENY-LOCKOUT, FIX-DENY-PRIV-NO-MFA, FIX-DENY-SESSION-IDLE, FIX-DENY-STEPUP-STALE-AUTH, FIX-ALLOW-CRED-HASH-ONLY."
        ),
        satisfies=["ARCH-AUTH-LOCAL.1", "ARCH-CRED", "ARCH-CRED-HASH", "ARCH-CRED-POLICY", "ARCH-CRED-LOCKOUT", "ARCH-CRED-MFA",
                   "ARCH-CRED-TOKENS", "ARCH-CRED-SESSION", "ARCH-CRED-REAUTH"],
        security=("IA-5", "Planned. REQALM-SEC-CRED; IA-5 / AC-7 / AC-12. Verify with the AS02 sequence and the credential FIX beds."),
        artifacts=[("other", "../c4/sequences/AS02-local-login-lockout-mfa.puml")],
    ),
    dict(
        uid="CAP-KEY-ENVELOPE", parent="SEC-SEC",
        title="KeyProvider envelope encryption and JWKS signing-key rotation",
        statement=(
            "Planned capability: the app-side KeyProvider over OpenBao Transit: wrap/unwrap and re-wrap DEKs for sensitive fields and secrets, non-exportable token signing keys with kid and a JWKS endpoint, "
            "rotation with an overlap window, key lifecycle operations, and fail-closed behavior in production when the KEK is unreachable or sealed. Builds on the dev Transit bootstrap delivered in PR #12. "
            "Acceptance (planned): FIX-JWKS-ROTATION-OVERLAP, FIX-ALLOW-KEK-REWRAP-ONLINE, FIX-DENY-KEK-UNREACHABLE-PROD."
        ),
        satisfies=["ARCH-KEY", "ARCH-KEY-PROVIDER", "ARCH-KEY-SCOPE", "ARCH-KEY-JWKS", "ARCH-KEY-LIFECYCLE", "ARCH-KEY-FAILCLOSED"],
        security=("SC-12", "Planned. REQALM-SEC-KEYS; SC-12 / SC-13 / SC-28(3). Verify with the KEK / JWKS FIX beds."),
        artifacts=[("other", "../c4/sequences/KS01-kek-rotate-dek-rewrap.puml")],
    ),
    dict(
        uid="CAP-AUTH-AUDIT", parent="SEC-AUDIT",
        title="Authentication audit events",
        statement=(
            "Planned capability: every authentication event (login success/failure, lockout/unlock, MFA, step-up, token issue/refresh/revoke, client registration, key operations) is written through the AuditLog pattern "
            "with subject, client_id, source IP, user agent, outcome and timestamp, and exported via OTEL. Audit reads and sinks reuse CAP-AUDIT. "
            "Acceptance (planned): each auth FIX bed asserts its audit row."
        ),
        satisfies=["ARCH-CRED-AUDIT"],
        uses=["CAP-AUDIT"],
        security=("AU-2", "Planned. AU-2 / AU-3 / AU-12. Verify via audit assertions in the auth FIX beds."),
        artifacts=[],
    ),
]
# Existing capability reused in the next release (already Satisfies ARCH-API-RBAC).
R1_REUSED_CAPS = ["CAP-RBAC"]

PR11_URL = "https://github.com/danrabydev/sdoc-intake/pull/11"
PR11_SHA = "50877ca1e717a46ce7f2bfbefc563dbd90c929e5"
PR12_URL = "https://github.com/danrabydev/sdoc-intake/pull/12"


def cap_version(spec, *, status, verification_outcome, iteration, grooming):
    v = cm(uid=spec["uid"], base_uid=spec["uid"], version_n=0, status=status, statement=spec["statement"],
           priority=10, iteration=iteration,
           security={"catalog_ref": spec["security"][0], "verification_note": spec["security"][1]},
           statement_hash=statement_hash(spec["statement"]), grooming_state=grooming)
    if verification_outcome:
        v["verification_outcome"] = verification_outcome
    return v


def approval(spec, note):
    return cm(id=f"ar-{spec['uid'].lower()}", subject_kind="CapabilityLine", base_uid=spec["uid"], status="unapproved",
              by=None, at=None, notes=note, approved_version_uid=None, approved_statement_hash=None)


def main() -> int:
    data = yaml.load(DOGFOOD)
    lines, versions, edges = data["requirement_lines"], data["requirement_versions"], data["edges"]
    before = (len(lines), len(versions), len(edges))
    uids = {v["uid"] for v in versions}

    def add_caps(specs, *, status, outcome, iteration, grooming, approval_note):
        for s in specs:
            upsert(lines, "base_uid", cm(base_uid=s["uid"], project_id="reqalm", parent=s["parent"], kind="capability", title=s["title"]))
            upsert(versions, "uid", cap_version(s, status=status, verification_outcome=outcome, iteration=iteration, grooming=grooming))
            uids.add(s["uid"])
            for t in s["satisfies"]:
                assert t in uids, (s["uid"], t)
                ensure_edge(edges, cm(**{"from": s["uid"], "to": t, "kind": "satisfies"}))
            for t in s.get("uses", []):
                assert t in uids, (s["uid"], t)
                ensure_edge(edges, cm(**{"from": s["uid"], "to": t, "kind": "uses"}))
            ref = s["security"][0]
            if "-" in ref and not ref.startswith("REQALM-"):
                ensure_edge(edges, cm(**{"from": s["uid"], "to": ref, "kind": "conforms_to", "catalog_imprint_id": NIST}))
            arts = data["capability_artifacts"]
            for kind, path in s["artifacts"]:
                uri = path if path.startswith("../") else f"{REPO}/{path}"
                if not path.startswith("../"):
                    assert (SEED / uri).resolve().exists(), uri
                if not any(a.get("requirement_version_uid") == s["uid"] and a.get("uri") == uri for a in arts):
                    arts.append(cm(requirement_version_uid=s["uid"], kind=kind, uri=uri))
            upsert(data["approval_records"], "id", approval(s, approval_note))

    add_caps(DELIVERED, status="active", outcome="pass", iteration="iter-r0", grooming="detailed",
             approval_note="Delivered in PR #12 and verified locally; solution approval (ARCH-CAP-APPROVE) pending Dan at merge review.")
    add_caps(PLANNED, status="draft", outcome=None, iteration="iter-r1", grooming="detailed",
             approval_note="Planned for the next PR (UI frame + internal auth); approve as solution once built and verified.")

    rels = data["releases"]
    r1 = find(rels, "id", "rel-r1-foundation-shell-auth")
    assert r1 is not None
    moved = [u for u in PR12_MOVED_FROM_R1 if u in r1["delivers"]]
    r1["delivers"] = [u for u in r1["delivers"] if u not in PR12_MOVED_FROM_R1]
    for u in [c["uid"] for c in PLANNED] + R1_REUSED_CAPS:
        if u not in r1["delivers"]:
            r1["delivers"].append(u)
    r1["name"] = "R1-foundation-shell-auth — next PR: UI frame + internal auth"
    r1["notes"] = (
        "Next planned release after PR #12 (rel-pr12-devenv-foundation); PR not opened yet (one PR = one release). "
        "Scope: UI frame (CAP-UI-FRAME), internal OAuth 2.1 AS (CAP-OAUTH-AS), credential store (CAP-CRED-STORE), KeyProvider envelope encryption + JWKS (CAP-KEY-ENVELOPE), RBAC (CAP-RBAC), auth audit (CAP-AUTH-AUDIT). "
        "2026-10-07 split: ARCH-DEVENV-MODES.1, -PARITY.1, -KEYS, -CLONE, -SEED, -SECRETS, -HEALTH and M04 moved to rel-pr12-devenv-foundation (fully met there). "
        "ARCH-DEVENV-COMPOSE.1 (hsm-test profile, internal-AS sign-in), ARCH-DEVENV-IDENTITY.1 (dev sign-in via AS), ARCH-DEPLOY-MINIMAL (AS + real MCP role) and ARCH-DEPLOY-PERIPHERALS (prod split) stay here: PR #12 meets them only in part (see its Satisfies edges). "
        "Build sequencing only (ARCH-BUILD-FOUNDATION); no v1 scope cut. planned_on / cyber_gate pending Dan (open-questions)."
    )

    pr11 = cm(id="rel-pr11-planning-baseline", project_id="reqalm", name="PR #11 — planning baseline",
              planned_on="2026-10-07", shipped_on="2026-10-07", status="shipped", delivers=[], cyber_gate=False,
              notes=(f"One PR = one release. {PR11_URL} merged to main as {PR11_SHA} on 2026-10-07. "
                     "Planning/design baseline: design docs (C4, sequences, roles, user actions), the dogfood seed, and folded reviews from PRs #1-#5 and #7. "
                     "Documentation only: no runtime code, so it delivers no requirement or capability versions (no capabilities invented)."))
    pr12_delivers = list(PR12_MOVED_FROM_R1) + PR12_FIXTURES + [c["uid"] for c in DELIVERED]
    for u in pr12_delivers:
        assert u in uids, u
    pr12 = cm(id="rel-pr12-devenv-foundation", project_id="reqalm", name="PR #12 — devenv foundation",
              planned_on="2026-10-07", shipped_on=None, status="planned", delivers=pr12_delivers, cyber_gate=False,
              notes=(f"One PR = one release. {PR12_URL} (branch cursor/reqalm-devenv-foundation-b0e0). About to merge: flip to shipped with shipped_on + merge SHA at merge. "
                     "pnpm monorepo, one Dockerfile, 2-container Compose (app + peripherals: Postgres + OpenBao), app shell, /health liveness, /ready live peripheral checks, startup backoff, "
                     "production self-check refusing dev keys/accounts, `pnpm devenv:smoke` (CI manual-only). Requirement versions listed here moved from rel-r1-foundation-shell-auth (fully met). "
                     "cyber_gate=false: developer tooling, no client data."))
    for rel, after in ((pr11, "rel-r0-sequences"), (pr12, "rel-pr11-planning-baseline")):
        if find(rels, "id", rel["id"]) is None:
            idx = next(i for i, r in enumerate(rels) if r["id"] == after) + 1
            rels.insert(idx, rel)
        else:
            upsert(rels, "id", rel)

    yaml.dump(data, DOGFOOD)
    print(f"patched: lines {before[0]}->{len(lines)} versions {before[1]}->{len(versions)} edges {before[2]}->{len(edges)}; "
          f"moved R1->PR12: {moved or '(already moved)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
