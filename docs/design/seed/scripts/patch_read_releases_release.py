#!/usr/bin/env python3
"""Ship rel-r1-read-requirements (PR #24), rel-r1-browse-ui-reqs (PR #26); add rel-r1-read-releases. Idempotent."""
from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
READ_REQS_MERGE = "25ed12cbde8dda053d9f3f91e612c9bff1108ae7"
BROWSE_UI_REQS_MERGE = "7185c9bf0fd59387f874226b918d83b4f0d56c00"
SHIPPED_DATE = "2026-10-08"
CAP_READ_REQS = "CAP-READ-REQS"
REL_READ_REQS = "rel-r1-read-requirements"
CAP_BROWSE_UI_REQS = "CAP-BROWSE-UI-REQS"
REL_BROWSE_UI_REQS = "rel-r1-browse-ui-reqs"
CAP = "CAP-READ-RELEASES"
REL = "rel-r1-read-releases"

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
    for e in edges:
        if (e.get("from"), e.get("to"), e.get("kind")) == (edge.get("from"), edge.get("to"), edge.get("kind")):
            return 0
    edges.append(edge)
    return 1


def ship_release(data, rel_id: str, merge_sha: str, notes_suffix: str) -> None:
    rel = find(data.get("releases"), "id", rel_id)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = SHIPPED_DATE
        rel["notes"] = f"Merged to main as {merge_sha} on {SHIPPED_DATE}. {notes_suffix}"


def ensure_shipped_preserve_notes(data, rel_id: str) -> None:
    """Idempotent status/shipped_on only; never rewrite notes (parallel-PR rule for prior merges)."""
    rel = find(data.get("releases"), "id", rel_id)
    if rel:
        rel["status"] = "shipped"
        if not rel.get("shipped_on"):
            rel["shipped_on"] = SHIPPED_DATE


def activate_capability(data, uid: str, verification_note: str, catalog_ref: str = "AC-3") -> None:
    ver = find(data.get("requirement_versions"), "uid", uid)
    if ver:
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {"catalog_ref": catalog_ref, "verification_note": verification_note}


STMT = (
    "Grant-scoped releases read APIs: paged GET /api/v1/projects/:projectId/releases with optional status "
    "(planned | shipped), ordered planned_on desc then id; GET detail with notes and delivered capabilities "
    "(capability lines from release_delivers). cyber_gate is stored on the release row but not exposed in v1 "
    "read DTOs. gate_signoffs and contract in_scope_of edges from dogfood are not loaded by the seed loader "
    "(deferred). Invalid release id segments redact in logs/spans like project slugs."
)
ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/http/project-id.ts",
    f"{REPO}/apps/reqalm/src/rbac/enforce.ts",
    f"{REPO}/apps/reqalm/src/modules/releases/",
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    ensure_shipped_preserve_notes(data, REL_READ_REQS)
    activate_capability(
        data,
        CAP_READ_REQS,
        "Shipped with requirements read API PR #24.",
        catalog_ref="CM-2",
    )

    ship_release(
        data,
        REL_BROWSE_UI_REQS,
        BROWSE_UI_REQS_MERGE,
        "Read-only requirements list/detail/version history in /app; trace links deferred.",
    )
    activate_capability(
        data,
        CAP_BROWSE_UI_REQS,
        "Shipped with requirements browse UI PR #26.",
        catalog_ref="CM-2",
    )

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-CP",
            kind="capability",
            title="Read releases (list, detail)",
        ),
    )
    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid=CAP,
            base_uid=CAP,
            version_n=0,
            status="draft",
            statement=STMT,
            priority=10,
            iteration="iter-r1",
            security={"catalog_ref": "AC-3", "verification_note": "Planned until releases read PR merges."},
            statement_hash=statement_hash(STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-read-releases",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for releases read API PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP]
    for to in ("G08", "ARCH-API-RBAC", "CAP-SVC-OPERATION-ROUTE", "CAP-RBAC"):
        ensure_edge(data["edges"], {"from": CAP, "to": to, "kind": "satisfies"})
    arts = data.setdefault("capability_artifacts", [])
    data["capability_artifacts"] = [a for a in arts if a.get("requirement_version_uid") != CAP]
    for uri in ARTIFACTS:
        data["capability_artifacts"].append({"requirement_version_uid": CAP, "kind": "other", "uri": uri})

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=REL,
            project_id="reqalm",
            name="R1 — releases read API",
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes="Read-only project-scoped release list/detail HTTP APIs; gate_signoffs not in DB yet.",
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print("Patched dogfood.yaml")


if __name__ == "__main__":
    main()
