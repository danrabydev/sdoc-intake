#!/usr/bin/env python3
"""Ship rel-r1-rename-reqalm and add rel-r1-service-foundation (this PR).

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
MERGE_RENAME = "2982f0b8fb04e8766281409602ceee65041771ac"

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


CAPABILITIES = [
    (
        "CAP-SVC-RESULT-ENVELOPE",
        "ServiceResult + HTTP Problem Details envelope",
        "Typed ServiceResult (ok/err codes) and mapServiceResultToHttp for data and errors with request_id.",
        ["ARCH-API", "ARCH-API-LAYERS"],
        [f"{REPO}/apps/reqalm/src/core/service-result.ts", f"{REPO}/apps/reqalm/src/core/http-envelope.ts"],
    ),
    (
        "CAP-SVC-REQUEST-CONTEXT",
        "Per-request RequestContext for services",
        "buildRequestContext supplies identity, grants, roles, agent attribution, logger, pool, and request id.",
        ["ARCH-API-LAYERS", "ARCH-API-RBAC"],
        [f"{REPO}/apps/reqalm/src/core/request-context.ts"],
    ),
    (
        "CAP-SVC-OPERATION-EXECUTOR",
        "Operation executor (authorize → execute → audit → log)",
        "runOperation enforces RBAC + project scope, writes audit_events, structured logs, returns ServiceResult.",
        ["ARCH-API-RBAC", "CAP-RBAC"],
        [f"{REPO}/apps/reqalm/src/core/operation.ts"],
    ),
    (
        "CAP-SVC-AUDIT-APPEND",
        "Append-only business audit_events table",
        "Migration 006 + writeBusinessAudit; auth events remain in auth_audit_events.",
        ["CAP-AUDIT", "ARCH-OTEL", "ARCH-CRED-AUDIT"],
        [f"{REPO}/apps/reqalm/src/db/migrations/006_business_audit.sql", f"{REPO}/apps/reqalm/src/audit/business-audit.ts"],
    ),
    (
        "CAP-SVC-STRUCTURED-LOG",
        "Structured operation logging with redaction",
        "logOperation + redactForLog; secrets/tokens/password keys redacted in log payloads.",
        ["ARCH-OTEL"],
        [f"{REPO}/apps/reqalm/src/core/logging/structured-log.ts", f"{REPO}/apps/reqalm/src/core/logging/redact.ts"],
    ),
    (
        "CAP-SVC-ROUTE-REGISTRY",
        "Fail-closed API route security registration",
        "Every /api /oauth /mcp /health /ready route declares public, authenticated, or permission; test enforces.",
        ["ARCH-API-RBAC"],
        [f"{REPO}/apps/reqalm/src/http/route-security.ts", f"{REPO}/apps/reqalm/src/http/route-security.test.ts"],
    ),
    (
        "CAP-SVC-MODULE-BOOTSTRAP",
        "Feature module convention + registration",
        "src/modules/<feature>/ with service, routes, tests; register.ts entrypoint and README.",
        ["ARCH-API-LAYERS"],
        [f"{REPO}/apps/reqalm/src/modules/README.md", f"{REPO}/apps/reqalm/src/modules/register.ts"],
    ),
    (
        "CAP-SVC-PROJECT-READ",
        "Reference vertical GET /api/v1/projects/:projectId",
        "Project read gated on requirement:read, project-scoped 404 without grant, enveloped response, audited.",
        ["ARCH-API-RBAC", "ARCH-CP-SCOPE"],
        [f"{REPO}/apps/reqalm/src/modules/projects/routes.ts", f"{REPO}/apps/reqalm/src/modules/service-foundation.test.ts"],
    ),
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    # Ship rename release
    rel_rename = find(data.get("releases"), "id", "rel-r1-rename-reqalm")
    if rel_rename:
        rel_rename["status"] = "shipped"
        rel_rename["shipped_on"] = "2026-10-07"
        rel_rename["notes"] = (
            f"One PR = one release. https://github.com/danrabydev/sdoc-intake/pull/16 merged to main as "
            f"{MERGE_RENAME} on 2026-10-07. Verified: in-process tests + typecheck + build; local Docker "
            f"in-place upgrade of PR #15 dev stack (see CAP-RENAME-REQALM verification_note)."
        )
    ver = find(data.get("requirement_versions"), "uid", "CAP-RENAME-REQALM")
    if ver:
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
    ar = find(data.get("approval_records"), "id", "ar-cap-rename-reqalm")
    if ar:
        ar["notes"] = "Delivered in PR #16; solution approval (ARCH-CAP-APPROVE) pending Dan at merge review."

    deliver_uids = []
    edges = data.setdefault("edges", [])
    arts = data.setdefault("capability_artifacts", [])

    for cap_uid, title, stmt, satisfies, artifact_paths in CAPABILITIES:
        base = cap_uid.replace("CAP-", "").lower().replace("_", "-")
        upsert(
            data.setdefault("requirement_lines", []),
            "base_uid",
            cm(
                base_uid=cap_uid,
                project_id="reqalm",
                parent="SEC-API",
                kind="capability",
                title=title,
            ),
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
                security={"catalog_ref": "CM-2", "verification_note": "Planned until service-foundation PR merges."},
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
                notes="Planned for service-foundation PR; approve as solution once merged and verified.",
                approved_version_uid=None,
                approved_statement_hash=None,
            ),
        )
        for to in satisfies:
            ensure_edge(edges, {"from": cap_uid, "to": to, "kind": "satisfies"})
        for uri in artifact_paths:
            if not any(a.get("requirement_version_uid") == cap_uid and a.get("uri") == uri for a in arts):
                arts.append(
                    {
                        "requirement_version_uid": cap_uid,
                        "kind": "other",
                        "uri": uri,
                    }
                )
        deliver_uids.append(cap_uid)

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id="rel-r1-service-foundation",
            project_id="reqalm",
            name="R1 — API service foundation (context, RBAC ops, audit, envelope)",
            planned_on="2026-10-07",
            shipped_on=None,
            status="planned",
            delivers=deliver_uids,
            cyber_gate=False,
            notes=(
                "One PR = one release. Service layer foundation: ServiceResult + HTTP envelope, RequestContext, "
                "runOperation with RBAC/project scope, append-only audit_events, structured logging/redaction, "
                "fail-closed route registry, modules bootstrap, GET project reference vertical. Planned until merge."
            ),
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)

    print(
        "Patched dogfood.yaml: shipped rel-r1-rename-reqalm, added rel-r1-service-foundation + capabilities"
    )


if __name__ == "__main__":
    main()
