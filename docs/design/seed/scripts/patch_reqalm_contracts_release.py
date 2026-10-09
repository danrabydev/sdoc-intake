#!/usr/bin/env python3
"""Ship rel-r1-ui-header-nav (PR #37 @ dd43cc1); add ReqALM product/maintenance contracts.

Adds ctr-reqalm-product / ctr-reqalm-maintenance (covers_releases + in_scope_of),
planned recurring MAINT-* obligations on the maintenance contract, and
rel-r1-reqalm-contracts / CAP-REQALM-CONTRACTS for this seed PR.

Idempotent. Run: python3 patch_reqalm_contracts_release.py && python3 yaml_to_strictdoc.py --validate
"""
from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
NIST = "nist-800-53@rev5-dogfood-20261006"
STIG = "asd-stig@v6r4"
SHIPPED_DATE = "2026-10-09"
HEADER_MERGE = "dd43cc1523544d0f6375a628bc9d7d45a31fa738"
CAP_HEADER = "CAP-UI-HEADER-NAV"
REL_HEADER = "rel-r1-ui-header-nav"
CAP = "CAP-REQALM-CONTRACTS"
REL = "rel-r1-reqalm-contracts"
PRODUCT_CONTRACT = "ctr-reqalm-product"
MAINT_CONTRACT = "ctr-reqalm-maintenance"
SEC_MAINT = "SEC-REQALM-MAINT"

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
        seq.append(deepcopy(item))
        return 1
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
    return 0


def ensure_edge(edges, edge):
    key = (edge.get("from"), edge.get("to"), edge.get("kind"), edge.get("catalog_imprint_id"))
    for e in edges:
        if (e.get("from"), e.get("to"), e.get("kind"), e.get("catalog_imprint_id")) == key:
            return 0
    edges.append(edge)
    return 1


def active_uid(data, base_uid: str) -> str:
    """Pick the active tip uid for a line; fall back to highest version_n."""
    vers = [v for v in data.get("requirement_versions") or [] if v.get("base_uid") == base_uid]
    if not vers:
        return base_uid
    active = [v for v in vers if v.get("status") == "active"]
    if active:
        return max(active, key=lambda v: v.get("version_n", 0))["uid"]
    return max(vers, key=lambda v: v.get("version_n", 0))["uid"]


def reqalm_release_snapshot(data) -> tuple[list[str], list[str]]:
    rel_ids: list[str] = []
    deliver_uids: set[str] = set()
    for r in data.get("releases") or []:
        if r.get("project_id") != "reqalm":
            continue
        rid = r.get("id")
        if rid:
            rel_ids.append(rid)
        for u in r.get("delivers") or []:
            deliver_uids.add(u)
    return sorted(rel_ids), sorted(deliver_uids)


def ship_ui_header_nav(data) -> None:
    rel = find(data.get("releases"), "id", REL_HEADER)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = SHIPPED_DATE
        rel["notes"] = (
            f"PR #37 merged to main as {HEADER_MERGE} on {SHIPPED_DATE}. "
            "ReqALM header breadcrumb, project tabs, list/tree toggle under Requirements."
        )
    ver = find(data.get("requirement_versions"), "uid", CAP_HEADER)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "CM-2")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {
            "catalog_ref": catalog_ref,
            "verification_note": f"Shipped with header/nav UI PR #37 (merge {HEADER_MERGE}).",
        }
    ar = find(data.get("approval_records"), "id", "ar-ui-header-nav")
    if ar:
        ar["status"] = "unapproved"
        ar["notes"] = (
            f"Capability active with verification pass after PR #37 merge {HEADER_MERGE}; "
            "formal approval record not filed in seed."
        )
        ar["approved_version_uid"] = None
        ar["approved_statement_hash"] = None


