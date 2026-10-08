#!/usr/bin/env python3
"""Ship rel-r1-read-requirements (PR #24) and add rel-r1-browse-ui-reqs / CAP-BROWSE-UI-REQS. Idempotent."""
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


CAP_API = "CAP-READ-REQS"
CAP_UI = "CAP-BROWSE-UI-REQS"
UI_STMT = (
    "Read-only /app browse screens for grant-scoped requirements within a project: paged list with "
    "kind/type/status filters and q search (URL-driven), requirement detail (statement + attributes), "
    "and paged version history (newest first). Uses session/CSRF auth; safe DOM text only. Trace links deferred."
)
UI_ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/web/public/app.js",
    f"{REPO}/apps/reqalm/src/web/public/browse.js",
    f"{REPO}/apps/reqalm/src/web/public/styles.css",
    f"{REPO}/apps/reqalm/src/web/spa-shell-paths.ts",
    f"{REPO}/apps/reqalm/src/web/browse-ui.test.ts",
    f"{REPO}/docs/design/seed/scripts/patch_browse_ui_reqs_release.py",
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    rel_api = find(data.get("releases"), "id", "rel-r1-read-requirements")
    if rel_api:
        rel_api["status"] = "shipped"
        rel_api["shipped_on"] = SHIPPED_DATE
        rel_api["notes"] = (
            f"PR #24 merged to main as {READ_REQS_MERGE} on {SHIPPED_DATE}. "
            "Grant-scoped requirements read APIs (list, detail, versions)."
        )
    ver_api = find(data.get("requirement_versions"), "uid", CAP_API)
    if ver_api:
        ver_api["status"] = "active"
        ver_api["verification_outcome"] = "pass"
        ver_api["security"] = {
            "catalog_ref": "CM-2",
            "verification_note": "Shipped with requirements read API PR #24.",
        }

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP_UI,
            project_id="reqalm",
            parent="SEC-CP",
            kind="capability",
            title="Browse requirements UI (read-only)",
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
            security={"catalog_ref": "CM-2", "verification_note": "Planned until requirements browse UI PR merges."},
            statement_hash=statement_hash(UI_STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-browse-ui-reqs",
            subject_kind="CapabilityLine",
            base_uid=CAP_UI,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for requirements browse UI PR.",
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
            id="rel-r1-browse-ui-reqs",
            project_id="reqalm",
            name="R1 — browse requirements UI (read-only)",
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP_UI],
            cyber_gate=False,
            notes="Read-only requirements list/detail/version history in /app; trace links deferred.",
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print("Patched dogfood.yaml: shipped rel-r1-read-requirements, rel-r1-browse-ui-reqs / CAP-BROWSE-UI-REQS")


if __name__ == "__main__":
    main()
