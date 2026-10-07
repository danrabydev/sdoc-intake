#!/usr/bin/env python3
"""Encode ReqALM Docker Compose developer-environment expectations (ARCH-DEVENV-*).

Locked ask 2026-10-07: Compose entry point; hybrid + full-container modes;
clone-to-running; migrations + dogfood seed; local identity stub (prod-disabled);
no committed secrets; image parity; health/readiness.

Compose services derived from C4 L2: Postgres, API, Web UI, Sync worker
(+ local identity stub for non-prod). Does not invent MCP/StrictDoc/OTEL compose
services — those are open questions or external.

Idempotent: safe to re-run. Does NOT git commit.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"

NIST = "nist-800-53@rev5-dogfood-20261006"
STIG = "asd-stig@v6r4"

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 1200
yaml.indent(mapping=2, sequence=2, offset=0)


def cm(**kwargs):
    m = CommentedMap()
    for k, v in kwargs.items():
        m[k] = v
    return m


def line(base_uid, parent, kind, title, project_id="reqalm"):
    return cm(
        base_uid=base_uid,
        project_id=project_id,
        parent=parent,
        kind=kind,
        title=title,
    )


def ver(
    uid,
    base_uid,
    statement,
    *,
    status="active",
    priority=20,
    iteration="iter-r0",
    rbac_op=None,
    security=None,
    version_n=0,
    **extra,
):
    m = cm(
        uid=uid,
        base_uid=base_uid,
        version_n=version_n,
        status=status,
        statement=statement,
    )
    if priority is not None:
        m["priority"] = priority
    if iteration is not None:
        m["iteration"] = iteration
    if rbac_op:
        m["rbac_op"] = rbac_op
    if security is not None:
        m["security"] = security
    for k, v in extra.items():
        m[k] = v
    return m


def has_line(lines, base_uid):
    return any(ln.get("base_uid") == base_uid for ln in lines)


def has_ver(versions, uid):
    return any(v.get("uid") == uid for v in versions)


def ensure_edge(edges, edge):
    key = (edge.get("from"), edge.get("to"), edge.get("kind"), edge.get("catalog_imprint_id"))
    for e in edges:
        ek = (e.get("from"), e.get("to"), e.get("kind"), e.get("catalog_imprint_id"))
        if ek == key:
            return
    edges.append(edge)


def add_conforms(edges, from_uid, item_uid, imprint=NIST):
    ensure_edge(
        edges,
        cm(
            **{
                "from": from_uid,
                "to": item_uid,
                "kind": "conforms_to",
                "catalog_imprint_id": imprint,
            }
        ),
    )


def add_rel(edges, from_uid, to_uid, kind):
    ensure_edge(edges, cm(**{"from": from_uid, "to": to_uid, "kind": kind}))


# --- requirement lines ---
NEW_LINES = [
    line("SEC-DEVENV", None, "section", "Developer environment"),
    line(
        "ARCH-DEVENV-COMPOSE",
        "SEC-DEVENV",
        "requirement",
        "Compose is the single supported dev entry point",
    ),
    line(
        "ARCH-DEVENV-MODES",
        "ARCH-DEVENV-COMPOSE",
        "requirement",
        "Hybrid and full-container run modes",
    ),
    line(
        "ARCH-DEVENV-CLONE",
        "ARCH-DEVENV-COMPOSE",
        "requirement",
        "Clone-to-running documented short path",
    ),
    line(
        "ARCH-DEVENV-SEED",
        "ARCH-DEVENV-COMPOSE",
        "requirement",
        "Migrations and dogfood seed on first start (idempotent)",
    ),
    line(
        "ARCH-DEVENV-IDENTITY",
        "SEC-DEVENV",
        "requirement",
        "Local identity stub for non-prod; disabled in production builds",
    ),
    line(
        "ARCH-DEVENV-SECRETS",
        "SEC-DEVENV",
        "requirement",
        "No secrets committed; .env.example; prod config separate",
    ),
    line(
        "ARCH-DEVENV-PARITY",
        "ARCH-DEVENV-COMPOSE",
        "requirement",
        "Full-container Dockerfile matches deployment image",
    ),
    line(
        "ARCH-DEVENV-HEALTH",
        "ARCH-DEVENV-COMPOSE",
        "requirement",
        "Compose service health checks and readiness",
    ),
    line(
        "FIX-ALLOW-DEVENV-SMOKE",
        "SEC-FIX",
        "requirement",
        "Fresh clone reaches healthy instance and seed loads",
    ),
    line(
        "FIX-DENY-DEVENV-PROD-LOGIN",
        "SEC-FIX",
        "requirement",
        "Dev identity path denied or absent in production builds",
    ),
    line(
        "FIX-ALLOW-DEVENV-SEED-IDEMPOTENT",
        "SEC-FIX",
        "requirement",
        "Re-run migrations and dogfood seed is idempotent",
    ),
]

SEC_CM6 = {
    "catalog_ref": "CM-6",
    "verification_note": "CM-6 configuration settings via Compose + .env; no secrets in source.",
}
SEC_CM2 = {
    "catalog_ref": "CM-2",
    "verification_note": "CM-2 baseline: Compose + Dockerfile define the supported local/deploy baseline.",
}
SEC_CM7 = {
    "catalog_ref": "CM-7",
    "verification_note": "CM-7 least functionality: local identity stub is non-essential and disabled in production.",
}
SEC_IA5 = {
    "catalog_ref": "IA-5",
    "verification_note": "IA-5 authenticator protection: no secrets/authenticators committed to source.",
}
SEC_AC3 = {
    "catalog_ref": "AC-3",
    "verification_note": "AC-3: production builds must not accept the local-only identity path.",
}
SEC_FIX = {
    "catalog_ref": "CM-6",
    "verification_note": "FIXTURE / TEST BED for developer environment smoke and prod-disable.",
}

STMT_SEC = (
    "Developer environment for ReqALM: Docker Compose is the single supported "
    "local stand-up path. Compose services cover the C4 L2 containers (Postgres, "
    "API, Web UI, Sync worker) plus a non-prod local identity stub. Hybrid "
    "(deps in Compose, app native with hot reload) and full-container modes are "
    "both supported. Clone-to-running must be short and documented; migrations "
    "and dogfood seed load automatically or with one command; secrets stay out "
    "of source; production builds disable local identity."
)

NEW_VERSIONS = [
    ver("SEC-DEVENV", "SEC-DEVENV", STMT_SEC, priority=None, iteration=None, security=None),
    ver(
        "ARCH-DEVENV-COMPOSE",
        "ARCH-DEVENV-COMPOSE",
        "Docker Compose is the single supported developer entry point for ReqALM. "
        "The repository includes the Compose file(s) and an env template. Compose "
        "services derive from the C4 L2 containers: Postgres (database), API "
        "(Node/TypeScript OpenAPI), Web UI (React), and Sync worker (DevOps "
        "work-item sync), plus a non-prod local identity stub for A01-aligned "
        "sign-in. Operators do not invent ad-hoc local wiring outside Compose "
        "for first-time stand-up.",
        priority=15,
        security=deepcopy(SEC_CM2),
        grooming_state="detailed",
    ),
    ver(
        "ARCH-DEVENV-MODES",
        "ARCH-DEVENV-MODES",
        "ReqALM supports two Compose-backed run modes: (1) hybrid — Compose "
        "provides dependencies (at least Postgres and the local identity stub); "
        "the API and/or Web UI run as native Node processes with hot reload "
        "against those deps; (2) full-container — API, Web UI, Sync worker, and "
        "dependencies all run as Compose services from built images. Both modes "
        "share the same Compose project and env contract so developers can switch "
        "without re-wiring.",
        priority=15,
        security=deepcopy(SEC_CM2),
        grooming_state="detailed",
    ),
    ver(
        "ARCH-DEVENV-CLONE",
        "ARCH-DEVENV-CLONE",
        "A new developer clones the repo and reaches a working instance via a "
        "documented short sequence (for example: copy env template → compose up "
        "→ open the published URL) without manual database schema setup. Target: "
        "a healthy UI/API against a migrated database with dogfood fixtures "
        "available for local exercise. Documentation lives in-repo beside the "
        "Compose files.",
        priority=10,
        security=deepcopy(SEC_CM2),
        grooming_state="detailed",
    ),
    ver(
        "ARCH-DEVENV-SEED",
        "ARCH-DEVENV-SEED",
        "On first start (or via one documented command), database migrations and "
        "the dogfood seed load run so a fresh instance can act as fixture data "
        "and a test oracle. Re-running migrations and seed load is idempotent: "
        "repeat application does not duplicate rows or fail on already-applied "
        "schema. Seed load must not be required as a production deployment step.",
        priority=15,
        security=deepcopy(SEC_CM6),
        grooming_state="detailed",
    ),
    ver(
        "ARCH-DEVENV-IDENTITY",
        "ARCH-DEVENV-IDENTITY",
        "Local development provides a way to sign in without the enterprise IdP "
        "(a local OIDC stub or equivalent dev-login path) so A01 session "
        "establishment, grants, and Scoped View can be exercised offline. The "
        "local identity path is clearly disabled or omitted in production "
        "builds and configurations (CM-7 / V-222518). Production continues to "
        "require enterprise SSO only (A01 / REQALM-SEC-SSO); no local password "
        "store is introduced for production. Which stub implementation is used "
        "is an open product choice until Dan locks it.",
        priority=10,
        rbac_op="auth:signin",
        security=deepcopy(SEC_CM7),
        grooming_state="detailed",
    ),
    ver(
        "ARCH-DEVENV-SECRETS",
        "ARCH-DEVENV-SECRETS",
        "No secrets (IdP client secrets, DB passwords, signing keys, API tokens) "
        "are committed to source control. The repo ships `.env.example` (or "
        "equivalent) with safe non-secret development defaults only. Production "
        "configuration is supplied separately (platform secrets / env injection) "
        "and is not the same file tree as the committed example. Aligns to CM-6 "
        "configuration settings and IA-5 authenticator protection.",
        priority=10,
        security=deepcopy(SEC_IA5),
        grooming_state="detailed",
    ),
    ver(
        "ARCH-DEVENV-PARITY",
        "ARCH-DEVENV-PARITY",
        "The container image used for full-container development is built from "
        "the same Dockerfile used for deployment (multi-stage builds are "
        "allowed). Dev/prod differences are configuration and Compose overrides "
        "(ports, env, volume mounts, hot-reload sidecars), not a divergent "
        "Dockerfile tree, so local container runs exercise the deployable image "
        "contract.",
        priority=20,
        security=deepcopy(SEC_CM2),
        grooming_state="detailed",
    ),
    ver(
        "ARCH-DEVENV-HEALTH",
        "ARCH-DEVENV-HEALTH",
        "Compose services define health checks and readiness so `compose up` "
        "(and dependents) report healthy only when dependencies are ready. "
        "API readiness aligns with M04 (health/version without leaking client "
        "data). Unhealthy deps must block or clearly fail dependent app start "
        "rather than silently serving a broken instance.",
        priority=15,
        rbac_op="ops:health",
        security=deepcopy(SEC_CM6),
        grooming_state="detailed",
    ),
    ver(
        "FIX-ALLOW-DEVENV-SMOKE",
        "FIX-ALLOW-DEVENV-SMOKE",
        "FIXTURE / TEST BED (not a product feature). From a clean clone of the "
        "repo, following the documented clone-to-running sequence yields: "
        "Compose services healthy, API health/version OK (M04), and dogfood "
        "seed loaded (seed identities/grants/requirement fixtures queryable). "
        "Pairs ARCH-DEVENV-CLONE / ARCH-DEVENV-SEED / ARCH-DEVENV-HEALTH.",
        priority=20,
        iteration="iter-r1",
        security=deepcopy(SEC_FIX),
    ),
    ver(
        "FIX-DENY-DEVENV-PROD-LOGIN",
        "FIX-DENY-DEVENV-PROD-LOGIN",
        "FIXTURE / TEST BED (not a product feature). With a production build "
        "or production configuration, attempting the local/dev identity path "
        "(OIDC stub or dev-login) is denied or the route/config is absent → "
        "expect unauthorized/forbidden (or missing endpoint). Enterprise SSO "
        "(A01) remains the only sign-in path. Pairs ARCH-DEVENV-IDENTITY and "
        "REQALM-SEC-SSO.",
        priority=15,
        iteration="iter-r1",
        rbac_op="auth:signin",
        security=deepcopy(SEC_AC3),
    ),
    ver(
        "FIX-ALLOW-DEVENV-SEED-IDEMPOTENT",
        "FIX-ALLOW-DEVENV-SEED-IDEMPOTENT",
        "FIXTURE / TEST BED (not a product feature). After a successful first "
        "migration + dogfood seed load, re-running the same migrate/seed "
        "command (or Compose first-start hook) succeeds without duplicate key "
        "errors and leaves fixture row counts unchanged. Pairs ARCH-DEVENV-SEED.",
        priority=25,
        iteration="iter-r1",
        security=deepcopy(SEC_FIX),
    ),
]


def main() -> int:
    data = yaml.load(DOGFOOD)
    lines = data["requirement_lines"]
    versions = data["requirement_versions"]
    edges = data["edges"]

    added_lines = 0
    for ln in NEW_LINES:
        if not has_line(lines, ln["base_uid"]):
            lines.append(ln)
            added_lines += 1

    added_vers = 0
    for v in NEW_VERSIONS:
        if not has_ver(versions, v["uid"]):
            versions.append(v)
            added_vers += 1
        else:
            # Refresh statement/security on re-run for known DEVENV UIDs
            for existing in versions:
                if existing.get("uid") == v["uid"]:
                    for k, val in v.items():
                        existing[k] = deepcopy(val) if isinstance(val, (dict, list)) else val
                    break

    # Relations among DEVENV reqs
    add_rel(edges, "ARCH-DEVENV-MODES", "ARCH-DEVENV-COMPOSE", "refines")
    add_rel(edges, "ARCH-DEVENV-CLONE", "ARCH-DEVENV-COMPOSE", "refines")
    add_rel(edges, "ARCH-DEVENV-SEED", "ARCH-DEVENV-COMPOSE", "refines")
    add_rel(edges, "ARCH-DEVENV-SEED", "ARCH-DEVENV-CLONE", "uses")
    add_rel(edges, "ARCH-DEVENV-PARITY", "ARCH-DEVENV-COMPOSE", "refines")
    add_rel(edges, "ARCH-DEVENV-PARITY", "ARCH-DEVENV-MODES", "uses")
    add_rel(edges, "ARCH-DEVENV-HEALTH", "ARCH-DEVENV-COMPOSE", "refines")
    add_rel(edges, "ARCH-DEVENV-HEALTH", "M04", "uses")
    add_rel(edges, "ARCH-DEVENV-IDENTITY", "A01", "refines")
    add_rel(edges, "ARCH-DEVENV-IDENTITY", "CAP-SSO", "uses")
    add_rel(edges, "ARCH-DEVENV-SECRETS", "ARCH-DEVENV-COMPOSE", "uses")
    add_rel(edges, "ARCH-DEVENV-CLONE", "ARCH-DEVENV-HEALTH", "uses")
    add_rel(edges, "ARCH-DEVENV-CLONE", "ARCH-DEVENV-SEED", "uses")
    add_rel(edges, "ARCH-DEVENV-CLONE", "ARCH-DEVENV-IDENTITY", "uses")

    # FIX beds
    add_rel(edges, "FIX-ALLOW-DEVENV-SMOKE", "ARCH-DEVENV-CLONE", "uses")
    add_rel(edges, "FIX-ALLOW-DEVENV-SMOKE", "ARCH-DEVENV-SEED", "uses")
    add_rel(edges, "FIX-ALLOW-DEVENV-SMOKE", "ARCH-DEVENV-HEALTH", "uses")
    add_rel(edges, "FIX-ALLOW-DEVENV-SMOKE", "M04", "uses")
    add_rel(edges, "FIX-DENY-DEVENV-PROD-LOGIN", "ARCH-DEVENV-IDENTITY", "uses")
    add_rel(edges, "FIX-DENY-DEVENV-PROD-LOGIN", "A01", "uses")
    add_rel(edges, "FIX-ALLOW-DEVENV-SEED-IDEMPOTENT", "ARCH-DEVENV-SEED", "uses")

    # ConformsTo — only clear mappings
    add_conforms(edges, "ARCH-DEVENV-COMPOSE", "CM-2")
    add_conforms(edges, "ARCH-DEVENV-MODES", "CM-2")
    add_conforms(edges, "ARCH-DEVENV-CLONE", "CM-2")
    add_conforms(edges, "ARCH-DEVENV-PARITY", "CM-2")
    add_conforms(edges, "ARCH-DEVENV-SEED", "CM-6")
    add_conforms(edges, "ARCH-DEVENV-HEALTH", "CM-6")
    add_conforms(edges, "ARCH-DEVENV-SECRETS", "CM-6")
    add_conforms(edges, "ARCH-DEVENV-SECRETS", "IA-5")
    add_conforms(edges, "ARCH-DEVENV-IDENTITY", "CM-7")
    add_conforms(edges, "ARCH-DEVENV-IDENTITY", "IA-2")  # A01-aligned identity path
    add_conforms(edges, "ARCH-DEVENV-IDENTITY", "V-222518", imprint=STIG)  # disable non-essential
    add_conforms(edges, "FIX-DENY-DEVENV-PROD-LOGIN", "CM-7")
    add_conforms(edges, "FIX-DENY-DEVENV-PROD-LOGIN", "V-222518", imprint=STIG)
    add_conforms(edges, "FIX-ALLOW-DEVENV-SMOKE", "CM-2")
    add_conforms(edges, "FIX-ALLOW-DEVENV-SEED-IDEMPOTENT", "CM-6")

    yaml.dump(data, DOGFOOD)
    print(
        f"patched {DOGFOOD}: added_lines={added_lines} refreshed/added_versions "
        f"(new={added_vers}) total_lines={len(lines)} total_versions={len(versions)} "
        f"total_edges={len(edges)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
