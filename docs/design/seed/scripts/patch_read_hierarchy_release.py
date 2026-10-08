#!/usr/bin/env python3
"""Add rel-r1-read-hierarchy / CAP-READ-HIERARCHY. Idempotent; parallel-PR safe for browse-ui-releases."""
from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
SHIPPED_DATE = "2026-10-08"
READ_RELEASES_MERGE = "eca9090802c415f78697cc8b9d000f7f7d67a702"
CAP_READ_RELEASES = "CAP-READ-RELEASES"
REL_READ_RELEASES = "rel-r1-read-releases"
CAP = "CAP-READ-HIERARCHY"
REL = "rel-r1-read-hierarchy"
REL_BROWSE_UI_RELEASES = "rel-r1-browse-ui-releases"
CAP_BROWSE_UI_RELEASES = "CAP-BROWSE-UI-RELEASES"
# Set when PR #27 merges (parallel-PR rule); do not guess a sha.
BROWSE_UI_RELEASES_MERGE: str | None = None

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


def ensure_shipped_preserve_notes(data, rel_id: str) -> None:
    rel = find(data.get("releases"), "id", rel_id)
    if rel:
        rel["status"] = "shipped"
        if not rel.get("shipped_on"):
            rel["shipped_on"] = SHIPPED_DATE


def ship_release(data, rel_id: str, merge_sha: str, notes_suffix: str) -> None:
    rel = find(data.get("releases"), "id", rel_id)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = SHIPPED_DATE
        rel["notes"] = f"Merged to main as {merge_sha} on {SHIPPED_DATE}. {notes_suffix}"


def activate_capability(data, uid: str, verification_note: str, catalog_ref: str = "AC-3") -> None:
    ver = find(data.get("requirement_versions"), "uid", uid)
    if ver:
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {"catalog_ref": catalog_ref, "verification_note": verification_note}


STMT = (
    "Grant-scoped requirement hierarchy read API: lazy paged GET "
    "/api/v1/projects/:projectId/requirements/tree?parent=<base_uid> returning direct children in "
    "dogfood sibling order with uid, title, kind, type, status, and child_count (sections and "
    "requirements alike; roots = parent null). Optional parent_uid and ancestors on detail. "
    "Parent pointers already live on requirement_lines (001); loader adds sibling_order and rejects "
    "cross-project parents. Trace edges and obsolete-line filtering are deferred."
)
ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/db/migrations/008_requirement_hierarchy.sql",
    f"{REPO}/apps/reqalm/src/seed/load-dogfood.ts",
    f"{REPO}/apps/reqalm/src/modules/requirements/",
    f"{REPO}/docs/design/seed/scripts/patch_read_hierarchy_release.py",
]


def ship_read_releases_pr25(data) -> None:
    rel = find(data.get("releases"), "id", REL_READ_RELEASES)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = SHIPPED_DATE
        rel["notes"] = (
            f"PR #25 merged to main as {READ_RELEASES_MERGE} on {SHIPPED_DATE}; "
            "verified locally plus QA/Cyber."
        )
    activate_capability(
        data,
        CAP_READ_RELEASES,
        "Shipped with releases read API PR #25.",
        catalog_ref="CM-2",
    )


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    ship_read_releases_pr25(data)

    if BROWSE_UI_RELEASES_MERGE:
        ship_release(
            data,
            REL_BROWSE_UI_RELEASES,
            BROWSE_UI_RELEASES_MERGE,
            "Read-only releases browse UI in /app.",
        )
        activate_capability(
            data,
            CAP_BROWSE_UI_RELEASES,
            f"Shipped with releases browse UI PR merged as {BROWSE_UI_RELEASES_MERGE}.",
            catalog_ref="CM-2",
        )
    else:
        ensure_shipped_preserve_notes(data, REL_BROWSE_UI_RELEASES)

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-RL",
            kind="capability",
            title="Read requirement hierarchy (lazy tree API)",
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
            security={"catalog_ref": "AC-3", "verification_note": "Planned until hierarchy read API PR merges."},
            statement_hash=statement_hash(STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-read-hierarchy",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for requirement hierarchy read API PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP]
    for to in ("C06", "C07", "ARCH-API-RBAC", "CAP-READ-REQS", "CAP-SVC-OPERATION-ROUTE", "CAP-RBAC"):
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
            name="R1 — requirement hierarchy read API",
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes="Lazy tree read API + loader hierarchy persistence; tree UI deferred.",
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print("Patched dogfood.yaml: rel-r1-read-hierarchy / CAP-READ-HIERARCHY")


if __name__ == "__main__":
    main()
