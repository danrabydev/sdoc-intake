#!/usr/bin/env python3
"""Common-control mapping: inheritable ConformsTo on capabilities + uses seed beds. Idempotent."""
from __future__ import annotations

import hashlib
import importlib.util
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap
from ruamel.yaml.scalarstring import LiteralScalarString

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
NIST = "nist-800-53@rev5-dogfood-20261006"
PLANNED = "2026-10-09"
CAP = "CAP-TRACE-INHERIT-USES"
REL = "rel-r1-trace-inherit-uses"
ARCH_USES = "ARCH-TRACE-INHERIT-USES"
ARCH_HYBRID = "ARCH-TRACE-INHERIT-HYBRID"
REL_CONTRACTS = "rel-r1-reqalm-contracts"
CAP_CONTRACTS = "CAP-REQALM-CONTRACTS"
CONTRACTS_MERGE = "88df54dea5c8d2bfd895e2613b17dbf2c5b3405f"

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
        seq.append(item)
        return 1
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
    return 0


def ensure_edge(edges, edge):
    key = (
        edge.get("from"),
        edge.get("to"),
        edge.get("kind"),
        edge.get("catalog_imprint_id") or "",
    )
    for e in edges:
        if (
            e.get("from"),
            e.get("to"),
            e.get("kind"),
            e.get("catalog_imprint_id") or "",
        ) == key:
            for k, v in edge.items():
                e[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
            return 0
    edges.append(edge)
    return 1


STMT_ARCH_USES = (
    "A provider capability version may mark any of its conforms_to pins inheritable (common control, "
    "NIST SP 800-53 Rev. 5 PL-2/PM-10 common-control designation). A consumer capability version that "
    "uses the provider inherits each inheritable pin and shows it as \"inherited via uses <provider>\". "
    "Rules: (1) Only capability-to-capability uses edges carry inheritance; uses edges from or to "
    "requirement lines remain dependency-only per ARCH-HIER-USES-DEP. (2) Only pins on the provider "
    "line's current active version that is shipped or verification_outcome=pass are inheritable; draft, "
    "superseded, obsolete or withdrawn provider versions supply nothing. (3) A control whose provider "
    "verification is fail, pending, or not assessed is not inherited; the consumer shows it "
    "\"provider not-pass\" and the control stays incomplete for the consumer. (4) Inheritance is one "
    "hop. A provider re-exports a control it inherited only when its own conforms_to pin for that "
    "control is marked inheritable (that is, it takes ownership of the control). (5) Any content, "
    "status, or verification change on the provider line, or a change to its inheritable set, flags "
    "needs re-check (trace_suspect) on every consumer for the affected controls only, per "
    "ARCH-TRACE-RECHECK. (6) Cross-project or restricted providers follow existing scope rules: a "
    "consumer without read grant on the provider project sees the inherited control id and the state "
    "\"inherited (provider restricted)\", but not the provider uid, statement, or evidence."
)

STMT_ARCH_HYBRID = (
    "When a consumer capability both inherits a control via uses and has its own direct conforms_to pin "
    "for the same control, the control is hybrid for that consumer: the provider supplies the shared "
    "part and the consumer adds or overrides the rest (for example a custom session timeout). The "
    "consumer's direct pin wins for display and for the consumer's verification state, labeled "
    "\"hybrid (via <provider>)\". Hybrid counts once per consumer and control. A provider change still "
    "flags the hybrid control for re-check on the consumer. Removing the direct pin returns the control "
    "to inherited; removing the provider inheritable mark returns it to direct-only."
)

SEC_ARCH_USES = {
    "catalog_ref": "PL-2",
    "verification_note": (
        "Cyber 2026-10-09 inherit-uses mapping; common-control model per SP 800-53 Rev5 PL-2, PM-10, CA-2, SA-9."
    ),
}

SEC_ARCH_HYBRID = {
    "catalog_ref": "CA-2",
    "verification_note": (
        "Cyber 2026-10-09; hybrid control per SP 800-53 Rev5 PL-2 discussion (common, hybrid, system-specific)."
    ),
}

STMT_CAP = (
    "Dogfood seed loader persists trace_edges.inheritable on capability conforms_to pins; validation "
    "rejects inheritable on non-capability sources or non-conforms_to edges. Read APIs resolve inherited "
    "and hybrid control state at read time in a follow-on PR."
)

def _contracts_patch_module():
    path = SEED / "scripts" / "patch_reqalm_contracts_release.py"
    spec = importlib.util.spec_from_file_location("patch_reqalm_contracts_release", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def ship_reqalm_contracts_release(data) -> None:
    rel = find(data.get("releases"), "id", REL_CONTRACTS)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = PLANNED
        rel["notes"] = (
            f"PR #38 merged to main as {CONTRACTS_MERGE} on {PLANNED}. "
            "ReqALM product/maintenance contracts seed (ctr-reqalm-product, ctr-reqalm-maintenance, CAP-UPKEEP-*)."
        )
    ver = find(data.get("requirement_versions"), "uid", CAP_CONTRACTS)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "CM-2")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {
            "catalog_ref": catalog_ref,
            "verification_note": f"Shipped with ReqALM contracts seed PR #38 (merge {CONTRACTS_MERGE}).",
        }
    ar = find(data.get("approval_records"), "id", "ar-reqalm-contracts")
    if ar:
        ar["status"] = "unapproved"
        ar["notes"] = (
            f"Capability active with verification pass after PR #38 merge {CONTRACTS_MERGE}; "
            "formal approval record not filed in seed."
        )
        ar["approved_version_uid"] = None
        ar["approved_statement_hash"] = None


def refresh_product_contract_scope(data) -> None:
    mod = _contracts_patch_module()
    maint = find(data.get("contracts"), "id", mod.MAINT_CONTRACT)
    maint_in_scope = set(maint.get("in_scope_of") or []) if maint else set()
    scope = mod.reqalm_product_contract_scope(data, maint_in_scope=maint_in_scope)
    prod = find(data.get("contracts"), "id", mod.PRODUCT_CONTRACT)
    if prod:
        prod["in_scope_of"] = scope
        prod["covers_releases"] = mod.reqalm_release_ids(data)


ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/db/migrations/011_trace_edges_inheritable.sql",
    f"{REPO}/apps/reqalm/src/seed/load-dogfood.ts",
    f"{REPO}/apps/reqalm/src/seed/load-dogfood-edges.test.ts",
    f"{REPO}/docs/design/seed/scripts/patch_trace_inherit_uses_release.py",
    f"{REPO}/docs/design/seed/reqseed.schema.json",
    f"{REPO}/docs/design/seed/schema.md",
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=ARCH_USES,
            project_id="reqalm",
            parent="SEC-EDGE",
            kind="requirement",
            title="Inherited controls over uses edges (common-control model)",
        ),
    )
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=ARCH_HYBRID,
            project_id="reqalm",
            parent="SEC-EDGE",
            kind="requirement",
            title="Hybrid controls (provider-supplied plus consumer direct link)",
        ),
    )
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-EDGE",
            kind="capability",
            title="Trace inheritable ConformsTo loader + seed beds",
        ),
    )

    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid=ARCH_USES,
            base_uid=ARCH_USES,
            version_n=0,
            status="draft",
            statement=LiteralScalarString(STMT_ARCH_USES),
            priority=15,
            iteration="iter-r1",
            security=deepcopy(SEC_ARCH_USES),
            statement_hash=statement_hash(STMT_ARCH_USES),
            grooming_state="detailed",
            rbac_op="trace:edit",
        ),
    )
    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid=ARCH_HYBRID,
            base_uid=ARCH_HYBRID,
            version_n=0,
            status="draft",
            statement=LiteralScalarString(STMT_ARCH_HYBRID),
            priority=15,
            iteration="iter-r1",
            security=deepcopy(SEC_ARCH_HYBRID),
            statement_hash=statement_hash(STMT_ARCH_HYBRID),
            grooming_state="detailed",
            rbac_op="trace:edit",
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
            statement=STMT_CAP,
            priority=10,
            iteration="iter-r1",
            security={"catalog_ref": "CM-2", "verification_note": "Planned until inherit-uses loader PR merges."},
            statement_hash=statement_hash(STMT_CAP),
            grooming_state="detailed",
        ),
    )

    exec_v0 = find(data.get("requirement_versions"), "uid", "CAP-SVC-OPERATION-EXECUTOR")
    exec_stmt = exec_v0["statement"] if exec_v0 else "runOperation enforces RBAC + project scope."
    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid="CAP-SVC-OPERATION-EXECUTOR.1",
            base_uid="CAP-SVC-OPERATION-EXECUTOR",
            version_n=1,
            status="active",
            statement=exec_stmt,
            priority=10,
            iteration="iter-r1",
            security={
                "catalog_ref": "CM-2",
                "verification_note": "Pin mint: inheritable AC-3, AU-2, AU-12 for uses inheritance seed bed.",
            },
            statement_hash=statement_hash(exec_stmt),
            grooming_state="detailed",
            mint_kind="pin",
            verification_outcome="pass",
        ),
    )

    edges = data.setdefault("edges", [])

    harden_v0 = find(data.get("requirement_versions"), "uid", "CAP-AUTH-HARDEN")
    harden_stmt = harden_v0["statement"] if harden_v0 else "OAuth session hardening."
    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid="CAP-AUTH-HARDEN.1",
            base_uid="CAP-AUTH-HARDEN",
            version_n=1,
            status="active",
            statement=harden_stmt,
            priority=10,
            iteration="iter-r1",
            security={
                "catalog_ref": "SC-23",
                "verification_note": "security_meta mint: inheritable SC-23 for uses inheritance seed bed.",
            },
            statement_hash=statement_hash(harden_stmt),
            grooming_state="detailed",
            mint_kind="security_meta",
            verification_outcome="pass",
        ),
    )

    for uid in ("CAP-SVC-OPERATION-EXECUTOR", "CAP-AUTH-HARDEN"):
        v0 = find(data.get("requirement_versions"), "uid", uid)
        if v0:
            v0["status"] = "superseded"

    ensure_edge(
        edges,
        {"from": "CAP-SVC-OPERATION-EXECUTOR.1", "to": "CAP-SVC-OPERATION-EXECUTOR", "kind": "refines"},
    )
    ensure_edge(edges, {"from": "CAP-AUTH-HARDEN.1", "to": "CAP-AUTH-HARDEN", "kind": "refines"})

    for e in list(edges):
        if e.get("from") == "CAP-AUTH-HARDEN" and e.get("kind") == "satisfies":
            ensure_edge(
                edges,
                {"from": "CAP-AUTH-HARDEN.1", "to": e["to"], "kind": "satisfies"},
            )
        if e.get("from") == "CAP-SVC-OPERATION-EXECUTOR" and e.get("kind") == "satisfies":
            succ = {"from": "CAP-SVC-OPERATION-EXECUTOR.1", "to": e["to"], "kind": "satisfies"}
            if e.get("trace_suspect") is True:
                succ["trace_suspect"] = True
            if e.get("suspect_reason"):
                succ["suspect_reason"] = e["suspect_reason"]
            ensure_edge(edges, succ)

    for e in edges:
        if (
            e.get("from") == "CAP-SVC-OPERATION-ROUTE"
            and e.get("kind") == "uses"
            and e.get("to") == "CAP-SVC-OPERATION-EXECUTOR"
        ):
            e["to"] = "CAP-SVC-OPERATION-EXECUTOR.1"

    for ctrl in ("PL-2", "PM-10", "CA-7", "SA-17"):
        ensure_edge(
            edges,
            {
                "from": ARCH_USES,
                "to": ctrl,
                "kind": "conforms_to",
                "catalog_imprint_id": NIST,
            },
        )
    for ctrl in ("PL-2", "CA-2"):
        ensure_edge(
            edges,
            {
                "from": ARCH_HYBRID,
                "to": ctrl,
                "kind": "conforms_to",
                "catalog_imprint_id": NIST,
            },
        )
    ensure_edge(edges, {"from": ARCH_USES, "to": "ARCH-TRACE-RECHECK", "kind": "refines"})
    ensure_edge(edges, {"from": ARCH_USES, "to": "ARCH-HIER-USES-DEP", "kind": "refines"})
    ensure_edge(edges, {"from": ARCH_HYBRID, "to": ARCH_USES, "kind": "refines"})

    for ctrl in ("AC-3", "AU-2", "AU-12"):
        ensure_edge(
            edges,
            {
                "from": "CAP-SVC-OPERATION-EXECUTOR.1",
                "to": ctrl,
                "kind": "conforms_to",
                "catalog_imprint_id": NIST,
                "inheritable": True,
            },
        )
    ensure_edge(
        edges,
        {
            "from": "CAP-AUTH-HARDEN.1",
            "to": "SC-23",
            "kind": "conforms_to",
            "catalog_imprint_id": NIST,
            "inheritable": True,
        },
    )
    ensure_edge(
        edges,
        {"from": "CAP-UI-FRAME.1", "to": "CAP-SVC-OPERATION-EXECUTOR.1", "kind": "uses"},
    )
    ensure_edge(edges, {"from": "CAP-UI-FRAME.1", "to": "CAP-AUTH-HARDEN.1", "kind": "uses"})

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
            name="R1 — trace inheritable controls over uses",
            planned_on=PLANNED,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes=(
                "Loader column trace_edges.inheritable + seed beds (ARCH-TRACE-INHERIT-*). "
                f"Ships rel-r1-reqalm-contracts at PR #38 merge {CONTRACTS_MERGE}."
            ),
        ),
    )

    ship_reqalm_contracts_release(data)
    refresh_product_contract_scope(data)

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(
        f"Patched dogfood.yaml: shipped {REL_CONTRACTS} @ {CONTRACTS_MERGE}, {REL} / {CAP}, "
        "inherit-uses architecture + seed beds"
    )


if __name__ == "__main__":
    main()
