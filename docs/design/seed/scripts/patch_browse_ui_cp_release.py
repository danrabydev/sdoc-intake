#!/usr/bin/env python3
"""Ship rel-r1-browse-clients-projects (PR #22) and add rel-r1-browse-ui-cp / CAP-BROWSE-UI-CP.

Idempotent. Does NOT git commit.
Run yaml_to_strictdoc.py --validate afterwards.
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
BROWSE_API_MERGE = "fefe6d4b61633ae4cc15517245d1c7d02498ab54"
SHIPPED_DATE = "2026-10-08"

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


CAP_API = "CAP-BROWSE-CP"
CAP_UI = "CAP-BROWSE-UI-CP"
UI_STMT = (
    "Read-only /app browse screens for grant-scoped clients and projects: paged clients list, "
    "client detail with projects, all-projects list with client name, and a project header stub "
    "(Requirements and Releases sections labelled coming next). Uses existing session/CSRF auth; "
    "API data rendered via safe DOM text only."
)
UI_ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/web/public/app.js",
    f"{REPO}/apps/reqalm/src/web/public/api-client.js",
    f"{REPO}/apps/reqalm/src/web/public/browse.js",
    f"{REPO}/apps/reqalm/src/web/public/styles.css",
    f"{REPO}/apps/reqalm/src/web/browse-ui.test.ts",
    f"{REPO}/docs/design/seed/scripts/patch_browse_ui_cp_release.py",
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    rel_api = find(data.get("releases"), "id", "rel-r1-browse-clients-projects")
    if rel_api:
        rel_api["status"] = "shipped"
        rel_api["shipped_on"] = SHIPPED_DATE
        rel_api["notes"] = (
            f"PR #22 merged to main as {BROWSE_API_MERGE} on {SHIPPED_DATE}. "
            "Grant-scoped read APIs for clients and projects."
        )
    ver_api = find(data.get("requirement_versions"), "uid", CAP_API)
    if ver_api:
        ver_api["status"] = "active"
        ver_api["verification_outcome"] = "pass"
        ver_api["security"] = {
            "catalog_ref": "CM-2",
            "verification_note": "Shipped with browse-clients-projects PR #22.",
        }

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP_UI,
            project_id="reqalm",
            parent="SEC-CP",
            kind="capability",
            title="Browse clients and projects UI (read-only)",
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
            security={
                "catalog_ref": "CM-2",
                "verification_note": "Planned until browse UI PR merges.",
            },
            statement_hash=statement_hash(UI_STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-browse-ui-cp",
            subject_kind="CapabilityLine",
            base_uid=CAP_UI,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for browse UI PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    for to in ("B07", "B08", "ARCH-UI", "ARCH-UI-GUARD", CAP_API):
        ensure_edge(edges, {"from": CAP_UI, "to": to, "kind": "satisfies"})

    arts = data.setdefault("capability_artifacts", [])
    data["capability_artifacts"] = [a for a in arts if a.get("requirement_version_uid") != CAP_UI]
    for uri in UI_ARTIFACTS:
        data["capability_artifacts"].append({"requirement_version_uid": CAP_UI, "kind": "other", "uri": uri})

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id="rel-r1-browse-ui-cp",
            project_id="reqalm",
            name="R1 — browse clients and projects UI (read-only)",
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP_UI],
            cyber_gate=False,
            notes=(
                "Read-only /app clients and projects screens on grant-scoped APIs; "
                "project Requirements/Releases panes still to come."
            ),
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print("Patched dogfood.yaml: shipped rel-r1-browse-clients-projects, rel-r1-browse-ui-cp / CAP-BROWSE-UI-CP")


if __name__ == "__main__":
    main()
