#!/usr/bin/env python3
"""Add rel-r1-read-contracts / CAP-READ-CONTRACTS (contracts read API). Idempotent.

Requires PR #44 (migration + loader seed). Does not ship rel-r1-contracts-loader (ship after #44 squash-merge SHA).
Refreshes ctr-reqalm-product scope after edits.
Run: python3 patch_read_contracts_release.py && python3 yaml_to_strictdoc.py --validate
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
PLANNED = "2026-10-10"
CAP = "CAP-READ-CONTRACTS"
REL = "rel-r1-read-contracts"
CAP_BROWSE = "CAP-BROWSE-UI-CATALOGS"
REL_BROWSE = "rel-r1-browse-ui-catalogs"
MAINT_CONTRACT = "ctr-reqalm-maintenance"
DRAFT_SCOPE_EXCLUDE_UIDS = frozenset(
    {
        "ARCH-KEY-SCOPE.1",
        "ARCH-ATTACH-PIN-VERSION.1",
        "ARCH-ATTACH-SCOPE.1",
        "ARCH-ATTACH-ENCRYPT.1",
    }
)

BASELINE_RECORD_ALLOW_VERSIONS = frozenset({CAP_BROWSE})
BASELINE_RECORD_ALLOW_RELEASES = frozenset({REL_BROWSE})

sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_baseline_edges import (  # noqa: E402
    validate_baseline_edges_preserved,
    validate_baseline_records_preserved,
)
from patch_reqalm_contracts_release import (  # noqa: E402
    find,
    reqalm_product_contract_scope,
    reqalm_release_ids,
    upsert_contracts,
)

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 1200
yaml.indent(mapping=2, sequence=2, offset=0)


def cm(**kw):
    m = CommentedMap()
    for k, v in kw.items():
        m[k] = v
    return m


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
    "Grant-scoped read-only contracts API under /api/v1/projects/:projectId/contracts: paged list with scope and "
    "release counts; detail; paged in_scope_of scope lines (uid, base, kind, status, version) with cross-project "
    "lines omitted when the caller lacks requirement:read on the line project; covers_releases release summaries. "
    "RBAC contract:read mirrors requirement:read roles; missing/forbidden contract access returns 404."
)
ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/modules/contracts/",
    f"{REPO}/apps/reqalm/openapi/openapi.yaml",
    f"{REPO}/docs/design/seed/scripts/patch_read_contracts_release.py",
]


def refresh_product_contract(data) -> None:
    maint = find(data.get("contracts"), "id", MAINT_CONTRACT)
    maint_uids = list(maint.get("in_scope_of") or []) if maint else []
    scope = reqalm_product_contract_scope(data, maint_in_scope=set(maint_uids))
    pins: set[str] = set()
    for uid in scope:
        if uid in DRAFT_SCOPE_EXCLUDE_UIDS:
            ver = find(data.get("requirement_versions"), "uid", uid)
            if ver and ver.get("base_uid"):
                pins.add(str(ver["base_uid"]))
            continue
        pins.add(str(uid))
    upsert_contracts(
        data,
        product_delivers=sorted(pins),
        product_releases=reqalm_release_ids(data),
        maint_uids=maint_uids,
    )


def add_read_contracts_release(data) -> None:
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-CP",
            kind="capability",
            title="Read contracts (list, detail, scope, releases)",
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
            security={"catalog_ref": "AC-3", "verification_note": "Planned until contracts read API PR merges."},
            statement_hash=statement_hash(STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-read-contracts",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for contracts read API PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP]
    for to in ("F10", "ARCH-CONTRACT.1", "CAP-SVC-OPERATION-ROUTE", "CAP-READ-REQS"):
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
            name="R1 — contracts read API",
            planned_on=PLANNED,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes="Read-only contracts API (depends on CAP-CONTRACTS-LOADER / rel-r1-contracts-loader).",
        ),
    )


def apply_patch(data) -> None:
    add_read_contracts_release(data)
    refresh_product_contract(data)
    validate_baseline_records_preserved(
        data,
        allow_version_uids=BASELINE_RECORD_ALLOW_VERSIONS,
        allow_release_ids=BASELINE_RECORD_ALLOW_RELEASES,
    )
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
    product = find(data.get("contracts"), "id", "ctr-reqalm-product")
    scope_n = len(product.get("in_scope_of") or []) if product else 0
    print(f"Patched dogfood.yaml: planned {REL} / {CAP} (product scope {scope_n} uids)")


if __name__ == "__main__":
    main()
