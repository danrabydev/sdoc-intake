#!/usr/bin/env python3
"""Add CAP-READ-ACCESS capability rows for the people/access read API (additions-only; no release edits).

Run: python3 patch_read_access_release.py && python3 yaml_to_strictdoc.py --validate
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
CAP = "CAP-READ-ACCESS"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_baseline_edges import validate_baseline_edges_preserved  # noqa: E402

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
yaml.indent(mapping=2, sequence=2, offset=0)


def cm(**kw):
    m = CommentedMap()
    for k, v in kw.items():
        m[k] = v
    return m


def find(seq, key, val):
    for x in seq or []:
        if x.get(key) == val:
            return x
    return None


def upsert(seq, key, item):
    cur = find(seq, key, item[key])
    if cur is None:
        seq.append(deepcopy(item))
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


def statement_hash(text: str) -> str:
    canon = "\n".join(line.rstrip() for line in text.strip().replace("\r\n", "\n").split("\n"))
    return "sha256:" + hashlib.sha256(canon.encode("utf-8")).hexdigest()


STMT = (
    "Grant-scoped read-only people/access API: project people and grants, client grants, role catalog with "
    "permissions, and platform grants visible only to platform roles. RBAC grant:read; missing/forbidden "
    "project access returns 404; responses omit credential, session, and signing material."
)
ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/modules/access/",
    f"{REPO}/apps/reqalm/src/db/migrations/016_access_read.sql",
    f"{REPO}/apps/reqalm/openapi/openapi.yaml",
    f"{REPO}/docs/design/seed/scripts/patch_read_access_release.py",
]


def apply_patch(data) -> None:
    if find(data.get("requirement_versions"), "uid", CAP):
        validate_baseline_edges_preserved(data)
        return
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-IA",
            kind="capability",
            title="Read people and access (grants, roles, platform)",
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
            security={"catalog_ref": "AC-3", "verification_note": "Planned until people/access read API PR merges."},
            statement_hash=statement_hash(STMT),
            grooming_state="detailed",
        ),
    )
    for to in ("A11", "CAP-RBAC", "CAP-SVC-OPERATION-ROUTE"):
        ensure_edge(data.setdefault("edges", []), {"from": CAP, "to": to, "kind": "satisfies"})
    arts = data.setdefault("capability_artifacts", [])
    data["capability_artifacts"] = [a for a in arts if a.get("requirement_version_uid") != CAP]
    for uri in ARTIFACTS:
        data["capability_artifacts"].append({"requirement_version_uid": CAP, "kind": "other", "uri": uri})
    validate_baseline_edges_preserved(data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--validate-baseline-edges",
        action="store_true",
        help="Load dogfood.yaml and verify baseline outbound edges preserved (no write)",
    )
    args = parser.parse_args()

    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    if args.validate_baseline_edges:
        validate_baseline_edges_preserved(data)
        print("baseline edge preservation ok")
        return

    apply_patch(data)

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(f"Patched dogfood.yaml: added {CAP} capability (no release row changes)")


if __name__ == "__main__":
    main()
