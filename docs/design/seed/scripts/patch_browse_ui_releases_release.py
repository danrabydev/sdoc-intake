#!/usr/bin/env python3
"""Ship rel-r1-read-releases (PR #25) and add rel-r1-browse-ui-releases / CAP-BROWSE-UI-RELEASES. Idempotent."""
from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
READ_RELEASES_MERGE = "eca9090802c415f78697cc8b9d000f7f7d67a702"
SHIPPED_DATE = "2026-10-08"
CAP_API = "CAP-READ-RELEASES"
REL_API = "rel-r1-read-releases"
CAP_UI = "CAP-BROWSE-UI-RELEASES"
REL_UI = "rel-r1-browse-ui-releases"

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


def activate_capability(data, uid: str, verification_note: str, catalog_ref: str = "CM-2") -> None:
    ver = find(data.get("requirement_versions"), "uid", uid)
    if ver:
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {"catalog_ref": catalog_ref, "verification_note": verification_note}


UI_STMT = (
    "Read-only /app browse screens for grant-scoped releases within a project: paged list with status filter "
    "(planned | shipped, URL-driven), release detail (notes preserving line breaks and delivered capabilities "
    "linking to requirement detail). Uses session/CSRF auth; safe DOM text only. Trace links deferred."
)
UI_ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/web/public/app.js",
    f"{REPO}/apps/reqalm/src/web/public/browse.js",
    f"{REPO}/apps/reqalm/src/web/public/styles.css",
    f"{REPO}/apps/reqalm/src/web/spa-shell-paths.ts",
    f"{REPO}/apps/reqalm/src/web/browse-ui.test.ts",
    f"{REPO}/docs/design/seed/scripts/patch_browse_ui_releases_release.py",
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    ship_release_preserve_notes(data, REL_API)
    activate_capability(
        data,
        CAP_API,
        f"Shipped with releases read API PR #25 (merge {READ_RELEASES_MERGE}).",
        catalog_ref="AC-3",
    )

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP_UI,
            project_id="reqalm",
            parent="SEC-CP",
            kind="capability",
            title="Browse releases UI (read-only)",
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
            security={"catalog_ref": "CM-2", "verification_note": "Planned until releases browse UI PR merges."},
            statement_hash=statement_hash(UI_STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-browse-ui-releases",
            subject_kind="CapabilityLine",
            base_uid=CAP_UI,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for releases browse UI PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP_UI]
    for to in ("C08", "D06", "ARCH-UI", "ARCH-UI-GUARD", CAP_API):
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
            name="R1 — browse releases UI (read-only)",
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP_UI],
            cyber_gate=False,
            notes="Read-only releases list/detail in /app; trace links deferred.",
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print("Patched dogfood.yaml: shipped rel-r1-read-releases, rel-r1-browse-ui-releases / CAP-BROWSE-UI-RELEASES")


if __name__ == "__main__":
    main()
