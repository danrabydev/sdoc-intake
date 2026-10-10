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
FIX_REL = "rel-fix-cap-review-uat"

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


def insert_alpha(seq, value: str) -> None:
    if value in seq:
        return
    for i, cur in enumerate(seq):
        if str(cur) > value:
            seq.insert(i, value)
            return
    seq.append(value)


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
    "work item, or verification_outcome on the version does not by itself complete a facet. The parent stays "
    "incomplete while any of its facets has no completion marker."
)
UAT = (
    "UAT and review of a release are the completeness gate for acceptance criteria. A completion marker names "
    "the criterion, the release, the actor, and the time, and is recorded only for a criterion on a version "
    "that release delivers. Work items do not complete criteria. A capability may be delivered in more than one "
    "release; each release review may complete only the criteria that release earned. The capability's criteria "
    "are complete when each of its facets has a completion marker, which may be a later release than the first delivery."
)
COPY = (
    "A capability review may accept the implementation and still require a change. The required change mints a "
    "successor version. Criteria on the reviewed version freeze: their statements and completion markers are not "
    "edited after the successor exists. Each frozen criterion is copied onto the successor as a new criterion id "
    "with the same shall-statement and copied_from pointing at the frozen criterion. Completion markers stay on "
    "the frozen criterion. A copy of a criterion that already has a completion is born with its own marker, "
    "copied_from that completion and naming the same release, so an accepted criterion does not reopen. A copy of "
    "an open criterion starts with no completion. Later UAT may complete only open criteria on the successor."
)
WI = (
    "The initial work-item act compiles a briefing from a capability, not a one-to-one sync from a requirement. "
    "The briefing includes the capability's still-open acceptance criteria and the controls that apply to it "
    "(direct, inherited, and hybrid) for implementers to keep in mind. One capability may have many work items, "
    "including across releases, and a work item may cover only part of a capability. Closing, reopening, or "
    "editing a work item does not complete a criterion and does not change the capability statement. Two-way "
    "field push, pull, and conflict merge (J04–J06) are not this initial path."
)
CAP_STMT = (
    "Seed and schema only: capability acceptance criteria with completion markers separate from requirement "
    "facets; those markers are written in a release UAT or review, not by a work item; a review that accepts "
    "the implementation and still requires a change freezes criteria on the reviewed version and copies them "
    "onto the successor. No loader or UI in this release. Fixture: FIX-CAP-REVIEW, FIX-CAP-REVIEW.1, and "
    "rel-fix-cap-review-uat (not a product release)."
)