MAINT_OBLIGATIONS: list[dict] = [
    {
        "base_uid": "MAINT-SEC-AUDIT-MONTHLY",
        "title": "Monthly security audit (planned)",
        "statement": (
            "PLANNED recurring obligation (not shipped). Perform a documented monthly security audit of the "
            "ReqALM deployment: review auth/session anomalies, privileged access use, configuration drift against "
            "the approved baseline, and open findings from the prior month. Record results and track remediation."
        ),
        "conforms_to": [("CA-7", NIST)],
    },
    {
        "base_uid": "MAINT-DEPS-VULN-MONTHLY",
        "title": "Monthly dependency and vulnerability review (planned)",
        "statement": (
            "PLANNED recurring obligation (not shipped). Each month, review application and container dependency "
            "manifests for known vulnerabilities (SCA), triage findings by severity, and plan patches or accepted "
            "risk with Security approval. No silent deferrals past the next review cycle."
        ),
        "conforms_to": [("RA-5", NIST), ("SI-2", NIST)],
    },
    {
        "base_uid": "MAINT-ACCESS-RECERT-QUARTERLY",
        "title": "Quarterly access recertification (planned)",
        "statement": (
            "PLANNED recurring obligation (not shipped). Quarterly, Authorizing Official or delegate recertifies "
            "project grants and privileged roles for ReqALM: confirm least privilege, remove stale grants, and audit "
            "the recertification decision."
        ),
        "conforms_to": [("AC-2", NIST), ("AC-2.3", NIST)],
    },
    {
        "base_uid": "MAINT-STIG-NIST-REASSESS",
        "title": "STIG and NIST control re-assessment (planned)",
        "statement": (
            "PLANNED recurring obligation (not shipped). On a defined cadence (at least annually, or when catalog "
            "imprints change), re-assess ReqALM ConformsTo coverage against the pinned NIST imprint and applicable "
            "ASD STIG rules; open successor versions or pin updates through the locked migrate workflow."
        ),
        "conforms_to": [("CA-7", NIST), ("V-222515", STIG)],
    },
    {
        "base_uid": "MAINT-AUDIT-LOG-REVIEW",
        "title": "Audit log review (planned)",
        "statement": (
            "PLANNED recurring obligation (not shipped). Review exported OTEL/security audit streams for suspicious "
            "patterns, failed auth spikes, and privileged mutations; escalate anomalies per incident response policy."
        ),
        "conforms_to": [("AU-6", NIST)],
    },
]

CAP_STMT = (
    "Seed-only contract overlay pass: ReqALM product contract (ctr-reqalm-product) covers all reqalm releases "
    "via covers_releases and their delivered version snapshots via in_scope_of; maintenance contract "
    "(ctr-reqalm-maintenance) holds forward-looking planned MAINT-* recurring obligations with NIST/STIG ConformsTo "
    "pins. Regenerates docs/design/seed/out/, schema docs, and HANDOFF.md. No application runtime changes."
)
CAP_ARTIFACTS = [
    f"{REPO}/docs/design/seed/dogfood.yaml",
    f"{REPO}/docs/design/seed/scripts/patch_reqalm_contracts_release.py",
    f"{REPO}/docs/design/seed/scripts/yaml_to_strictdoc.py",
    f"{REPO}/docs/design/seed/schema.md",
    f"{REPO}/docs/design/seed/reqseed.schema.json",
    f"{REPO}/docs/design/HANDOFF.md",
]


def upsert_maintenance_obligations(data) -> list[str]:
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=SEC_MAINT,
            project_id="reqalm",
            parent=None,
            kind="section",
            title="ReqALM maintenance obligations (planned)",
        ),
    )
    maint_uids: list[str] = []
    maint_bases = [ob["base_uid"] for ob in MAINT_OBLIGATIONS]
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") not in maint_bases]
    edges = data["edges"]
    mc03 = active_uid(data, "MC03")
    for ob in MAINT_OBLIGATIONS:
        bu = ob["base_uid"]
        maint_uids.append(bu)
        upsert(
            data["requirement_lines"],
            "base_uid",
            cm(
                base_uid=bu,
                project_id="reqalm",
                parent=SEC_MAINT,
                kind="requirement",
                title=ob["title"],
            ),
        )
        stmt = ob["statement"]
        upsert(
            data.setdefault("requirement_versions", []),
            "uid",
            cm(
                uid=bu,
                base_uid=bu,
                version_n=0,
                status="draft",
                statement=stmt,
                priority=50,
                iteration="iter-r1",
                security={
                    "catalog_ref": ob["conforms_to"][0][0],
                    "verification_note": "Planned maintenance obligation — not shipped; no verification outcome.",
                },
                statement_hash=statement_hash(stmt),
                grooming_state="want",
            ),
        )
        ensure_edge(edges, {"from": bu, "to": mc03, "kind": "refines"})
        for ctl, imprint in ob["conforms_to"]:
            ensure_edge(
                edges,
                {"from": bu, "to": ctl, "kind": "conforms_to", "catalog_imprint_id": imprint},
            )
    return maint_uids


