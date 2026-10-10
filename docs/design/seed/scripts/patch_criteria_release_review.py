#!/usr/bin/env python3
"""Propose capability acceptance criteria completed in release UAT/review. Idempotent. Seed only.

Does not ship a runtime. Draft successors narrow ARCH-REQ-AC-FACET / ARCH-REQ-AC-ROLLUP;
v0 stays active until the project lead accepts the proposal.

Run: python3 patch_criteria_release_review.py && python3 yaml_to_strictdoc.py --validate
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
REL = "rel-r1-criteria-release-review"
CAP = "CAP-CRITERIA-RELEASE-REVIEW"
LEGACY_FIX_REL = "rel-fix-cap-review-uat"

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


def remove_edge(edges, edge):
    before = len(edges)
    edges[:] = [
        e
        for e in edges
        if (e.get("from"), e.get("to"), e.get("kind"))
        != (edge.get("from"), edge.get("to"), edge.get("kind"))
    ]
    return before - len(edges)


def insert_alpha(seq, value: str) -> None:
    if value in seq:
        return
    for i, cur in enumerate(seq):
        if str(cur) > value:
            seq.insert(i, value)
            return
    seq.append(value)


def remove_release(data, release_id: str) -> None:
    data["releases"] = [r for r in data.get("releases") or [] if r.get("id") != release_id]


def remove_version(data, uid: str) -> None:
    vers = data.get("requirement_versions")
    if not vers:
        return
    vers[:] = [v for v in vers if v.get("uid") != uid]


def remove_completions_for_release(data, release_id: str) -> None:
    data["criterion_completions"] = [
        c for c in data.get("criterion_completions") or [] if c.get("release_id") != release_id
    ]


def statement_hash(text: str) -> str:
    canon = "\n".join(line.rstrip() for line in text.strip().replace("\r\n", "\n").split("\n"))
    return "sha256:" + hashlib.sha256(canon.encode("utf-8")).hexdigest()


FACET_1 = (
    "An acceptance criterion (facet) is a verifiable shall-statement attached to exactly one requirement "
    "version or exactly one capability version. Requirement facets and capability facets are separate sets "
    "with separate completion markers: completing a requirement facet does not complete a capability facet. "
    "Facets are not lines and have no trace graph of their own. A child requirement line remains decomposition "
    "(ARCH-HIER-REQ-DECOMP), not a facet."
)
ROLLUP_1 = (
    "Completeness of a requirement rolls up from that requirement version's own facets. Completeness of a "
    "capability rolls up from that capability version's own facets. A facet is complete only when a release "
    "UAT or review records a completion marker for it (ARCH-CRITERION-RELEASE-UAT). A satisfies link, a closed "
    "work item, or verification_outcome on the version does not by itself complete a facet; "
    "verification_outcome and ship gates remain governed by ARCH-VERIFICATION and ARCH-VERIFICATION-GATE. "
    "The parent stays incomplete while any of its facets has no completion marker."
)
UAT = (
    "UAT and review of a release are the completeness gate for acceptance criteria. A completion marker shall "
    "name the criterion, the release, the actor, and the time, and shall be recorded only for a criterion on a "
    "version that release delivers. Work items do not complete criteria. A capability may be delivered in more "
    "than one release; each release review may complete only criteria on versions listed in that release's "
    "delivers snapshot. The capability's criteria are complete when each facet has a completion marker, which may "
    "be recorded in a later release than the first delivery. Exception: when a user carries an unchanged criterion "
    "onto a successor version (ARCH-CAP-REVIEW-COPY), the carried marker may appear on that successor even though "
    "the carrying release did not deliver the successor; the carried marker shall reference copied_from, the "
    "original marker, and the release that originally completed the frozen criterion."
)
COPY = (
    "When a reviewed capability receives a new content version, each criterion on the reviewed version is copied "
    "onto the successor. Criteria on the reviewed version freeze: their statements and completion markers are not "
    "edited after the successor exists. Each copy is a new criterion id with copied_from pointing at the frozen "
    "criterion. A changed criterion (different statement text or statement_hash) shall start with no completion "
    "marker and status open. An unchanged criterion may start open or may carry its prior completion only when "
    "the editor explicitly chooses carry for that criterion; the default when no choice is recorded is reset to "
    "open. Carry is per criterion within one capability revision, not all-or-nothing. A carry choice shall record "
    "who chose, when, and which source marker was carried, and shall be auditable. A user-chosen carry of an "
    "unchanged criterion is an explicit, recorded exemption from re-check under ARCH-TRACE-RECHECK; every other "
    "copied criterion follows re-check until a release UAT or review records a new completion marker."
)
WI_1 = (
    "The initial work-item act compiles a briefing from a capability, not a one-to-one sync from a requirement "
    "version (J02). The briefing shall list the capability's open acceptance criteria and the controls that apply "
    "to the capability (direct, inherited, and hybrid) for implementers. One capability may have many work items, "
    "including across releases, and a work item may cover only part of a capability. Closing, reopening, or "
    "editing a work item does not complete a criterion and does not change the capability statement. Two-way "
    "field push, pull, and conflict merge (J04–J06) are not this initial path."
)
WI_V0 = (
    "Placeholder line for ARCH-WI-COMPILE.1 (draft successor refining J02). Do not activate v0; J02 remains the "
    "active work-item-from-requirement rule until .1 is accepted."
)
CAP_STMT = (
    "Seed and schema only: capability acceptance criteria with completion markers separate from requirement "
    "facets; those markers are written in a release UAT or review, not by a work item; a review that accepts "
    "the implementation and still requires a change freezes criteria on the reviewed version and copies them "
    "onto the successor with per-criterion carry or reset per ARCH-CAP-REVIEW-COPY. No loader or UI in this "
    "release. Fixture lines FIX-CAP-REVIEW and FIX-CAP-REVIEW.1 illustrate copy and carry in statement notes "
    "(no fixture release row)."
)
REQ_STMT = (
    "FIXTURE need used only to show that a requirement facet and a capability facet are different criteria. "
    "Nothing in this line is a product requirement."
)
CAP_V0 = (
    "FIXTURE capability reviewed in UAT before a required successor. One criterion was marked complete in that "
    "review; the review still required a change, so this version's criteria are frozen. Example (seed notes only): "
    "crit-fix-cap-a completed; crit-fix-cap-b left open."
)
CAP_V1 = (
    "FIXTURE successor required by that review. Criteria were copied from FIX-CAP-REVIEW. Example (seed notes only): "
    "unchanged crit-fix-cap-a may carry its completion when the editor chooses carry; open crit-fix-cap-b is copied "
    "without a marker until a later release review completes it."
)
CRIT_REQ = "The need shall remain distinguishable from the capability's own criteria."
CRIT_A = "The implementation shall record who attended the review."
CRIT_B = "The implementation shall keep an unfinished criterion open until a later release review."


def draft_version(uid: str, base: str, n: int, statement: str, *, mint: str | None = None) -> CommentedMap:
    row = cm(
        uid=uid,
        base_uid=base,
        version_n=n,
        status="draft",
        statement=statement,
        priority=15,
        iteration="iter-r1",
        security={
            "catalog_ref": "CM-2",
            "verification_note": "Proposed 2026-10-10 for project-lead review. Not activated.",
        },
        statement_hash=statement_hash(statement),
        grooming_state="detailed",
    )
    if mint:
        row["mint_kind"] = mint
    return row


def apply_patch(data) -> None:
    lines = data.setdefault("requirement_lines", [])
    versions = data.setdefault("requirement_versions", [])
    edges = data.setdefault("edges", [])

    # Idempotent cleanup from earlier patch revisions.
    remove_release(data, LEGACY_FIX_REL)
    remove_completions_for_release(data, LEGACY_FIX_REL)
    remove_version(data, "ARCH-WI-COMPILE")
    remove_edge(edges, {"from": "ARCH-WI-COMPILE", "to": "J02", "kind": "refines"})
    remove_edge(edges, {"from": "CAP-CRITERIA-RELEASE-REVIEW", "to": "ARCH-WI-COMPILE", "kind": "satisfies"})

    product = find(data.get("contracts"), "id", "ctr-reqalm-product")
    if product is not None:
        scope = product.get("in_scope_of") or []
        product["in_scope_of"] = [
            u
            for u in scope
            if u
            not in {
                "ARCH-CAP-REVIEW-COPY",
                "ARCH-CRITERION-RELEASE-UAT",
                "ARCH-WI-COMPILE",
                "ARCH-WI-COMPILE.1",
            }
        ]

    proposals = [
        ("ARCH-REQ-AC-FACET.1", "ARCH-REQ-AC-FACET", 1, FACET_1, "content"),
        ("ARCH-REQ-AC-ROLLUP.1", "ARCH-REQ-AC-ROLLUP", 1, ROLLUP_1, "content"),
    ]
    for uid, base, n, statement, mint in proposals:
        upsert(versions, "uid", draft_version(uid, base, n, statement, mint=mint))

    new_reqs = [
        ("ARCH-CRITERION-RELEASE-UAT", "SEC-RL", "requirement", "Criterion completion is release UAT or review", UAT),
        ("ARCH-CAP-REVIEW-COPY", "SEC-RL", "requirement", "Accepted review that still requires a change", COPY),
    ]
    for uid, parent, kind, title, statement in new_reqs:
        upsert(lines, "base_uid", cm(base_uid=uid, project_id="reqalm", parent=parent, kind=kind, title=title))
        upsert(versions, "uid", draft_version(uid, uid, 0, statement))

    upsert(
        lines,
        "base_uid",
        cm(
            base_uid="ARCH-WI-COMPILE",
            project_id="reqalm",
            parent="SEC-WI",
            kind="requirement",
            title="Work item is a capability briefing, not completeness",
        ),
    )
    upsert(
        versions,
        "uid",
        cm(
            uid="ARCH-WI-COMPILE",
            base_uid="ARCH-WI-COMPILE",
            version_n=0,
            status="draft",
            statement=WI_V0,
            priority=15,
            iteration="iter-r1",
            security={
                "catalog_ref": "CM-2",
                "verification_note": "Placeholder only; active proposal is ARCH-WI-COMPILE.1 refining J02.",
            },
            statement_hash=statement_hash(WI_V0),
            grooming_state="detailed",
        ),
    )
    upsert(
        versions,
        "uid",
        draft_version("ARCH-WI-COMPILE.1", "ARCH-WI-COMPILE", 1, WI_1, mint="content"),
    )

    upsert(
        lines,
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-RL",
            kind="capability",
            title="Capability criteria completed in release review",
        ),
    )
    upsert(versions, "uid", draft_version(CAP, CAP, 0, CAP_STMT))
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-criteria-release-review",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Proposal only. Approve after the project lead accepts the criterion model.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    arts = data.setdefault("capability_artifacts", [])
    patch_uri = f"{REPO}/docs/design/seed/scripts/patch_criteria_release_review.py"
    if not any(a.get("requirement_version_uid") == CAP and a.get("uri") == patch_uri for a in arts):
        arts.append({"requirement_version_uid": CAP, "kind": "other", "uri": patch_uri})

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=REL,
            project_id="reqalm",
            name="R1 — capability criteria completed in release review",
            planned_on=PLANNED,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes=(
                "Suggested seed for project-lead review. Not shipped. Encodes separate capability facets, "
                "UAT/review as the completeness gate, and freeze-and-copy when a review still requires a new "
                "version. FIX-* fixture lines illustrate copy/carry without a fixture release row."
            ),
        ),
    )

    upsert(
        lines,
        "base_uid",
        cm(
            base_uid="FIX-REQ-REVIEW",
            project_id="reqalm",
            parent="SEC-FIX",
            kind="requirement",
            title="Fixture need for separate requirement and capability criteria",
        ),
    )
    upsert(
        lines,
        "base_uid",
        cm(
            base_uid="FIX-CAP-REVIEW",
            project_id="reqalm",
            parent="SEC-FIX",
            kind="capability",
            title="Fixture capability accepted in review and still changed",
        ),
    )
    upsert(
        versions,
        "uid",
        cm(
            uid="FIX-REQ-REVIEW",
            base_uid="FIX-REQ-REVIEW",
            version_n=0,
            status="draft",
            statement=REQ_STMT,
            security={"catalog_ref": "CM-2", "verification_note": "Fixture. Not a product requirement."},
            statement_hash=statement_hash(REQ_STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        versions,
        "uid",
        cm(
            uid="FIX-CAP-REVIEW",
            base_uid="FIX-CAP-REVIEW",
            version_n=0,
            status="superseded",
            statement=CAP_V0,
            security={
                "catalog_ref": "CM-2",
                "verification_note": "Fixture. Version outcome is not the completeness gate.",
            },
            statement_hash=statement_hash(CAP_V0),
            grooming_state="detailed",
        ),
    )
    upsert(
        versions,
        "uid",
        cm(
            uid="FIX-CAP-REVIEW.1",
            base_uid="FIX-CAP-REVIEW",
            version_n=1,
            status="draft",
            statement=CAP_V1,
            mint_kind="content",
            security={
                "catalog_ref": "CM-2",
                "verification_note": "Fixture successor. Not activated.",
            },
            statement_hash=statement_hash(CAP_V1),
            grooming_state="detailed",
        ),
    )

    criteria = data.setdefault("acceptance_criteria", [])
    for row in (
        cm(id="crit-fix-req", version_uid="FIX-REQ-REVIEW", position=0, statement=CRIT_REQ),
        cm(id="crit-fix-cap-a", version_uid="FIX-CAP-REVIEW", position=0, statement=CRIT_A),
        cm(id="crit-fix-cap-b", version_uid="FIX-CAP-REVIEW", position=1, statement=CRIT_B),
        cm(
            id="crit-fix-cap-a-1",
            version_uid="FIX-CAP-REVIEW.1",
            position=0,
            statement=CRIT_A,
            copied_from="crit-fix-cap-a",
        ),
        cm(
            id="crit-fix-cap-b-1",
            version_uid="FIX-CAP-REVIEW.1",
            position=1,
            statement=CRIT_B,
            copied_from="crit-fix-cap-b",
        ),
    ):
        upsert(criteria, "id", row)

    data["criterion_completions"] = [
        c
        for c in data.get("criterion_completions") or []
        if c.get("id") not in {"cc-fix-cap-a", "cc-fix-cap-a-1"}
    ]

    for frm, to, kind in (
        ("ARCH-REQ-AC-FACET.1", "ARCH-REQ-AC-FACET", "refines"),
        ("ARCH-REQ-AC-ROLLUP.1", "ARCH-REQ-AC-ROLLUP", "refines"),
        ("ARCH-CRITERION-RELEASE-UAT", "ARCH-REQ-AC-ROLLUP.1", "refines"),
        ("ARCH-CAP-REVIEW-COPY", "ARCH-REQ-AC-FACET.1", "refines"),
        ("ARCH-CAP-REVIEW-COPY", "ARCH-TRACE-RECHECK", "refines"),
        ("ARCH-WI-COMPILE.1", "J02", "refines"),
        (CAP, "ARCH-REQ-AC-FACET.1", "satisfies"),
        (CAP, "ARCH-REQ-AC-ROLLUP.1", "satisfies"),
        (CAP, "ARCH-CRITERION-RELEASE-UAT", "satisfies"),
        (CAP, "ARCH-CAP-REVIEW-COPY", "satisfies"),
        (CAP, "ARCH-WI-COMPILE.1", "satisfies"),
        ("FIX-CAP-REVIEW", "FIX-REQ-REVIEW", "satisfies"),
        ("FIX-CAP-REVIEW.1", "FIX-REQ-REVIEW", "satisfies"),
    ):
        ensure_edge(edges, {"from": frm, "to": to, "kind": kind})

    if product is not None:
        insert_alpha(product.setdefault("in_scope_of", []), CAP)
        insert_alpha(product.setdefault("covers_releases", []), REL)

    validate_baseline_edges_preserved(data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-baseline-edges", action="store_true")
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
        "Patched dogfood.yaml: "
        f"lines={len(data.get('requirement_lines') or [])} "
        f"versions={len(data.get('requirement_versions') or [])} "
        f"edges={len(data.get('edges') or [])} "
        f"releases={len(data.get('releases') or [])} "
        f"criteria={len(data.get('acceptance_criteria') or [])} "
        f"completions={len(data.get('criterion_completions') or [])}"
    )


if __name__ == "__main__":
    main()
