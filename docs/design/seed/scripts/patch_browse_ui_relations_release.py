#!/usr/bin/env python3
"""Ship rel-r1-catalogs-api (PR #33); add rel-r1-browse-ui-relations / CAP-BROWSE-UI-RELATIONS. Idempotent."""
from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
SHIPPED_DATE = "2026-10-09"
CATALOGS_MERGE = "ed372358fb1a04546ea884c9cbcee69f959517b1"
CAP_CAT = "CAP-CATALOGS-API"
REL_CAT = "rel-r1-catalogs-api"
CAP_UI = "CAP-BROWSE-UI-RELATIONS"
REL_UI = "rel-r1-browse-ui-relations"

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


UI_STMT = (
    "Read-only Relationships panel on the requirement detail browse screen: loads "
    "GET /api/v1/projects/:projectId/requirements/:id/relations and renders outgoing and incoming "
    "links grouped by kind. Requirement peers navigate to detail; catalog conforms_to peers show as "
    "non-navigating chips with imprint label; trace_suspect shows needs re-check; restricted peers "
    "show a muted stub with no peer id. Empty, loading, and error states included."
)
UI_ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/web/public/browse.js",
    f"{REPO}/apps/reqalm/src/web/public/browse-core.js",
    f"{REPO}/apps/reqalm/src/web/public/browse-dom.js",
    f"{REPO}/apps/reqalm/src/web/public/browse-relations.js",
    f"{REPO}/apps/reqalm/src/web/public/styles.css",
    f"{REPO}/apps/reqalm/src/web/browse-ui.test.ts",
    f"{REPO}/docs/design/seed/scripts/patch_browse_ui_relations_release.py",
]


def ship_catalogs_api(data) -> None:
    rel = find(data.get("releases"), "id", REL_CAT)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = SHIPPED_DATE
        rel["notes"] = (
            f"PR #33 merged to main as {CATALOGS_MERGE} on {SHIPPED_DATE}. "
            "Read-only catalogs/imprints/controls endpoints; browse UI deferred."
        )
    ver = find(data.get("requirement_versions"), "uid", CAP_CAT)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "AC-3")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {
            "catalog_ref": catalog_ref,
            "verification_note": f"Shipped with catalogs read API PR #33 (merge {CATALOGS_MERGE}).",
        }
    ar = find(data.get("approval_records"), "id", "ar-catalogs-api")
    if ar:
        ar["status"] = "unapproved"
        ar["notes"] = (
            f"Capability active with verification pass after PR #33 merge {CATALOGS_MERGE}; "
            "formal approval record not filed in seed."
        )
        ar["approved_version_uid"] = None
        ar["approved_statement_hash"] = None


def add_browse_ui_relations(data) -> None:
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP_UI,
            project_id="reqalm",
            parent="SEC-CP",
            kind="capability",
            title="Browse requirement relationships UI (read-only)",
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
            security={"catalog_ref": "CM-2", "verification_note": "Planned until relationships browse UI PR merges."},
            statement_hash=statement_hash(UI_STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-browse-ui-relations",
            subject_kind="CapabilityLine",
            base_uid=CAP_UI,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for relationships browse UI PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP_UI]
    for to in ("C08", "D06", "ARCH-UI", "ARCH-UI-GUARD", "CAP-RELATIONS-API", "CAP-BROWSE-UI-REQS"):
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
            name="R1 — browse requirement relationships UI (read-only)",
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP_UI],
            cyber_gate=False,
            notes="Relationships panel on requirement detail; two-column graph view deferred.",
        ),
    )


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    ship_catalogs_api(data)
    add_browse_ui_relations(data)

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(f"Patched dogfood.yaml: shipped {REL_CAT}, {REL_UI} / {CAP_UI}")


if __name__ == "__main__":
    main()
