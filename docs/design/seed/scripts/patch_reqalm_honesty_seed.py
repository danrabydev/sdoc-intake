#!/usr/bin/env python3
"""Seed-only ReqALM honesty @ main 341330f — mint partial tips + browse UI wording only.

Adds only: CAP-RBAC.2, CAP-UI-FRAME.3, CAP-BROWSE-UI-CP.2, CAP-REQALM-HONESTY,
rel-r1-reqalm-honesty-seed (planned). Does not rewrite shipped release delivers,
v0 statements, or existing edges (copy outbound links onto new tips).

Run: python3 patch_reqalm_honesty_seed.py && python3 yaml_to_strictdoc.py --validate
"""
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
EVIDENCE_MAIN = "341330fc8d43f2144193f1008503eacb7cfea903"
PLANNED_DATE = "2026-10-10"
REL = "rel-r1-reqalm-honesty-seed"
CAP = "CAP-REQALM-HONESTY"

BASELINE_RECORD_ALLOW_VERSIONS = frozenset(
    {
        "CAP-RBAC.1",
        "CAP-RBAC.2",
        "CAP-UI-FRAME.2",
        "CAP-UI-FRAME.3",
        "CAP-BROWSE-UI-CP.1",
        "CAP-BROWSE-UI-CP.2",
        CAP,
    }
)
BASELINE_RECORD_ALLOW_RELEASES = frozenset({REL})

# Filled after first successful apply (run patch once to print, then pin).
EXPECTED_LINES = 462
EXPECTED_VERSIONS = 498
EXPECTED_EDGES = 1985

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


def append_version(data, item) -> bool:
    """Insert version row only if uid is missing."""
    uid = item["uid"]
    if find(data.get("requirement_versions"), "uid", uid):
        return False
    stmt = item.get("statement")
    if stmt and "statement_hash" not in item:
        item = dict(item)
        item["statement_hash"] = statement_hash(stmt)
    data.setdefault("requirement_versions", []).append(deepcopy(item))
    return True


def append_line(data, item) -> bool:
    if find(data.get("requirement_lines"), "base_uid", item["base_uid"]):
        return False
    data.setdefault("requirement_lines", []).append(deepcopy(item))
    return True


def edge_key(edge):
    return (
        edge.get("from"),
        edge.get("to"),
        edge.get("kind"),
        edge.get("catalog_imprint_id"),
    )


def append_edge(edges, edge) -> bool:
    for e in edges:
        if edge_key(e) == edge_key(edge):
            return False
    edges.append(deepcopy(edge))
    return True


def mint_pending_successor(
    data,
    predecessor_uid: str,
    new_uid: str,
    *,
    statement: str | None = None,
    verification_note: str,
    verification_outcome: str = "pending",
    copy_kinds: tuple[str, ...] = ("satisfies", "conforms_to", "uses"),
) -> None:
    if find(data.get("requirement_versions"), "uid", new_uid):
        return
    pred = find(data.get("requirement_versions"), "uid", predecessor_uid)
    if not pred or pred.get("status") != "active":
        return
    base_uid = pred["base_uid"]
    new_n = int(new_uid.rsplit(".", 1)[-1])
    stmt = statement if statement is not None else str(pred.get("statement") or "")
    pred["status"] = "superseded"
    sec = deepcopy(pred.get("security") or {"catalog_ref": "CM-2"})
    sec["verification_note"] = verification_note
    ver = cm(
        uid=new_uid,
        base_uid=base_uid,
        version_n=new_n,
        status="active",
        statement=stmt,
        priority=pred.get("priority", 10),
        iteration=pred.get("iteration", "iter-r1"),
        security=sec,
        statement_hash=statement_hash(stmt),
        grooming_state=pred.get("grooming_state", "detailed"),
        mint_kind="content",
        verification_outcome=verification_outcome,
    )
    if pred.get("rbac_op"):
        ver["rbac_op"] = pred["rbac_op"]
    append_version(data, ver)
    edges = data.setdefault("edges", [])
    append_edge(edges, {"from": new_uid, "to": predecessor_uid, "kind": "refines"})
    for e in edges:
        if e.get("from") != predecessor_uid or e.get("kind") not in copy_kinds:
            continue
        copied = {
            k: v
            for k, v in e.items()
            if k in ("to", "kind", "catalog_imprint_id", "inheritable", "trace_suspect", "suspect_reason")
        }
        copied["from"] = new_uid
        append_edge(edges, copied)


