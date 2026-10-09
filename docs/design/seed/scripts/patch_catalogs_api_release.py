#!/usr/bin/env python3
"""Ship rel-r1-lf-endings (PR #35); add rel-r1-catalogs-api / CAP-CATALOGS-API. Idempotent."""
from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
PLANNED = "2026-10-09"
LF_SHIPPED = "2026-10-09"
LF_MERGE_SHA = "5cac83400c5c0fe9b2b4c54db408f5850821c395"
CAP_LF = "CAP-DEVENV-LF-ENDINGS"
REL_LF = "rel-r1-lf-endings"
CAP = "CAP-CATALOGS-API"
REL = "rel-r1-catalogs-api"

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


def ship_lf_endings(data) -> None:
    rel = find(data.get("releases"), "id", REL_LF)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = LF_SHIPPED
        rel["notes"] = (
            f"PR #35 merged to main as {LF_MERGE_SHA} on {LF_SHIPPED}. "
            "Root .gitattributes + Windows core.autocrlf=true checkout verification; Compose entrypoints stay LF."
        )

    ver = find(data.get("requirement_versions"), "uid", CAP_LF)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "CM-2")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {
            "catalog_ref": catalog_ref,
            "verification_note": (
                f"Shipped with Git LF line endings PR #35 (merge {LF_MERGE_SHA}); "
                "Windows core.autocrlf=true checkout test confirms shell entrypoints remain LF."
            ),
        }

    ar = find(data.get("approval_records"), "id", "ar-lf-endings")
    if ar:
        ar["status"] = "unapproved"
        ar["notes"] = (
            f"Capability active with verification pass after PR #35 merge {LF_MERGE_SHA}; "
            "formal approval record not filed in seed."
        )
        ar["approved_version_uid"] = None
        ar["approved_statement_hash"] = None


STMT = (
    "Grant-scoped read-only catalogs API under /api/v1/projects/:projectId/catalogs: list visible catalogs "
    "with imprints (version label, status); paged controls for an imprint (id, title, family, conforming_count "
    "scoped to the project); control detail (title, statement text, conforming project lines with direct or "
    "version-pin link). Private catalogs 404 like unknown without a grant on the owning project. Dogfood seed "
    "loads catalog metadata, imprint labels, and conforms_to trace edges."
)
ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/db/migrations/010_catalog_read.sql",
    f"{REPO}/apps/reqalm/src/seed/catalog-labels.ts",
    f"{REPO}/apps/reqalm/src/modules/catalogs/",
    f"{REPO}/apps/reqalm/openapi/openapi.yaml",
    f"{REPO}/docs/design/seed/scripts/patch_catalogs_api_release.py",
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    ship_lf_endings(data)

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-CAT",
            kind="capability",
            title="Read catalogs and controls (catalogs API)",
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
            security={"catalog_ref": "AC-3", "verification_note": "Planned until catalogs read API PR merges."},
            statement_hash=statement_hash(STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-catalogs-api",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for catalogs read API PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP]
    for to in ("H09", "ARCH-CAT-SCOPE", "ARCH-API-RBAC", "CAP-READ-REQS", "CAP-SVC-OPERATION-ROUTE", "C08"):
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
            name="R1 — catalogs read API",
            planned_on=PLANNED,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes="Read-only catalogs/imprints/controls endpoints; browse UI deferred.",
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(f"Patched dogfood.yaml: shipped {REL_LF}, {REL} / {CAP}")


if __name__ == "__main__":
    main()
