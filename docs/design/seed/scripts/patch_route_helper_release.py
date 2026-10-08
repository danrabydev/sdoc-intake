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
MERGE_OTEL_TRACING = "aa4dc8337df8825eddbc5e04cc698248cde539d4"

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
        "Business routes under /api/v1 register only via defineOperationRoute: build RequestContext, "
        "parse params/query/body to typed input (validation → ServiceResult), runOperation, envelope or "
        "RFC 7807 Problem Details (application/problem+json). reqalmSecurity is derived from the operation.",
        ["ARCH-API-LAYERS", "ARCH-API-RBAC", "CAP-SVC-OPERATION-EXECUTOR"],
        [
            f"{REPO}/apps/reqalm/src/http/define-operation-route.ts",
            f"{REPO}/apps/reqalm/src/modules/projects/routes.ts",
        ],
    ),
    (
        "CAP-SVC-BUSINESS-ROUTE-AUDIT",
        "Fail-closed business route registration test",
        "route-security.test.ts rejects /api/v1 business routes not registered via defineOperationRoute "
        "(auth/OAuth-shaped allowlist exempt) and rejects reqalmSecurity markers that disagree with the operation.",
        ["CAP-SVC-ROUTE-REGISTRY", "ARCH-API-RBAC"],
        [
            f"{REPO}/apps/reqalm/src/http/route-security.ts",
            f"{REPO}/apps/reqalm/src/http/route-security.test.ts",
        ],
    ),
    (
        "CAP-SVC-PROBLEM-JSON",
        "Problem Details content type on service errors",
        "mapServiceResultToHttp sets Content-Type application/problem+json for non-success ServiceResults.",
        ["CAP-SVC-RESULT-ENVELOPE"],
        [f"{REPO}/apps/reqalm/src/core/http-envelope.ts"],
    ),
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    rel_otel = find(data.get("releases"), "id", "rel-r1-otel-tracing")
    if rel_otel:
        rel_otel["status"] = "shipped"
        rel_otel["shipped_on"] = "2026-10-08"
        rel_otel["notes"] = (
            f"One PR = one release. https://github.com/danrabydev/sdoc-intake/pull/18 merged to main as "
            f"{MERGE_OTEL_TRACING} on 2026-10-08. Verified: in-process tests + typecheck + build."
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
        for to in satisfies:
            ensure_edge(edges, {"from": cap_uid, "to": to, "kind": "satisfies"})
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
            planned_on="2026-10-08",
            shipped_on=None,
            status="planned",
            delivers=deliver_uids,
            cyber_gate=False,
            notes=(
                "One PR = one release. Unifies /api/v1 business route registration, strengthens fail-closed "
                "route audit, Problem Details content type. Does not replace auth/OAuth hand routes or claim "
                "full OpenAPI codegen from Zod."
            ),
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)

    print("Patched dogfood.yaml: shipped rel-r1-otel-tracing, added rel-r1-route-helper")


if __name__ == "__main__":
    main()
