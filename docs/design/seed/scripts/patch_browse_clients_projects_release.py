#!/usr/bin/env python3
"""Ship rel-r1-seed-reset; add rel-r1-browse-clients-projects. Idempotent."""
from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
MERGE = "11499d92c749fed0a69fa40abf76ad3bcce96019"

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


CAP = "CAP-BROWSE-CP"
STMT = (
    "Grant-scoped read APIs: paged GET /api/v1/clients, /clients/:id, /projects, /clients/:id/projects; "
    "shared PageQuery (max 100); invalid slug redaction on /clients/ and /projects/ paths; minimal /app browse pages."
)
ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/core/paging.ts",
    f"{REPO}/apps/reqalm/src/modules/clients/",
    f"{REPO}/apps/reqalm/src/modules/projects/",
    f"{REPO}/apps/reqalm/src/web/public/app.js",
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    rel = find(data.get("releases"), "id", "rel-r1-seed-reset")
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = "2026-10-08"
        rel["notes"] = f"PR #21 merged to main as {MERGE} on 2026-10-08."
    ver = find(data.get("requirement_versions"), "uid", "CAP-DEVENV-SEED-RESET")
    if ver:
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(base_uid=CAP, project_id="reqalm", parent="SEC-CP", kind="capability", title="Browse clients and projects (read-only)"),
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
            security={"catalog_ref": "CM-2", "verification_note": "Planned until browse PR merges."},
            statement_hash=statement_hash(STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-browse-cp",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for browse-clients-projects PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    for to in ("B07", "B08", "ARCH-CP-HIER", "CAP-SVC-PROJECT-READ", "ARCH-UI"):
        ensure_edge(edges, {"from": CAP, "to": to, "kind": "satisfies"})
    arts = data.setdefault("capability_artifacts", [])
    for uri in ARTIFACTS:
        if not any(a.get("requirement_version_uid") == CAP and a.get("uri") == uri for a in arts):
            arts.append({"requirement_version_uid": CAP, "kind": "other", "uri": uri})

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id="rel-r1-browse-clients-projects",
            project_id="reqalm",
            name="R1 — browse clients and projects (read-only)",
            planned_on="2026-10-08",
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes="Read-only grant-scoped client/project APIs and minimal /app list pages. Not B01–B06 mutations or ARCH-CP-SCOPE RLS.",
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print("Patched dogfood.yaml")


if __name__ == "__main__":
    main()
