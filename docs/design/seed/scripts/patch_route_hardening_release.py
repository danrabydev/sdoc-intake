#!/usr/bin/env python3
"""Ship rel-r1-route-helper (PR #19) and add rel-r1-route-hardening (this PR).

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
# PR #19 merged 2026-10-08T03:01:22Z = 2026-10-07 23:01 America/New_York (dates are Dan's time zone).
SHIPPED_ROUTE_HELPER = "2026-10-07"
ROUTE_HELPER_MERGE_SHA = "ecbd68be93a2103be1a4cd9f5b2289a22f45357e"
PLANNED_HARDENING = "2026-10-07"

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


ROUTE_HELPER_CAPS = [
    "CAP-SVC-OPERATION-ROUTE",
    "CAP-SVC-BUSINESS-ROUTE-AUDIT",
    "CAP-SVC-PROBLEM-JSON",
]

HARDENING_CAPS = [
    (
        "CAP-SVC-PROJECT-ID-SLUG",
        "Project id path param slug validation",
        "The :projectId path param must match ^[a-z0-9][a-z0-9-]{0,63}$ before it becomes project scope. "
        "An id that does not (padded, control characters, uppercase, over-long at any length) is not_found "
        "after authentication, identical to a missing or ungranted project, and an unauthenticated caller "
        "gets the same 401 as for a valid id, before any validation detail. An invalid id is never recorded "
        "raw: audit_events.project_id is NULL, no reqalm.project_id span attribute is set, and request logs "
        "and exported span URL attributes show the segment as [invalid].",
        [("ARCH-API-RBAC", "satisfies"), ("CAP-SVC-OPERATION-ROUTE", "refines")],
        [
            f"{REPO}/apps/reqalm/src/http/project-id.ts",
            f"{REPO}/apps/reqalm/src/http/define-operation-route.ts",
            f"{REPO}/apps/reqalm/src/http/server.ts",
        ],
    ),
    (
        "CAP-SVC-STATIC-DEP-PATCH",
        "Production @fastify/static dependency patch",
        "apps/reqalm resolves @fastify/static 10.1.5 both directly (^10.1.5) and through @fastify/swagger-ui "
        "6.1.1 (^10.1.0), with no pnpm override, so GHSA-83w8-p2f5-377r and GHSA-8pvw-jcv7-9cmj (and "
        "GHSA-pr96-94w5-mx2h, GHSA-x428-ghpx-8j92) are gone from pnpm audit --prod; the web bundle and /docs "
        "still serve, and encoded path-traversal requests never return file contents.",
        [("ARCH-DEPLOY-MINIMAL", "satisfies")],
        [f"{REPO}/apps/reqalm/package.json", f"{REPO}/pnpm-lock.yaml", f"{REPO}/apps/reqalm/src/http/server.ts"],
    ),
    (
        "CAP-OTEL-SPAN-SAFE-ERRORS",
        "Span errors without raw exception text",
        "Every exported span (operation, Fastify request and handler, http, pg, undici, OpenBao) reports a "
        "failure as ERROR status with the generic message 'operation failed'; exception events keep only "
        "exception.type (no message or stack); operation spans add reqalm.error_kind (service error code or "
        "internal). Raw exception and database text stays in the server log only.",
        [("CAP-OTEL-OPERATION-SPANS", "refines"), ("ARCH-OTEL-TRACE", "satisfies")],
        [
            f"{REPO}/apps/reqalm/src/core/operation.ts",
            f"{REPO}/apps/reqalm/src/telemetry/trace-context.ts",
            f"{REPO}/apps/reqalm/src/telemetry/safe-span-processor.ts",
            f"{REPO}/apps/reqalm/src/telemetry/tracing.ts",
        ],
    ),
    (
        "CAP-SVC-IMPLICIT-PUBLIC-EXACT",
        "Implicit public route allowlist is method+path exact",
        "OAuth, probe, and auth-shaped routes become implicitly public only when METHOD and path match the "
        "exact allowlist (HEAD checked as GET; /docs for GET and HEAD only), and a route registered for "
        "several methods only if every method matches; any other method or path must declare reqalmSecurity.",
        [
            ("CAP-SVC-ROUTE-REGISTRY", "refines"),
            ("CAP-SVC-BUSINESS-ROUTE-AUDIT", "refines"),
            ("ARCH-API-RBAC", "satisfies"),
        ],
        [f"{REPO}/apps/reqalm/src/http/route-security.ts"],
    ),
    (
        "CAP-SVC-NON-API-AUTH-AUDIT",
        "Authenticated non-/api routes audited or allowlisted",
        "Hand-registered authenticated routes outside /api/ must use defineOperationRoute or sit on an "
        "exact METHOD + path allowlist (today only POST /mcp); route-security.test.ts fails closed otherwise.",
        [("CAP-SVC-ROUTE-REGISTRY", "refines"), ("ARCH-API-RBAC", "satisfies")],
        [f"{REPO}/apps/reqalm/src/http/route-security.ts", f"{REPO}/apps/reqalm/src/http/route-security.test.ts"],
    ),
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    rel_helper = find(data.get("releases"), "id", "rel-r1-route-helper")
    if rel_helper:
        rel_helper["status"] = "shipped"
        rel_helper["shipped_on"] = SHIPPED_ROUTE_HELPER
        rel_helper["notes"] = (
            "One PR = one release. https://github.com/danrabydev/sdoc-intake/pull/19 merged to main as "
            f"{ROUTE_HELPER_MERGE_SHA} on {SHIPPED_ROUTE_HELPER}. Verified locally: tests x3, typecheck, "
            "build, dev-stack upgrade + smoke, live Problem Details probes. defineOperationRoute is the single "
            "pipeline for /api/ business routes; does not replace auth/OAuth hand routes or claim OpenAPI "
            "generation from Zod."
        )
    for cap in ROUTE_HELPER_CAPS:
        ver = find(data.get("requirement_versions"), "uid", cap)
        if ver and ver.get("status") == "draft":
            ver["status"] = "active"
            ver["verification_outcome"] = "pass"

    deliver_uids: list[str] = []
    edges = data.setdefault("edges", [])
    arts = data.setdefault("capability_artifacts", [])

    for cap_uid, title, stmt, satisfies, artifact_paths in HARDENING_CAPS:
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
                security={"catalog_ref": "CM-2", "verification_note": "Planned until route-hardening PR merges."},
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
                notes="Planned for route-hardening PR; approve once merged and verified.",
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
            id="rel-r1-route-hardening",
            project_id="reqalm",
            name="R1 — route helper hardening (Cyber/QA follow-up)",
            planned_on=PLANNED_HARDENING,
            shipped_on=None,
            status="planned",
            delivers=deliver_uids,
            cyber_gate=True,
            notes=(
                "One PR = one release. @fastify/static 10.1.5 via @fastify/swagger-ui 6.1.1 (no override), "
                "project id slug rule (incl. over-long ids; invalid ids redacted in logs and spans), no error "
                "text on any exported span, exact METHOD + path implicit public allowlist, authenticated "
                "non-/api route guard, and QA tests for the reachedHandler guard and non-web 404. Planned "
                "until merged; the next PR marks it shipped at the merge sha."
            ),
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)

    print("Patched dogfood.yaml: shipped rel-r1-route-helper, added rel-r1-route-hardening")


if __name__ == "__main__":
    main()
