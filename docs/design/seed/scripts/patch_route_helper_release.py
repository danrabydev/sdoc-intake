#!/usr/bin/env python3
"""Ship rel-r1-otel-tracing and add rel-r1-route-helper (this PR).

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
REPO = "../../.."
MERGE_OTEL_TRACING = "aa4dc835f68c4b80a0b34f3c0a06dc73768e1109"
# Merged 2026-10-07 21:07 EDT (Dan's time zone; 2026-10-08 01:07 UTC).
SHIPPED_OTEL_TRACING = "2026-10-07"

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
    for x in seq or []:
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


OTEL_CAPS = [
    "CAP-OTEL-SDK-BOOTSTRAP",
    "CAP-OTEL-W3C-CONTEXT",
    "CAP-OTEL-OPERATION-SPANS",
    "CAP-OTEL-KEY-DEP",
    "CAP-OTEL-AUDIT-TRACE",
    "CAP-OTEL-EXPORT",
    "CAP-OTEL-TEST-HARNESS",
]

ROUTE_HELPER_CAPS = [
    (
        "CAP-SVC-OPERATION-ROUTE",
        "defineOperationRoute — single pipeline for /api/v1 business routes",
        "Business routes under /api/ register only via defineOperationRoute: build RequestContext, "
        "validate params/query/body once in parseInput (Zod; validation → ServiceResult), runOperation, "
        "envelope or Problem Details (application/problem+json), including Fastify pre-handler errors and "
        "unexpected throws (500 without the error message). reqalmSecurity is derived from the operation; "
        "registration throws unless the operation declares a permission bound to a project "
        "(projectScoped + projectIdFromInput) or authenticatedOnly.",
        [("ARCH-API-LAYERS", "satisfies"), ("ARCH-API-RBAC", "satisfies"), ("CAP-SVC-OPERATION-EXECUTOR", "uses")],
        [
            f"{REPO}/apps/reqalm/src/http/define-operation-route.ts",
            f"{REPO}/apps/reqalm/src/modules/projects/routes.ts",
        ],
    ),
    (
        "CAP-SVC-BUSINESS-ROUTE-AUDIT",
        "Fail-closed business route registration test",
        "route-security.test.ts rejects /api/ routes not registered via defineOperationRoute (exact METHOD + path "
        "allowlist for auth/OAuth-shaped and dev seed routes), permission markers on any hand-registered route, "
        "and reqalmSecurity markers that disagree with the operation.",
        [("CAP-SVC-ROUTE-REGISTRY", "satisfies"), ("ARCH-API-RBAC", "satisfies")],
        [
            f"{REPO}/apps/reqalm/src/http/route-security.ts",
            f"{REPO}/apps/reqalm/src/http/route-security.test.ts",
        ],
    ),
    (
        "CAP-SVC-PROBLEM-JSON",
        "Problem Details content type on service errors",
        "Error responses from operation routes use Content-Type application/problem+json, as documented in "
        "the static OpenAPI spec.",
        [("CAP-SVC-RESULT-ENVELOPE", "satisfies")],
        [f"{REPO}/apps/reqalm/src/core/http-envelope.ts", f"{REPO}/apps/reqalm/openapi/openapi.yaml"],
    ),
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    rel_otel = find(data.get("releases"), "id", "rel-r1-otel-tracing")
    if rel_otel:
        rel_otel["status"] = "shipped"
        rel_otel["shipped_on"] = SHIPPED_OTEL_TRACING
        rel_otel["notes"] = (
            f"One PR = one release. https://github.com/danrabydev/sdoc-intake/pull/18 merged to main as "
            f"{MERGE_OTEL_TRACING} on {SHIPPED_OTEL_TRACING}. Verified locally: tests x3, typecheck, build, "
            "dev-stack upgrade + smoke, Jaeger span tree. Traces only (not ARCH-OTEL audit-event export)."
        )
    for cap in OTEL_CAPS:
        ver = find(data.get("requirement_versions"), "uid", cap)
        if ver and ver.get("status") == "draft":
            ver["status"] = "active"
            ver["verification_outcome"] = "pass"

    deliver_uids = []
    edges = data.setdefault("edges", [])
    arts = data.setdefault("capability_artifacts", [])

    for cap_uid, title, stmt, satisfies, artifact_paths in ROUTE_HELPER_CAPS:
        base = cap_uid.replace("CAP-", "").lower().replace("_", "-")
        upsert(
            data.setdefault("requirement_lines", []),
            "base_uid",
            cm(base_uid=cap_uid, project_id="reqalm", parent="SEC-API", kind="capability", title=title),
        )
        upsert(
            data.setdefault("requirement_versions", []),
            "uid",
            cm(
                uid=cap_uid,
                base_uid=cap_uid,
                version_n=0,
                status="draft",
                statement=stmt,
                priority=10,
                iteration="iter-r1",
                security={"catalog_ref": "CM-2", "verification_note": "Planned until operation-route PR merges."},
                statement_hash=statement_hash(stmt),
                grooming_state="detailed",
            ),
        )
        upsert(
            data.setdefault("approval_records", []),
            "id",
            cm(
                id=f"ar-{base}",
                subject_kind="CapabilityLine",
                base_uid=cap_uid,
                status="unapproved",
                by=None,
                at=None,
                notes="Planned for operation-route helper PR; approve once merged and verified.",
                approved_version_uid=None,
                approved_statement_hash=None,
            ),
        )
        for to, kind in satisfies:
            ensure_edge(edges, {"from": cap_uid, "to": to, "kind": kind})
        for uri in artifact_paths:
            if not any(a.get("requirement_version_uid") == cap_uid and a.get("uri") == uri for a in arts):
                arts.append({"requirement_version_uid": cap_uid, "kind": "other", "uri": uri})
        deliver_uids.append(cap_uid)

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id="rel-r1-route-helper",
            project_id="reqalm",
            name="R1 — defineOperationRoute (single business-route pipeline)",
            planned_on="2026-10-07",
            shipped_on=None,
            status="planned",
            delivers=deliver_uids,
            cyber_gate=False,
            notes=(
                "One PR = one release. Unifies /api/ business route registration, strengthens fail-closed "
                "route audit, Problem Details content type. Planned until merged; the next PR marks it shipped "
                "at the merge sha. Does not replace auth/OAuth hand routes or claim OpenAPI generation from Zod."
            ),
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)

    print("Patched dogfood.yaml: shipped rel-r1-otel-tracing, added rel-r1-route-helper")


if __name__ == "__main__":
    main()
