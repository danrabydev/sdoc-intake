#!/usr/bin/env python3
"""Ship rel-r1-read-contracts (PR #43 @ main); add planned rel-r1-browse-ui-contracts. Idempotent."""
from __future__ import annotations

import argparse
import hashlib
import sys
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

_SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPTS))
from seed_baseline_edges import (  # noqa: E402
    validate_baseline_edges_preserved,
    validate_baseline_records_preserved,
)

SEED = _SCRIPTS.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
SHIPPED_DATE = "2026-10-10"
READ_CONTRACTS_MERGE = "aa7e85631819d45ac04852831ab305d655f1eddd"
CAP_API = "CAP-READ-CONTRACTS"
REL_API = "rel-r1-read-contracts"
CAP_UI = "CAP-BROWSE-UI-CONTRACTS"
REL_UI = "rel-r1-browse-ui-contracts"

BASELINE_RECORD_ALLOW_VERSIONS = frozenset({CAP_API})
BASELINE_RECORD_ALLOW_RELEASES = frozenset({REL_API})

EXPECTED_LINES = 457
EXPECTED_VERSIONS = 490
EXPECTED_EDGES = 1950

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
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
        seq.append(deepcopy(item))
        return 1
    for k, v in item.items():
        if k == "statement":
            continue
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
    return 0


def ensure_edge(edges, edge):
    for e in edges:
        if (e.get("from"), e.get("to"), e.get("kind")) == (edge.get("from"), edge.get("to"), edge.get("kind")):
            return 0
    edges.append(deepcopy(edge))
    return 1


def ship_read_contracts_release(data) -> None:
    """Ship PR #43 contracts read API at full main merge SHA (this PR's seed patch)."""
    rel = find(data.get("releases"), "id", REL_API)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = SHIPPED_DATE
        rel["notes"] = (
            f"PR #43 merged to main as {READ_CONTRACTS_MERGE} on {SHIPPED_DATE}. "
            "Grant-scoped read-only contracts API (list, detail, scope, releases)."
        )
    ver = find(data.get("requirement_versions"), "uid", CAP_API)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "AC-3")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {
            "catalog_ref": catalog_ref,
            "verification_note": f"Shipped with contracts read API PR #43 (merge {READ_CONTRACTS_MERGE}).",
        }
    ar = find(data.get("approval_records"), "id", "ar-read-contracts")
    if ar:
        ar["status"] = "unapproved"
        ar["notes"] = (
            f"Capability active with verification pass after PR #43 merge {READ_CONTRACTS_MERGE}; "
            "formal approval record not filed in seed."
        )
        ar["approved_version_uid"] = None
        ar["approved_statement_hash"] = None


UI_STMT = (
    "Read-only /app browse screens for grant-scoped contracts within a project: contract list (title, scope and "
    "release counts), contract detail with in_scope_of lines linking to requirement/capability detail and "
    "covers_releases linking to release detail. Uses contracts read API; restricted/missing contracts follow API "
    "404. Safe DOM (textContent only); Contracts project tab in header nav. Document view and overlap timeline "
    "deferred (mockups 02–03; no read API yet)."
)
UI_ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/web/public/browse-contracts.js",
    f"{REPO}/apps/reqalm/src/web/public/browse.js",
    f"{REPO}/apps/reqalm/src/web/public/shell-nav.js",
    f"{REPO}/apps/reqalm/src/web/spa-shell-paths.ts",
    f"{REPO}/apps/reqalm/src/web/browse-ui.test.ts",
    f"{REPO}/docs/design/seed/scripts/patch_browse_ui_contracts_release.py",
]


def add_browse_ui_contracts(data) -> None:
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP_UI,
            project_id="reqalm",
            parent="SEC-CP",
            kind="capability",
            title="Browse contracts UI (read-only)",
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
            security={"catalog_ref": "AC-3", "verification_note": "Planned until contracts browse UI PR merges."},
            statement_hash=statement_hash(UI_STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-browse-ui-contracts",
            subject_kind="CapabilityLine",
            base_uid=CAP_UI,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for contracts browse UI PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP_UI]
    for to in ("CAP-READ-CONTRACTS", "CAP-BROWSE-UI-REQS", "CAP-UI-HEADER-NAV", "CAP-CONTRACT-UI", "ARCH-UI-GUARD"):
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
            name="R1 — browse contracts UI (read-only)",
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP_UI],
            cyber_gate=False,
            notes=(
                f"Contracts browse screens; ships read API release at merge {READ_CONTRACTS_MERGE} "
                f"({SHIPPED_DATE})."
            ),
        ),
    )


def apply_patch(data) -> None:
    ship_read_contracts_release(data)
    add_browse_ui_contracts(data)
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

    lines = len(data.get("requirement_lines") or [])
    vers = len(data.get("requirement_versions") or [])
    edge_c = len(data.get("edges") or [])
    if (lines, vers, edge_c) != (EXPECTED_LINES, EXPECTED_VERSIONS, EXPECTED_EDGES):
        print(
            f"COUNT MISMATCH: lines={lines} (expected {EXPECTED_LINES}), "
            f"versions={vers} (expected {EXPECTED_VERSIONS}), edges={edge_c} (expected {EXPECTED_EDGES})",
            file=sys.stderr,
        )
        sys.exit(1)

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(
        f"Patched dogfood.yaml: shipped {REL_API} @ {READ_CONTRACTS_MERGE}, planned {REL_UI} / {CAP_UI}, "
        f"lines={lines} versions={vers} edges={edge_c}"
    )


if __name__ == "__main__":
    main()
