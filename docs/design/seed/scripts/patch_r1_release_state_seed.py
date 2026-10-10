#!/usr/bin/env python3
"""Seed-only release state @ main d54c5a6: ship RBAC fail-closed (#46); start three parallel tracks.

Idempotent. Does not touch application code. Run:
  python3 patch_r1_release_state_seed.py && python3 yaml_to_strictdoc.py --validate
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
RBAC_MERGE = "d54c5a67235fd56e49bdbc2a939dce89ff5a4f36"
CAP_RBAC = "CAP-SVC-RBAC-NO-PROJECT"
REL_RBAC = "rel-r1-rbac-authorize-fail-closed"

TRACKS = (
    (
        "rel-r1-planning-read-api",
        "CAP-READ-PLANNING",
        "R1 — planning read API",
        "Planning read API (grant-scoped GET routes for backlog / iteration / work-item views). "
        "Not implemented in this release; capability statement will tighten when the feature PR lands.",
        "bc-a71c6948",
        ("ARCH-BROWSE-ROADMAP", "ARCH-PLANNING-GATES"),
    ),
    (
        "rel-r1-artifacts-read-api",
        "CAP-READ-ARTIFACTS",
        "R1 — capability artifacts read API",
        "Read API for capability_artifacts (list/detail by requirement version). "
        "Not implemented in this release; honest placeholder until artifacts read PR merges.",
        "bc-72846206",
        ("ARCH-ATTACH-PIN-VERSION", "CAP-ATTACH-READ"),
    ),
    (
        "rel-r1-hardening-followup-1",
        "CAP-SVC-HARDENING-FOLLOWUP",
        "R1 — hardening follow-up (no-project gate, fetchAllScope, test kit)",
        "Follow-up hardening after RBAC fail-closed: explicit !projectId gate on routes that must not infer scope, "
        "bound fetchAllScope pagination in browse test kits, and rename shared contract browse test helpers for clarity. "
        "Work in progress on cloud agent; not shipped.",
        "bc-7132b537",
        ("ARCH-API-RBAC", "CAP-SVC-RBAC-NO-PROJECT"),
    ),
)

BASELINE_RECORD_ALLOW_VERSIONS = frozenset(
    {CAP_RBAC, *(t[1] for t in TRACKS)},
)
BASELINE_RECORD_ALLOW_RELEASES = frozenset({REL_RBAC, *(t[0] for t in TRACKS)})

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


def ship_rbac_fail_closed(data) -> None:
    rel = find(data.get("releases"), "id", REL_RBAC)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = SHIPPED_DATE
        rel["notes"] = (
            f"PR #46 merged to main as {RBAC_MERGE} on {SHIPPED_DATE}. "
            "listActiveRoles without projectId does not union project grants; authorize denies project-bound "
            "permissions unless projectId is set (platform key:manage and audit:read excepted)."
        )
    ver = find(data.get("requirement_versions"), "uid", CAP_RBAC)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "AC-3")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {
            "catalog_ref": catalog_ref,
            "verification_note": f"Shipped with RBAC authorize fail-closed PR #46 (merge {RBAC_MERGE}).",
        }
    ar = find(data.get("approval_records"), "id", "ar-rbac-no-project")
    if ar:
        ar["status"] = "unapproved"
        ar["notes"] = (
            f"Capability active with verification pass after PR #46 merge {RBAC_MERGE}; "
            "formal approval record not filed in seed."
        )
        ar["approved_version_uid"] = None
        ar["approved_statement_hash"] = None


def add_in_progress_track(
    data,
    rel_id: str,
    cap_uid: str,
    rel_name: str,
    stmt: str,
    agent_bc: str,
    satisfies: tuple[str, ...],
    *,
    parent: str = "SEC-CP",
) -> None:
    title = rel_name.split("—", 1)[-1].strip() if "—" in rel_name else rel_name
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(base_uid=cap_uid, project_id="reqalm", parent=parent, kind="capability", title=title),
    )
    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid=cap_uid,
            base_uid=cap_uid,
            version_n=0,
            status="draft",
            statement=stmt,
            priority=10,
            iteration="iter-r1",
            security={
                "catalog_ref": "AC-3",
                "verification_note": f"Started 2026-10-10 (cloud agent {agent_bc}); not shipped.",
            },
            statement_hash=statement_hash(stmt),
            grooming_state="detailed",
        ),
    )
    ar_id = "ar-" + cap_uid.replace("CAP-", "").lower().replace("_", "-")
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id=ar_id,
            subject_kind="CapabilityLine",
            base_uid=cap_uid,
            status="unapproved",
            by=None,
            at=None,
            notes=f"In progress on cloud agent {agent_bc}; approve after merge and verification.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    for to in satisfies:
        kind = "refines" if to.startswith("CAP-") else "satisfies"
        ensure_edge(edges, {"from": cap_uid, "to": to, "kind": kind})
    arts = data.setdefault("capability_artifacts", [])
    patch_uri = f"{REPO}/docs/design/seed/scripts/patch_r1_release_state_seed.py"
    if not any(a.get("requirement_version_uid") == cap_uid and a.get("uri") == patch_uri for a in arts):
        arts.append({"requirement_version_uid": cap_uid, "kind": "other", "uri": patch_uri})

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=rel_id,
            project_id="reqalm",
            name=rel_name,
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[cap_uid],
            cyber_gate=False,
            notes=(
                f"Started 2026-10-10 on cloud agent {agent_bc}. One PR = one release; "
                "capability stays draft until that PR merges and verification passes."
            ),
        ),
    )


def apply_patch(data) -> None:
    ship_rbac_fail_closed(data)
    for rel_id, cap_uid, rel_name, stmt, agent_bc, satisfies in TRACKS:
        add_in_progress_track(data, rel_id, cap_uid, rel_name, stmt, agent_bc, satisfies)
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
    rel_c = len(data.get("releases") or [])

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(
        f"Patched dogfood.yaml: shipped {REL_RBAC} @ {RBAC_MERGE[:12]}, "
        f"started {len(TRACKS)} tracks, lines={lines} versions={vers} edges={edge_c} releases={rel_c}"
    )


if __name__ == "__main__":
    main()
