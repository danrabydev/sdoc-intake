#!/usr/bin/env python3
"""Ship rel-r1-trace-inherit-uses (PR #39); add rel-r1-browse-ui-catalogs / CAP-BROWSE-UI-CATALOGS. Idempotent."""
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
TRACE_INHERIT_MERGE = "56bfc4d6a9fe04559ccddae636ec4052d84ae907"
CAP_TRACE = "CAP-TRACE-INHERIT-USES"
REL_TRACE = "rel-r1-trace-inherit-uses"
CAP_UI = "CAP-BROWSE-UI-CATALOGS"
REL_UI = "rel-r1-browse-ui-catalogs"

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
        if k == "statement":
            continue
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
    return 0


def ensure_edge(edges, edge):
    key = (
        edge.get("from"),
        edge.get("to"),
        edge.get("kind"),
        edge.get("catalog_imprint_id") or "",
    )
    for e in edges:
        if (
            e.get("from"),
            e.get("to"),
            e.get("kind"),
            e.get("catalog_imprint_id") or "",
        ) == key:
            return 0
    edges.append(edge)
    return 1


def ship_trace_inherit_uses(data) -> None:
    rel = find(data.get("releases"), "id", REL_TRACE)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = SHIPPED_DATE
        rel["notes"] = (
            f"PR #39 merged to main as {TRACE_INHERIT_MERGE} on {SHIPPED_DATE}. "
            "trace_edges.inheritable column + seed beds for common-control inheritance over uses."
        )
    ver = find(data.get("requirement_versions"), "uid", CAP_TRACE)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "CM-2")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {
            "catalog_ref": catalog_ref,
            "verification_note": f"Shipped with inherit-uses loader PR #39 (merge {TRACE_INHERIT_MERGE}).",
        }
    ar = find(data.get("approval_records"), "id", "ar-trace-inherit-uses")
    if ar:
        ar["status"] = "unapproved"
        ar["notes"] = (
            f"Capability active with verification pass after PR #39 merge {TRACE_INHERIT_MERGE}; "
            "formal approval record not filed in seed."
        )
        ar["approved_version_uid"] = None
        ar["approved_statement_hash"] = None


UI_STMT = (
    "Read-only /app browse screens for grant-scoped catalogs within a project: catalog list (title, primary "
    "imprint, control count), imprint detail with controls grouped by family and conforming-line counts, and "
    "control detail (statement + conforming requirement/capability chips). Uses catalogs read API; restricted "
    "catalogs follow API 404/redaction. Safe DOM (textContent only); Catalogs project tab in header nav."
)
UI_ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/web/public/browse-catalogs.js",
    f"{REPO}/apps/reqalm/src/web/public/browse.js",
    f"{REPO}/apps/reqalm/src/web/public/browse-core.js",
    f"{REPO}/apps/reqalm/src/web/public/browse-relations.js",
    f"{REPO}/apps/reqalm/src/web/public/shell-nav.js",
    f"{REPO}/apps/reqalm/src/web/public/styles.css",
    f"{REPO}/apps/reqalm/src/web/spa-shell-paths.ts",
    f"{REPO}/apps/reqalm/src/web/browse-ui.test.ts",
    f"{REPO}/docs/design/seed/scripts/patch_browse_ui_catalogs_release.py",
]


def add_browse_ui_catalogs(data) -> None:
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP_UI,
            project_id="reqalm",
            parent="SEC-CP",
            kind="capability",
            title="Browse catalogs UI (read-only)",
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
            security={"catalog_ref": "CM-2", "verification_note": "Planned until catalogs browse UI PR merges."},
            statement_hash=statement_hash(UI_STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-browse-ui-catalogs",
            subject_kind="CapabilityLine",
            base_uid=CAP_UI,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for catalogs browse UI PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP_UI]
    for to in ("CAP-CATALOGS-API", "CAP-BROWSE-UI-REQS", "CAP-UI-HEADER-NAV", "ARCH-UI-GUARD"):
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
            name="R1 — browse catalogs UI (read-only)",
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP_UI],
            cyber_gate=False,
            notes=f"Catalogs browse screens; ships inherit-uses release at merge {TRACE_INHERIT_MERGE}.",
        ),
    )


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    ship_trace_inherit_uses(data)
    add_browse_ui_catalogs(data)

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(f"Patched dogfood.yaml: shipped {REL_TRACE} @ {TRACE_INHERIT_MERGE}, {REL_UI} / {CAP_UI}")


if __name__ == "__main__":
    main()