CAP_BROWSE_UI_CP_V2_STMT = (
    "Read-only /app browse screens for grant-scoped clients and projects: paged clients list, client detail "
    "with projects, all-projects list with client name, and a project landing page linking into Requirements "
    "(list and tree), Releases, and Catalogs browse routes (no longer stubbed as coming next). Uses existing "
    "session/CSRF auth; API data rendered via safe DOM text only. Layout: Clients entry lists grant-scoped "
    "clients; row opens client detail with projects table; All projects lists cross-client projects with client "
    "name; project page shows navigation links into shipped browse surfaces. Header uses global Clients/Projects "
    "nav outside project tabs."
)

CAP_RBAC_V2_NOTE = (
    "Honesty mint .2 @ main 341330f: partial verification only — OAuth + defineOperationRoute read routes "
    "verified; grant mutators and full matrix remain unverified (pending)."
)

CAP_UI_FRAME_V3_NOTE = (
    "Honesty mint .3 @ main 341330f: partial verification — header-only shell and grant-scoped browse reads "
    "shipped; full ARCH-UI / planning / trace surfaces not verified on this tip."
)


def add_honesty_capability_and_release(data) -> None:
    if find(data.get("releases"), "id", REL):
        return
    stmt = (
        "Documentation-only seed pass on main @ 341330f: mints CAP-RBAC.2 and CAP-UI-FRAME.3 as pending partial "
        "tips, CAP-BROWSE-UI-CP.2 browse wording, without changing application code. Release state ships in a "
        "follow-on seed commit after merge."
    )
    append_line(
        data,
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-GROOM",
            kind="capability",
            title="ReqALM seed honesty (capability status vs code)",
        ),
    )
    append_version(
        data,
        cm(
            uid=CAP,
            base_uid=CAP,
            version_n=0,
            status="draft",
            statement=stmt,
            priority=10,
            iteration="iter-r1",
            security={
                "catalog_ref": "CM-2",
                "verification_note": "Planned until honesty seed PR merges; no verification pass in this patch.",
            },
            statement_hash=statement_hash(stmt),
            grooming_state="detailed",
        ),
    )
    if not find(data.get("approval_records"), "id", "ar-reqalm-honesty"):
        data.setdefault("approval_records", []).append(
            cm(
                id="ar-reqalm-honesty",
                subject_kind="CapabilityLine",
                base_uid=CAP,
                status="unapproved",
                by=None,
                at=None,
                notes=f"Planned seed-only honesty @ {EVIDENCE_MAIN[:12]}.",
                approved_version_uid=None,
                approved_statement_hash=None,
            )
        )
    for uri in (
        f"{REPO}/docs/design/seed/dogfood.yaml",
        f"{REPO}/docs/design/seed/scripts/patch_reqalm_honesty_seed.py",
    ):
        arts = data.setdefault("capability_artifacts", [])
        if not any(a.get("requirement_version_uid") == CAP and a.get("uri") == uri for a in arts):
            arts.append({"requirement_version_uid": CAP, "kind": "other", "uri": uri})
    append_edge(data.setdefault("edges", []), {"from": CAP, "to": "K03", "kind": "satisfies"})
    data.setdefault("releases", []).append(
        cm(
            id=REL,
            project_id="reqalm",
            name="R1 — ReqALM seed honesty",
            planned_on=PLANNED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes=(
                f"Planned seed-only PR; capability/release state documents honesty mints vs main @ {EVIDENCE_MAIN}. "
                "Ship in a separate seed commit after merge."
            ),
        )
    )


def apply_patch(data) -> None:
    mint_pending_successor(data, "CAP-RBAC.1", "CAP-RBAC.2", verification_note=CAP_RBAC_V2_NOTE)
    mint_pending_successor(data, "CAP-UI-FRAME.2", "CAP-UI-FRAME.3", verification_note=CAP_UI_FRAME_V3_NOTE)
    mint_pending_successor(
        data,
        "CAP-BROWSE-UI-CP.1",
        "CAP-BROWSE-UI-CP.2",
        statement=CAP_BROWSE_UI_CP_V2_STMT,
        verification_note="Honesty mint .2 @ main 341330f: project page links to shipped reqs/releases/catalogs browse.",
        verification_outcome="pass",
    )
    add_honesty_capability_and_release(data)
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

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(
        f"Patched dogfood.yaml: {REL} (planned), mints CAP-RBAC.2 CAP-UI-FRAME.3 CAP-BROWSE-UI-CP.2, "
        f"lines={lines} versions={vers} edges={edge_c}"
    )
    if (lines, vers, edge_c) != (EXPECTED_LINES, EXPECTED_VERSIONS, EXPECTED_EDGES):
        print(
            f"COUNT MISMATCH: lines={lines} (expected {EXPECTED_LINES}), "
            f"versions={vers} (expected {EXPECTED_VERSIONS}), edges={edge_c} (expected {EXPECTED_EDGES})",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