def upsert_contracts(data, *, product_delivers: list[str], product_releases: list[str], maint_uids: list[str]) -> None:
    contracts = data.setdefault("contracts", [])
    upsert(
        contracts,
        "id",
        cm(
            id=PRODUCT_CONTRACT,
            client_id="raby-family",
            project_id="reqalm",
            name="ReqALM product (build)",
            starts_on="2026-10-01",
            ends_on=None,
            status="active",
            covers_releases=product_releases,
            in_scope_of=product_delivers,
            notes=(
                "Umbrella build contract for the ReqALM project: owns every seeded release id and the union of "
                "all release.delivers version snapshots (capabilities and requirements). Distinct from legacy "
                "overlay fixtures (Design-2026-10, Security package, …)."
            ),
        ),
    )
    upsert(
        contracts,
        "id",
        cm(
            id=MAINT_CONTRACT,
            client_id="raby-family",
            project_id="reqalm",
            name="ReqALM maintenance",
            starts_on="2026-10-09",
            ends_on=None,
            status="active",
            covers_releases=[],
            in_scope_of=maint_uids,
            notes=(
                "Maintenance contract for operating ReqALM after delivery. No releases owned yet; in_scope_of holds "
                "planned recurring MAINT-* obligations (draft, not shipped)."
            ),
        ),
    )


def upsert_this_release(data) -> None:
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-CT",
            kind="capability",
            title="ReqALM product and maintenance contracts (seed)",
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
            statement=CAP_STMT,
            priority=10,
            iteration="iter-r1",
            security={
                "catalog_ref": "CM-2",
                "verification_note": "Planned until ReqALM contracts seed PR merges.",
            },
            statement_hash=statement_hash(CAP_STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-reqalm-contracts",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for ReqALM product/maintenance contracts seed PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP]
    for to in ("ARCH-CONTRACT.1", "ARCH-RELEASE", active_uid(data, "MC03")):
        ensure_edge(data["edges"], {"from": CAP, "to": to, "kind": "satisfies"})
    ensure_edge(
        data["edges"],
        {"from": CAP, "to": "CM-2", "kind": "conforms_to", "catalog_imprint_id": NIST},
    )
    arts = data.setdefault("capability_artifacts", [])
    data["capability_artifacts"] = [a for a in arts if a.get("requirement_version_uid") != CAP]
    for uri in CAP_ARTIFACTS:
        data["capability_artifacts"].append({"requirement_version_uid": CAP, "kind": "other", "uri": uri})
    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=REL,
            project_id="reqalm",
            name="R1 — ReqALM product and maintenance contracts (seed)",
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes=(
                "Seed-only: ctr-reqalm-product / ctr-reqalm-maintenance, MAINT-* planned obligations, "
                f"ships rel-r1-ui-header-nav at {HEADER_MERGE}."
            ),
        ),
    )


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    ship_ui_header_nav(data)
    product_releases, product_delivers = reqalm_release_snapshot(data)
    maint_uids = upsert_maintenance_obligations(data)
    upsert_contracts(
        data,
        product_delivers=product_delivers,
        product_releases=product_releases,
        maint_uids=maint_uids,
    )
    upsert_this_release(data)

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(
        f"Patched dogfood.yaml: shipped {REL_HEADER}, contracts {PRODUCT_CONTRACT}+{MAINT_CONTRACT}, "
        f"{REL} / {CAP} ({len(product_releases)} releases, {len(product_delivers)} deliver uids, "
        f"{len(maint_uids)} maint obligations)"
    )


if __name__ == "__main__":
    main()
