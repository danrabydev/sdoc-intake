#!/usr/bin/env python3
"""Ship rel-r1-browse-ui-catalogs (#41 @ main); add rel-r1-contracts-loader / CAP-CONTRACTS-LOADER. Idempotent.

Persists dogfood contracts via migration 012 + load-dogfood loader only (read API is a follow-on PR).
Run: python3 patch_contracts_loader_release.py && python3 yaml_to_strictdoc.py --validate
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
SHIPPED_DATE = "2026-10-09"
CATALOGS_MERGE = "cbee54e9484d89430b461789052cea296e1669c5"
CAP_UI = "CAP-BROWSE-UI-CATALOGS"
REL_UI = "rel-r1-browse-ui-catalogs"
PLANNED = "2026-10-10"
CAP = "CAP-CONTRACTS-LOADER"
REL = "rel-r1-contracts-loader"

BASELINE_RECORD_ALLOW_VERSIONS = frozenset({CAP_UI})
BASELINE_RECORD_ALLOW_RELEASES = frozenset({REL_UI})

sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_baseline_edges import (  # noqa: E402
    validate_baseline_edges_preserved,
    validate_baseline_records_preserved,
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


def ship_browse_ui_catalogs_release(data) -> None:
    """Ship PR #41 browse catalogs release at full main merge SHA (this PR's seed patch)."""
    rel = find(data.get("releases"), "id", REL_UI)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = SHIPPED_DATE
        rel["notes"] = (
            f"PR #41 merged to main as {CATALOGS_MERGE} on {SHIPPED_DATE}. "
            "Read-only catalogs browse screens; Catalogs project tab in header nav."
        )
    ver = find(data.get("requirement_versions"), "uid", CAP_UI)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "CM-2")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {
            "catalog_ref": catalog_ref,
            "verification_note": f"Shipped with catalogs browse UI PR #41 (merge {CATALOGS_MERGE}).",
        }
    ar = find(data.get("approval_records"), "id", "ar-browse-ui-catalogs")
    if ar:
        ar["status"] = "unapproved"
        ar["notes"] = (
            f"Capability active with verification pass after PR #41 merge {CATALOGS_MERGE}; "
            "formal approval record not filed in seed."
        )
        ar["approved_version_uid"] = None
        ar["approved_statement_hash"] = None


STMT = (
    "Dogfood loader persists contract overlays from dogfood.yaml into Postgres: contracts, contract_scope, "
    "and contract_releases (migration 012_contracts_read.sql). Validates in_scope_of version uids and "
    "covers_releases release ids; allows cross-project scope lines anchored on the contract project_id. "
    "Seed reset deletes contract junction rows before releases (FK-safe). No HTTP read API in this release."
)
ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/db/migrations/012_contracts_read.sql",
    f"{REPO}/apps/reqalm/src/seed/load-dogfood.ts",
    f"{REPO}/docs/design/seed/scripts/patch_contracts_loader_release.py",
]


def add_contracts_loader(data) -> None:
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-CP",
            kind="capability",
            title="Persist contracts from dogfood (migration + loader)",
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
            security={"catalog_ref": "AC-3", "verification_note": "Planned until contracts loader PR merges."},
            statement_hash=statement_hash(STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-contracts-loader",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for contracts storage/loader PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP]
    for to in ("F10", "ARCH-CONTRACT.1", "CAP-SVC-OPERATION-ROUTE"):
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
            name="R1 — contracts loader (DB + seed)",
            planned_on=PLANNED,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes="Migration 012 + dogfood loader for contract_scope / contract_releases; no read API.",
        ),
    )


def apply_patch(data) -> None:
    ship_browse_ui_catalogs_release(data)
    add_contracts_loader(data)
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
    print(
        f"Patched dogfood.yaml: shipped {REL_UI} @ {CATALOGS_MERGE}, planned {REL} / {CAP}"
    )


if __name__ == "__main__":
    main()