REQ_STMT = (
    "FIXTURE need used only to show that a requirement facet and a capability facet are different criteria. "
    "Nothing in this line is a product requirement."
)
CAP_V0 = (
    "FIXTURE capability reviewed in rel-fix-cap-review-uat. One criterion was marked complete in that UAT; "
    "the review still required a change, so this version's criteria are frozen."
)
CAP_V1 = (
    "FIXTURE successor required by that review. Criteria were copied from FIX-CAP-REVIEW. The accepted "
    "criterion keeps a copied completion marker. The open criterion stays open for a later release review."
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

    proposals = [
        ("ARCH-REQ-AC-FACET.1", "ARCH-REQ-AC-FACET", 1, FACET_1, "content"),
        ("ARCH-REQ-AC-ROLLUP.1", "ARCH-REQ-AC-ROLLUP", 1, ROLLUP_1, "content"),
    ]
    for uid, base, n, statement, mint in proposals:
        upsert(versions, "uid", draft_version(uid, base, n, statement, mint=mint))

    new_reqs = [
        ("ARCH-CRITERION-RELEASE-UAT", "SEC-RL", "requirement", "Criterion completion is release UAT or review", UAT),
        ("ARCH-CAP-REVIEW-COPY", "SEC-RL", "requirement", "Accepted review that still requires a change", COPY),
        ("ARCH-WI-COMPILE", "SEC-WI", "requirement", "Work item is a capability briefing, not completeness", WI),
    ]
    for uid, parent, kind, title, statement in new_reqs:
        upsert(lines, "base_uid", cm(base_uid=uid, project_id="reqalm", parent=parent, kind=kind, title=title))
        upsert(versions, "uid", draft_version(uid, uid, 0, statement))

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
                "version. rel-fix-cap-review-uat is a fixture and is not this release."
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
    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=FIX_REL,
            project_id="reqalm",
            name="Fixture — capability UAT review",
            planned_on=PLANNED,
            shipped_on=PLANNED,
            status="shipped",
            delivers=["FIX-CAP-REVIEW"],
            cyber_gate=False,
            notes=(
                "FIXTURE only, not a product release, and not covered by ctr-reqalm-product. "
                "UAT marked crit-fix-cap-a complete and still required FIX-CAP-REVIEW.1. "
                "The successor is not delivered here."
            ),
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

    completions = data.setdefault("criterion_completions", [])
    upsert(
        completions,
        "id",
        cm(
            id="cc-fix-cap-a",
            criterion_id="crit-fix-cap-a",
            release_id=FIX_REL,
            by="taylor-tester",
            at="2026-10-10T15:00:00-04:00",
            notes="UAT of the fixture release. Not a work-item transition.",
        ),
    )
    upsert(
        completions,
        "id",
        cm(
            id="cc-fix-cap-a-1",
            criterion_id="crit-fix-cap-a-1",
            release_id=FIX_REL,
            by="taylor-tester",
            at="2026-10-10T15:00:00-04:00",
            copied_from="cc-fix-cap-a",
            notes="Copied with the criterion so the accepted item does not reopen. Not a second UAT decision.",
        ),
    )

    for frm, to, kind in (
        ("ARCH-REQ-AC-FACET.1", "ARCH-REQ-AC-FACET", "refines"),
        ("ARCH-REQ-AC-ROLLUP.1", "ARCH-REQ-AC-ROLLUP", "refines"),
        ("ARCH-CRITERION-RELEASE-UAT", "ARCH-REQ-AC-ROLLUP.1", "refines"),
        ("ARCH-CAP-REVIEW-COPY", "ARCH-REQ-AC-FACET.1", "refines"),
        ("ARCH-WI-COMPILE", "J02", "refines"),
        (CAP, "ARCH-REQ-AC-FACET.1", "satisfies"),
        (CAP, "ARCH-REQ-AC-ROLLUP.1", "satisfies"),
        (CAP, "ARCH-CRITERION-RELEASE-UAT", "satisfies"),
        (CAP, "ARCH-CAP-REVIEW-COPY", "satisfies"),
        (CAP, "ARCH-WI-COMPILE", "satisfies"),
        ("FIX-CAP-REVIEW", "FIX-REQ-REVIEW", "satisfies"),
        ("FIX-CAP-REVIEW.1", "FIX-REQ-REVIEW", "satisfies"),
    ):
        ensure_edge(edges, {"from": frm, "to": to, "kind": kind})

    product = find(data.get("contracts"), "id", "ctr-reqalm-product")
    if product is not None:
        scope = product.setdefault("in_scope_of", [])
        for uid in (
            "ARCH-CAP-REVIEW-COPY",
            "ARCH-CRITERION-RELEASE-UAT",
            "ARCH-WI-COMPILE",
            CAP,
        ):
            insert_alpha(scope, uid)
        insert_alpha(product.setdefault("covers_releases", []), REL)

    # Those two rows already differ from BASE_MAIN: the merged release-state patch shipped them.
    # This patch does not edit them. Allow-listing keeps the check able to catch any other mutation.
    validate_baseline_records_preserved(
        data,
        allow_version_uids=frozenset({"CAP-SVC-RBAC-NO-PROJECT"}),
        allow_release_ids=frozenset({"rel-r1-rbac-authorize-fail-closed"}),
    )
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
