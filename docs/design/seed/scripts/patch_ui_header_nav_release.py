#!/usr/bin/env python3
"""Add rel-r1-ui-header-nav / CAP-UI-HEADER-NAV (ReqALM header + project tabs). Idempotent."""
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
RELATIONS_MERGE = "c8272340b67a0e505b63483bd2ef1550accb4635"
CAP_REL_UI = "CAP-BROWSE-UI-RELATIONS"
REL_REL_UI = "rel-r1-browse-ui-relations"
CAP = "CAP-UI-HEADER-NAV"
REL = "rel-r1-ui-header-nav"

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


UI_STMT = (
    "ReqALM /app shell header aligned to product chrome: brand mark, client/project/page breadcrumb with safe text, "
    "project-scoped tabs (Requirements with list/tree toggle, Releases; coming-soon stubs for Traceability, Capabilities, "
    "Contracts, Audit), minimal Clients/Projects nav outside project context, user initials avatar and sign out. "
    "Accessible nav landmarks, aria-current on active items, aria-disabled on stub tabs, visible focus styles. No sidebar."
)
UI_ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/web/public/app.js",
    f"{REPO}/apps/reqalm/src/web/public/browse.js",
    f"{REPO}/apps/reqalm/src/web/public/shell-nav.js",
    f"{REPO}/apps/reqalm/src/web/public/styles.css",
    f"{REPO}/apps/reqalm/src/web/browse-ui.test.ts",
    f"{REPO}/docs/design/seed/scripts/patch_ui_header_nav_release.py",
]


def ship_browse_ui_relations(data) -> None:
    rel = find(data.get("releases"), "id", REL_REL_UI)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = SHIPPED_DATE
        rel["notes"] = (
            f"PR #32 merged to main as {RELATIONS_MERGE} on {SHIPPED_DATE}. "
            "Relationships panel on requirement detail browse screen."
        )
    ver = find(data.get("requirement_versions"), "uid", CAP_REL_UI)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "CM-2")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {
            "catalog_ref": catalog_ref,
            "verification_note": f"Shipped with relationships browse UI PR #32 (merge {RELATIONS_MERGE}).",
        }
    ar = find(data.get("approval_records"), "id", "ar-browse-ui-relations")
    if ar:
        ar["status"] = "unapproved"
        ar["notes"] = (
            f"Capability active with verification pass after PR #32 merge {RELATIONS_MERGE}; "
            "formal approval record not filed in seed."
        )
        ar["approved_version_uid"] = None
        ar["approved_statement_hash"] = None


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    ship_browse_ui_relations(data)

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="CAP-UI-KIT-CHROME",
            kind="capability",
            title="ReqALM header and project navigation",
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
            statement=UI_STMT,
            priority=10,
            iteration="iter-r1",
            security={"catalog_ref": "CM-2", "verification_note": "Planned until header/nav UI PR merges."},
            statement_hash=statement_hash(UI_STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-ui-header-nav",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for header and project tab navigation PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP]
    for to in ("ARCH-UI", "ARCH-UI-GUARD", "CAP-BROWSE-UI-REQS"):
        ensure_edge(data["edges"], {"from": CAP, "to": to, "kind": "satisfies"})
    ensure_edge(data["edges"], {"from": CAP, "to": "CAP-UI-KIT-CHROME", "kind": "uses"})
    arts = data.setdefault("capability_artifacts", [])
    data["capability_artifacts"] = [a for a in arts if a.get("requirement_version_uid") != CAP]
    for uri in UI_ARTIFACTS:
        data["capability_artifacts"].append({"requirement_version_uid": CAP, "kind": "other", "uri": uri})

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=REL,
            project_id="reqalm",
            name="R1 — ReqALM header and project navigation",
            planned_on="2026-10-09",
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes="Top bar breadcrumb, project tabs, list/tree toggle under Requirements; no new routes.",
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(f"Patched dogfood.yaml: shipped {REL_REL_UI}, {REL} / {CAP}")


if __name__ == "__main__":
    main()
