#!/usr/bin/env python3
"""Ship rel-r1-browse-ui-contracts (#45 @ main); add planned rel-r1-rbac-authorize-fail-closed. Idempotent.

Run: python3 patch_rbac_authorize_fail_closed_release.py && python3 yaml_to_strictdoc.py --validate
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
SHIPPED_DATE = "2026-10-10"
BROWSE_UI_MERGE = "86d315462b67446e605d6c898c15df2c8066b5d3"
CAP_UI = "CAP-BROWSE-UI-CONTRACTS"
REL_UI = "rel-r1-browse-ui-contracts"
PLANNED = SHIPPED_DATE
CAP = "CAP-SVC-RBAC-NO-PROJECT"
REL = "rel-r1-rbac-authorize-fail-closed"

BASELINE_RECORD_ALLOW_VERSIONS = frozenset({CAP_UI, CAP})
BASELINE_RECORD_ALLOW_RELEASES = frozenset({REL_UI, REL})

EXPECTED_LINES = 458
EXPECTED_VERSIONS = 491
EXPECTED_EDGES = 1953

sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_baseline_edges import (  # noqa: E402
    validate_baseline_edges_preserved,
    validate_baseline_records_preserved,
)

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
    "authorize() and listActiveRoles() fail closed when no project id is supplied: project_grants roles apply "
    "only when projectId matches; permissions other than platform Key custodian key:manage and audit:read are "
    "denied without a project scope, so a route that omits projectScoped cannot authorize via another project's grant."
)
ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/rbac/enforce.ts",
    f"{REPO}/apps/reqalm/src/rbac/enforce.test.ts",
    f"{REPO}/docs/design/seed/scripts/patch_rbac_authorize_fail_closed_release.py",
]


def ship_browse_ui_contracts_release(data) -> None:
    """Ship PR #45 contracts browse UI at full main merge SHA (this PR's seed patch)."""
    rel = find(data.get("releases"), "id", REL_UI)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = SHIPPED_DATE
        rel["notes"] = (
            f"PR #45 merged to main as {BROWSE_UI_MERGE} on {SHIPPED_DATE}. "
            "Read-only /app contracts list and detail; Contracts project tab."
        )
    ver = find(data.get("requirement_versions"), "uid", CAP_UI)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "AC-3")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {
            "catalog_ref": catalog_ref,
            "verification_note": f"Shipped with contracts browse UI PR #45 (merge {BROWSE_UI_MERGE}).",
        }
    ar = find(data.get("approval_records"), "id", "ar-browse-ui-contracts")
    if ar:
        ar["status"] = "unapproved"
        ar["notes"] = (
            f"Capability active with verification pass after PR #45 merge {BROWSE_UI_MERGE}; "
            "formal approval record not filed in seed."
        )
        ar["approved_version_uid"] = None
        ar["approved_statement_hash"] = None


def add_rbac_fail_closed(data) -> None:
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-SEC",
            kind="capability",
            title="RBAC authorize fails closed without project scope",
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
            security={
                "catalog_ref": "AC-3",
                "verification_note": "Planned until RBAC authorize fail-closed PR merges.",
            },
            statement_hash=statement_hash(STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-rbac-no-project",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for RBAC authorize fail-closed PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP]
    for to in ("ARCH-API-RBAC", "CAP-RBAC", "CAP-SVC-OPERATION-EXECUTOR"):
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
            name="R1 — RBAC authorize fail closed (no project scope)",
            planned_on=PLANNED,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=True,
            notes=(
                "Security hardening: listActiveRoles without projectId must not union all project grants; "
                "authorize denies project-bound permissions unless projectId is set. Planned until merge."
            ),
        ),
    )


def apply_patch(data) -> None:
    ship_browse_ui_contracts_release(data)
    add_rbac_fail_closed(data)
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
        f"Patched dogfood.yaml: shipped {REL_UI} @ {BROWSE_UI_MERGE}, planned {REL} / {CAP}, "
        f"lines={lines} versions={vers} edges={edge_c}"
    )


if __name__ == "__main__":
    main()
