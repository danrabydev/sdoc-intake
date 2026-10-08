#!/usr/bin/env python3
"""Ship rel-r1-read-hierarchy (PR #28); add rel-r1-browse-ui-tree / CAP-BROWSE-UI-TREE. Idempotent."""
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
READ_HIERARCHY_MERGE = "ffd1d5c38ffc6f09c13dd877c82bf0d4bd891764"
CAP_API = "CAP-READ-HIERARCHY"
REL_API = "rel-r1-read-hierarchy"
CAP_UI = "CAP-BROWSE-UI-TREE"
REL_UI = "rel-r1-browse-ui-tree"

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


def ship_release_preserve_notes(data, rel_id: str) -> None:
    rel = find(data.get("releases"), "id", rel_id)
    if rel:
        rel["status"] = "shipped"
        if not rel.get("shipped_on"):
            rel["shipped_on"] = SHIPPED_DATE


def activate_capability_preserve_catalog(data, uid: str, verification_note: str) -> None:
    ver = find(data.get("requirement_versions"), "uid", uid)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "AC-3")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {"catalog_ref": catalog_ref, "verification_note": verification_note}


UI_STMT = (
    "Read-only /app requirements tree for a grant-scoped project: lazy-loaded outline at "
    "/app/projects/:projectId/tree using GET .../requirements/tree?parent= (roots when omitted). "
    "Each node shows kind, uid, title; expanders load children once and cache in memory. "
    "Accessible WAI-ARIA tree (roles, aria-expanded/level, keyboard navigation). "
    "Requirement detail breadcrumbs from ancestors (sections link to tree). Session/CSRF auth; safe DOM text only."
)
UI_ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/web/public/app.js",
    f"{REPO}/apps/reqalm/src/web/public/browse.js",
    f"{REPO}/apps/reqalm/src/web/public/styles.css",
    f"{REPO}/apps/reqalm/src/web/spa-shell-paths.ts",
    f"{REPO}/apps/reqalm/src/web/browse-ui.test.ts",
    f"{REPO}/docs/design/seed/scripts/patch_browse_ui_tree_release.py",
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    ship_release_preserve_notes(data, REL_API)
    activate_capability_preserve_catalog(
        data,
        CAP_API,
        f"Shipped with requirement hierarchy read API PR #28 (merge {READ_HIERARCHY_MERGE}).",
    )

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP_UI,
            project_id="reqalm",
            parent="SEC-RL",
            kind="capability",
            title="Browse requirements tree UI (read-only)",
        ),
    )
    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid=CAP_UI,
            base_uid=CAP_UI,
            version_n=0,
            status="draft",
            statement=UI_STMT,
            priority=10,
            iteration="iter-r1",
            security={"catalog_ref": "CM-2", "verification_note": "Planned until requirements tree browse UI PR merges."},
            statement_hash=statement_hash(UI_STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-browse-ui-tree",
            subject_kind="CapabilityLine",
            base_uid=CAP_UI,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for requirements tree browse UI PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP_UI]
    for to in ("C06", "C07", "ARCH-UI", "ARCH-UI-GUARD", CAP_API):
        ensure_edge(data["edges"], {"from": CAP_UI, "to": to, "kind": "satisfies"})
    arts = data.setdefault("capability_artifacts", [])
    data["capability_artifacts"] = [a for a in arts if a.get("requirement_version_uid") != CAP_UI]
    for uri in UI_ARTIFACTS:
        data["capability_artifacts"].append({"requirement_version_uid": CAP_UI, "kind": "other", "uri": uri})

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=REL_UI,
            project_id="reqalm",
            name="R1 — browse requirements tree UI (read-only)",
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP_UI],
            cyber_gate=False,
            notes="Lazy tree outline in /app; ancestor breadcrumbs on requirement detail.",
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print("Patched dogfood.yaml: shipped rel-r1-read-hierarchy, rel-r1-browse-ui-tree / CAP-BROWSE-UI-TREE")


if __name__ == "__main__":
    main()
