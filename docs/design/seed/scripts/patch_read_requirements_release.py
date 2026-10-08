#!/usr/bin/env python3
"""Add rel-r1-read-requirements (does not modify rel-r1-browse-clients-projects)."""
from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."

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


CAP = "CAP-READ-REQS"
STMT = (
    "Grant-scoped requirements read APIs: paged GET /api/v1/projects/:projectId/requirements with filters "
    "(kind, type, status, q) and current-version summaries; GET detail (statement + version attributes); "
    "GET version history (newest first). listScope pipeline supplies allowedProjectIds for browse lists; "
    "trace edges are not persisted in the seed loader yet (deferred). Invalid requirement id segments "
    "redact in logs/spans like client/project slugs."
)
ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/core/operation.ts",
    f"{REPO}/apps/reqalm/src/core/paging.ts",
    f"{REPO}/apps/reqalm/src/rbac/enforce.ts",
    f"{REPO}/apps/reqalm/src/http/project-id.ts",
    f"{REPO}/apps/reqalm/src/modules/requirements/",
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-CP",
            kind="capability",
            title="Read requirements (list, detail, versions)",
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
            security={"catalog_ref": "AC-3", "verification_note": "Planned until requirements read PR merges."},
            statement_hash=statement_hash(STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-read-reqs",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for requirements read API PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP]
    for to in ("C08", "C06", "ARCH-API-RBAC", "CAP-SVC-OPERATION-ROUTE", "CAP-RBAC"):
        ensure_edge(data["edges"], {"from": CAP, "to": to, "kind": "satisfies"})
    arts = data.setdefault("capability_artifacts", [])
    data["capability_artifacts"] = [a for a in arts if a.get("requirement_version_uid") != CAP]
    for uri in ARTIFACTS:
        data["capability_artifacts"].append({"requirement_version_uid": CAP, "kind": "other", "uri": uri})

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id="rel-r1-read-requirements",
            project_id="reqalm",
            name="R1 — requirements read API",
            planned_on="2026-10-08",
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes="Read-only project-scoped requirement list/detail/versions HTTP APIs (no trace edges in DB yet).",
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print("Patched dogfood.yaml")


if __name__ == "__main__":
    main()
