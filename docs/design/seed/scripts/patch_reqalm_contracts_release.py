#!/usr/bin/env python3
"""Ship rel-r1-ui-header-nav (PR #37 @ dd43cc1); add ReqALM product/maintenance contracts.

Adds ctr-reqalm-product / ctr-reqalm-maintenance (covers_releases + in_scope_of),
SYS-CYBER-UPKEEP plus draft CAP-UPKEEP-* capabilities on the maintenance contract, and
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
SHIPPED_DATE = "2026-10-09"
HEADER_MERGE = "dd43cc1523544d0f6375a628bc9d7d45a31fa738"
CAP_HEADER = "CAP-UI-HEADER-NAV"
REL_HEADER = "rel-r1-ui-header-nav"
CAP = "CAP-REQALM-CONTRACTS"
REL = "rel-r1-reqalm-contracts"
PRODUCT_CONTRACT = "ctr-reqalm-product"
MAINT_CONTRACT = "ctr-reqalm-maintenance"
SYS_UPKEEP = "SYS-CYBER-UPKEEP"
LEGACY_MAINT_BASES = frozenset(
    {
        "SEC-REQALM-MAINT",
        "MAINT-SEC-AUDIT-MONTHLY",
        "MAINT-DEPS-VULN-MONTHLY",
        "MAINT-ACCESS-RECERT-QUARTERLY",
        "MAINT-STIG-NIST-REASSESS",
        "MAINT-AUDIT-LOG-REVIEW",
    }
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


def product_scope_uid(data, base_uid: str) -> str | None:
    """Product contract pin: active tip if any; else newest non-superseded (draft build work OK)."""
    vers = [v for v in data.get("requirement_versions") or [] if v.get("base_uid") == base_uid]
    if not vers:
        return base_uid
    active = [v for v in vers if v.get("status") == "active"]
    if active:
        return max(active, key=lambda v: v.get("version_n", 0))["uid"]
    non_superseded = [v for v in vers if v.get("status") != "superseded"]
    if not non_superseded:
        return None
    return max(non_superseded, key=lambda v: v.get("version_n", 0))["uid"]


def upkeep_cap_base_uids() -> frozenset[str]:
    return frozenset(c["base_uid"] for c in UPKEEP_CAPABILITIES)


def product_scope_exclude_bases() -> frozenset[str]:
    return upkeep_cap_base_uids() | {SYS_UPKEEP}


def reqalm_release_ids(data) -> list[str]:
    rel_ids: list[str] = []
    for r in data.get("releases") or []:
        if r.get("project_id") != "reqalm":
            continue
        rid = r.get("id")
        if rid:
            rel_ids.append(rid)
    return sorted(rel_ids)


def reqalm_product_contract_scope(data, *, maint_in_scope: set[str]) -> list[str]:
    """Reqalm cap/requirement pins for ctr-reqalm-product (excludes maintenance-owned lines)."""
    exclude = product_scope_exclude_bases()
    uids: list[str] = []
    for ln in data.get("requirement_lines") or []:
        if ln.get("project_id") != "reqalm":
            continue
        if ln.get("kind") not in ("requirement", "capability"):
            continue
        bu = ln.get("base_uid")
        if not bu or bu in exclude:
            continue
        uid = product_scope_uid(data, bu)
        if uid and uid not in maint_in_scope:
            uids.append(uid)
    return sorted(set(uids))


def fix_header_nav_ui_kit_edge(data) -> None:
    """Cyber: header nav depends on UI kit chrome via uses, not satisfies (before/at ship)."""
    edges = data.setdefault("edges", [])
    kit = "CAP-UI-KIT-CHROME"
    data["edges"] = [
        e
        for e in edges
        if not (
            e.get("from") == CAP_HEADER
            and e.get("to") == kit
            and e.get("kind") == "satisfies"
        )
    ]
    ensure_edge(data["edges"], {"from": CAP_HEADER, "to": kit, "kind": "uses"})


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


SYS_UPKEEP_STMT = (
    "PLANNED system requirement (not shipped). ReqALM in production shall sustain ongoing cyber upkeep: continuous "
    "monitoring, vulnerability and flaw remediation, account lifecycle review, and audit log analysis — implemented "
    "by the draft CAP-UPKEEP-* capability pack and owned under maintenance contract ctr-reqalm-maintenance."
)
SYS_UPKEEP_CONTROLS = [("CA-7", NIST), ("RA-5", NIST), ("SI-2", NIST), ("AC-2", NIST), ("AU-6", NIST)]

UPKEEP_CAPABILITIES: list[dict] = [
    {
        "base_uid": "CAP-UPKEEP-MONTHLY-SEC-AUDIT",
        "title": "Monthly security audit (planned)",
        "statement": (
            "PLANNED capability (not shipped). Each month, Security performs a documented ReqALM security audit: "
            "auth/session anomalies, privileged use, configuration drift vs approved baseline, and open findings "
            "from the prior cycle. Results are recorded and remediated."
        ),
        "conforms_to": [("CA-7", NIST)],
        "approval_id": "ar-upkeep-monthly-sec-audit",
    },
    {
        "base_uid": "CAP-UPKEEP-MONTHLY-DEPS-VULN",
        "title": "Monthly dependency and vulnerability review (planned)",
        "statement": (
            "PLANNED capability (not shipped). Each month, review application and container dependency manifests "
            "for known vulnerabilities (SCA), triage by severity, and plan patches or Security-approved risk "
            "acceptance before the next review."
        ),
        "conforms_to": [("RA-5", NIST), ("SI-2", NIST)],
        "approval_id": "ar-upkeep-monthly-deps-vuln",
    },
    {
        "base_uid": "CAP-UPKEEP-QUARTERLY-ACCESS-RECERT",
        "title": "Quarterly access recertification (planned)",
        "statement": (
            "PLANNED capability (not shipped). Quarterly, an Authorizing Official or delegate recertifies ReqALM "
            "project grants and privileged roles: confirm least privilege, remove stale grants, audit the decision."
        ),
        "conforms_to": [("AC-2", NIST)],
        "approval_id": "ar-upkeep-quarterly-access-recert",
    },
    {
        "base_uid": "CAP-UPKEEP-AUDIT-LOG-REVIEW",
        "title": "Audit log review (planned)",
        "statement": (
            "PLANNED capability (not shipped). Review exported OTEL/security audit streams for suspicious patterns, "
            "failed auth spikes, and privileged mutations; escalate per incident response policy."
        ),
        "conforms_to": [("AU-6", NIST)],
        "approval_id": "ar-upkeep-audit-log-review",
    },
]

CAP_STMT = (
    "Seed-only contract overlay pass: ReqALM product contract (ctr-reqalm-product) covers all reqalm releases "
    "via covers_releases; in_scope_of pins active reqalm capability/requirement tips; maintenance contract "
    "(ctr-reqalm-maintenance) owns draft CAP-UPKEEP-* capabilities satisfying SYS-CYBER-UPKEEP. "
    "Regenerates docs/design/seed/out/, schema docs, and HANDOFF.md. No application runtime changes."
)
CAP_ARTIFACTS = [
    f"{REPO}/docs/design/seed/dogfood.yaml",
    f"{REPO}/docs/design/seed/scripts/patch_reqalm_contracts_release.py",
    f"{REPO}/docs/design/seed/scripts/yaml_to_strictdoc.py",
    f"{REPO}/docs/design/seed/schema.md",
    f"{REPO}/docs/design/seed/reqseed.schema.json",
    f"{REPO}/docs/design/HANDOFF.md",
]


def purge_legacy_maint_entities(data) -> None:
    data["requirement_lines"] = [
        ln
        for ln in data.get("requirement_lines") or []
        if ln.get("base_uid") not in LEGACY_MAINT_BASES
    ]
    data["requirement_versions"] = [
        ver
        for ver in data.get("requirement_versions") or []
        if ver.get("base_uid") not in LEGACY_MAINT_BASES
    ]
    edges = data.get("edges") or []
    data["edges"] = [
        e
        for e in edges
        if e.get("from") not in LEGACY_MAINT_BASES and e.get("to") not in LEGACY_MAINT_BASES
    ]


def upsert_cyber_upkeep_model(data) -> list[str]:
    """SYS-CYBER-UPKEEP + draft CAP-UPKEEP-*; returns capability UIDs for maintenance contract."""
    purge_legacy_maint_entities(data)
    upkeep_cap_bases = [c["base_uid"] for c in UPKEEP_CAPABILITIES]
    edges = data.setdefault("edges", [])
    data["edges"] = [
        e
        for e in edges
        if e.get("from") not in upkeep_cap_bases
        and e.get("from") != SYS_UPKEEP
        and e.get("to") != SYS_UPKEEP
    ]
    edges = data["edges"]

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=SYS_UPKEEP,
            project_id="reqalm",
            parent="SEC-SEC",
            kind="requirement",
            title="Ongoing cyber upkeep (ReqALM operations)",
        ),
    )
    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid=SYS_UPKEEP,
            base_uid=SYS_UPKEEP,
            version_n=0,
            status="draft",
            statement=SYS_UPKEEP_STMT,
            priority=40,
            iteration="iter-r1",
            security={
                "catalog_ref": "CA-7",
                "verification_note": "Planned system requirement — not shipped; satisfied by draft CAP-UPKEEP-* pack.",
            },
            statement_hash=statement_hash(SYS_UPKEEP_STMT),
            grooming_state="detailed",
        ),
    )
    for ctl, imprint in SYS_UPKEEP_CONTROLS:
        ensure_edge(
            edges,
            {"from": SYS_UPKEEP, "to": ctl, "kind": "conforms_to", "catalog_imprint_id": imprint},
        )

    cap_uids: list[str] = []
    for cap in UPKEEP_CAPABILITIES:
        bu = cap["base_uid"]
        cap_uids.append(bu)
        upsert(
            data["requirement_lines"],
            "base_uid",
            cm(
                base_uid=bu,
                project_id="reqalm",
                parent="SEC-CAP",
                kind="capability",
                title=cap["title"],
            ),
        )
        stmt = cap["statement"]
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
                    "catalog_ref": cap["conforms_to"][0][0],
                    "verification_note": "Planned upkeep capability — not shipped; no verification outcome.",
                },
                statement_hash=statement_hash(stmt),
                grooming_state="want",
            ),
        )
        upsert(
            data.setdefault("approval_records", []),
            "id",
            cm(
                id=cap["approval_id"],
                subject_kind="CapabilityLine",
                base_uid=bu,
                status="unapproved",
                by=None,
                at=None,
                notes=f"Planned upkeep capability {bu}.",
                approved_version_uid=None,
                approved_statement_hash=None,
            ),
        )
        ensure_edge(edges, {"from": bu, "to": SYS_UPKEEP, "kind": "satisfies"})
        for ctl, imprint in cap["conforms_to"]:
            ensure_edge(
                edges,
                {"from": bu, "to": ctl, "kind": "conforms_to", "catalog_imprint_id": imprint},
            )
    return cap_uids


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
                "Umbrella build contract for the ReqALM project: covers_releases lists every reqalm release id; "
                "in_scope_of pins each reqalm capability/requirement at active tip or newest non-superseded draft "
                "(excludes ctr-reqalm-maintenance upkeep caps and SYS-CYBER-UPKEEP). Distinct from legacy overlays."
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
                "draft CAP-UPKEEP-* capabilities (planned, not shipped) that satisfy SYS-CYBER-UPKEEP."
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
                "Seed-only: ctr-reqalm-product / ctr-reqalm-maintenance, SYS-CYBER-UPKEEP + CAP-UPKEEP-*, "
                f"ships rel-r1-ui-header-nav at {HEADER_MERGE}."
            ),
        ),
    )


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    ship_ui_header_nav(data)
    fix_header_nav_ui_kit_edge(data)
    product_releases = reqalm_release_ids(data)
    maint_cap_uids = upsert_cyber_upkeep_model(data)
    product_scope = reqalm_product_contract_scope(data, maint_in_scope=set(maint_cap_uids))
    upsert_contracts(
        data,
        product_delivers=product_scope,
        product_releases=product_releases,
        maint_uids=maint_cap_uids,
    )
    upsert_this_release(data)

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(
        f"Patched dogfood.yaml: shipped {REL_HEADER}, contracts {PRODUCT_CONTRACT}+{MAINT_CONTRACT}, "
        f"{REL} / {CAP} ({len(product_releases)} releases, {len(product_scope)} active cap/req uids, "
        f"{len(maint_cap_uids)} upkeep capabilities)"
    )


if __name__ == "__main__":
    main()
