#!/usr/bin/env python3
"""Apply Cyber control-placement mapping to dogfood.yaml (claims of applicability only).

Idempotent. Does NOT git commit.
Run: python3 patch_cyber_control_placement.py && python3 yaml_to_strictdoc.py --validate

Mapping source: cyber_control_placement_mapping.yaml (from Cyber review @ main 2de51e2).
"""
from __future__ import annotations

import hashlib
import re
from copy import deepcopy
from pathlib import Path

import yaml as pyyaml
from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
MAPPING = Path(__file__).resolve().parent / "cyber_control_placement_mapping.yaml"
NIST = "nist-800-53@rev5-dogfood-20261006"
STIG = "asd-stig@v6r4"
REL_ID = "rel-r1-cyber-control-placement"
CAP_ID = "CAP-CYBER-CONTROL-PLACEMENT"
MAIN_SHA = "2de51e2c6cacf1826401b820138f0d544b512bae"

SKIP_LINK_UIDS = frozenset({"CAP-AGENT-ACCESS", "ARCH-AUTH-AGENT-ATTRIBUTION"})

V0_TO_V1_CONTRACT = {
    "ARCH-API-RBAC": "ARCH-API-RBAC.1",
    "CAP-RBAC": "CAP-RBAC.1",
    "CAP-SSO": "CAP-SSO.1",
    "CAP-SCOPED-VIEW": "CAP-SCOPED-VIEW.1",
}

SATISFIES_RETARGET_CAPS = [
    "CAP-SVC-REQUEST-CONTEXT",
    "CAP-SVC-OPERATION-EXECUTOR",
    "CAP-SVC-ROUTE-REGISTRY",
    "CAP-SVC-PROJECT-READ",
    "CAP-SVC-OPERATION-ROUTE",
    "CAP-SVC-BUSINESS-ROUTE-AUDIT",
    "CAP-SVC-PROJECT-ID-SLUG",
    "CAP-SVC-IMPLICIT-PUBLIC-EXACT",
    "CAP-SVC-NON-API-AUTH-AUDIT",
    "CAP-READ-REQS",
    "CAP-READ-RELEASES",
    "CAP-READ-HIERARCHY",
    "CAP-RELATIONS-API",
]

CONTRACT_IDS_V34 = (
    "contract-design-2026-10",
    "contract-security-package",
    "contract-platform-baseline",
)

CONTRACT_V0_TO_ACTIVE_TIP = (
    "ARCH-CP-HIER",
    "ARCH-VER",
    "ARCH-API",
    "ARCH-OTEL",
)

OUTBOUND_PIN_KINDS = ("satisfies", "refines", "uses", "conforms_to")

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 1200
yaml.indent(mapping=2, sequence=2, offset=0)

report = {
    "conforms_to_before": 0,
    "conforms_to_after": 0,
    "adds_applied": 0,
    "removes_applied": 0,
    "moves_applied": 0,
    "pin_mints": [],
    "skipped": [],
}
PIN_TIP: dict[str, str] = {}


def cm(**kw):
    m = CommentedMap()
    for k, v in kw.items():
        m[k] = v
    return m


def mk_edge(frm, to, kind, catalog_imprint_id=None):
    e = cm(**{"from": frm, "to": to, "kind": kind})
    if catalog_imprint_id is not None:
        e["catalog_imprint_id"] = catalog_imprint_id
    return e


def statement_hash(text: str) -> str:
    canon = "\n".join(line.rstrip() for line in text.strip().replace("\r\n", "\n").split("\n"))
    return "sha256:" + hashlib.sha256(canon.encode("utf-8")).hexdigest()


def find(seq, key, val):
    for x in seq or []:
        if x.get(key) == val:
            return x
    return None


def edge_key(edge):
    return (edge.get("from"), edge.get("to"), edge.get("kind"), edge.get("catalog_imprint_id"))


def ensure_edge(edges, edge):
    key = edge_key(edge)
    for e in edges:
        if edge_key(e) == key:
            return False
    edges.append(edge if isinstance(edge, CommentedMap) else cm(**edge))
    return True


def remove_conforms(edges, frm, to, imprint):
    key = (frm, to, "conforms_to", imprint)
    kept = [e for e in edges if edge_key(e) != key]
    removed = len(edges) - len(kept)
    edges[:] = kept
    return removed


def norm_control(control: str) -> str:
    c = control.strip()
    c = re.sub(r"\((\d+)\)", r".\1", c)
    return c


def split_controls(control: str) -> list[str]:
    if "/" in control and not control.startswith("V-"):
        parts = []
        for chunk in control.split("/"):
            chunk = chunk.strip()
            if not chunk:
                continue
            if re.match(r"^[A-Z]{2}-\d", chunk):
                parts.append(norm_control(chunk))
        if parts:
            return parts
    return [norm_control(control)]


def imprint_for(row: dict, control: str) -> str:
    if row.get("catalog_imprint_id"):
        return row["catalog_imprint_id"]
    if control.startswith("V-"):
        return STIG
    return NIST


def build_lock_sets(data: dict) -> tuple[set[str], set[str]]:
    delivered = set()
    for rel in data.get("releases") or []:
        if rel.get("status") == "shipped":
            for d in rel.get("delivers") or []:
                delivered.add(d)
    in_contract = set()
    for c in data.get("contracts") or []:
        for u in c.get("in_scope_of") or []:
            in_contract.add(u)
    return delivered, in_contract


def is_version_locked(uid: str, ver: dict, delivered: set[str], in_contract: set[str]) -> bool:
    if ver.get("status") == "draft":
        return False
    return uid in delivered or uid in in_contract


def active_tip(data: dict, base_uid: str) -> dict | None:
    vs = [v for v in data.get("requirement_versions") or [] if v.get("base_uid") == base_uid]
    act = [v for v in vs if v.get("status") == "active"]
    if not act:
        return None
    return max(act, key=lambda v: int(v.get("version_n") or 0))


def mint_pin_successor(data: dict, base_uid: str) -> str:
    if base_uid in PIN_TIP:
        return PIN_TIP[base_uid]
    tip = active_tip(data, base_uid)
    if not tip:
        raise KeyError(f"no active tip for {base_uid}")
    uid = tip["uid"]
    n = int(tip.get("version_n") or 0) + 1
    new_uid = f"{base_uid}.{n}" if n > 0 else base_uid
    while find(data["requirement_versions"], "uid", new_uid):
        n += 1
        new_uid = f"{base_uid}.{n}"
    stmt = tip["statement"]
    new_ver = cm(
        uid=new_uid,
        base_uid=base_uid,
        version_n=n,
        status="active",
        statement=stmt,
        statement_hash=tip.get("statement_hash") or statement_hash(stmt),
        priority=tip.get("priority", 15),
        iteration=tip.get("iteration", "iter-r1"),
        security=deepcopy(tip.get("security") or {"catalog_ref": "CM-2", "verification_note": ""}),
        grooming_state=tip.get("grooming_state", "detailed"),
        mint_kind="pin",
    )
    if tip.get("verification_outcome") is not None:
        new_ver["verification_outcome"] = tip["verification_outcome"]
    if tip.get("rbac_op"):
        new_ver["rbac_op"] = tip["rbac_op"]
    tip["status"] = "superseded"
    data.setdefault("requirement_versions", []).append(new_ver)
    edges = data.setdefault("edges", [])
    for e in list(edges):
        if e.get("from") != uid or e.get("kind") not in OUTBOUND_PIN_KINDS:
            continue
        copied = mk_edge(new_uid, e["to"], e["kind"], e.get("catalog_imprint_id"))
        ensure_edge(edges, copied)
    edges[:] = [
        e
        for e in edges
        if not (e.get("from") == uid and e.get("kind") in OUTBOUND_PIN_KINDS)
    ]
    ensure_edge(edges, mk_edge(new_uid, uid, "refines"))
    report["pin_mints"].append({"base_uid": base_uid, "uid": new_uid, "supersedes": uid})
    PIN_TIP[base_uid] = new_uid
    return new_uid


def resolve_edit_uid(
    data: dict,
    from_uid: str,
    row: dict,
    delivered: set[str],
    in_contract: set[str],
) -> str | None:
    if from_uid in SKIP_LINK_UIDS:
        return None
    ver = find(data.get("requirement_versions"), "uid", from_uid)
    base = ver["base_uid"] if ver else from_uid.split(".")[0] if "." in from_uid else from_uid
    if not ver and not find(data.get("requirement_lines"), "base_uid", base):
        report["skipped"].append((from_uid, row.get("control"), "unknown uid"))
        return None
    tip = active_tip(data, base) or ver
    if not tip:
        report["skipped"].append((from_uid, row.get("control"), "no active tip"))
        return None
    uid = tip["uid"]
    base_uid = tip["base_uid"]
    if uid in delivered:
        return mint_pin_successor(data, base_uid)
    apply = row.get("apply") or ""
    if "shipped+locked" in apply and is_version_locked(uid, tip, delivered, in_contract):
        return mint_pin_successor(data, base_uid)
    return uid


def apply_mapping_adds_removes(data: dict, mapping: dict, delivered: set[str], in_contract: set[str]) -> None:
    edges = data.setdefault("edges", [])
    for row in mapping.get("remove_links") or []:
        frm0 = row["from_uid"]
        if frm0 in SKIP_LINK_UIDS:
            continue
        for ctrl in split_controls(row["control"]):
            frm = resolve_edit_uid(data, frm0, row, delivered, in_contract)
            if not frm:
                continue
            imp = imprint_for(row, ctrl)
            if remove_conforms(edges, frm, ctrl, imp):
                report["removes_applied"] += 1
    for row in mapping.get("add_links") or []:
        if row.get("control") == "SA-11":
            continue
        frm0 = row["from_uid"]
        if frm0 in SKIP_LINK_UIDS:
            continue
        for ctrl in split_controls(row["control"]):
            frm = resolve_edit_uid(data, frm0, row, delivered, in_contract)
            if not frm:
                continue
            imp = imprint_for(row, ctrl)
            if ensure_edge(edges, mk_edge(frm, ctrl, "conforms_to", imp)):
                report["adds_applied"] += 1


def apply_move_links(data: dict, mapping: dict, delivered: set[str], in_contract: set[str]) -> None:
    edges = data.setdefault("edges", [])
    for mv in mapping.get("move_links") or []:
        old_uid = mv["from_uid_old"]
        new_uid = mv.get("from_uid_new")
        ctrl_old = mv.get("control_old", "")
        ctrl_new = mv.get("control_new", "")
        if ctrl_old == "V-222518" or ctrl_new == "V-222518":
            continue  # handled in apply_v222518 (avoid .1/.2 ping-pong)
        if old_uid in SKIP_LINK_UIDS:
            continue
        if ctrl_old == "AU-2/AU-3/AU-12" and mv.get("from_uid_new") == "(inherit from ARCH-OTEL)":
            changed = False
            for c in ("AU-2", "AU-3", "AU-12"):
                frm = resolve_edit_uid(
                    data,
                    old_uid,
                    {"apply": mv.get("apply", ""), "control": c},
                    delivered,
                    in_contract,
                )
                if frm and remove_conforms(edges, frm, c, NIST):
                    changed = True
            if changed:
                report["moves_applied"] += 1
            continue
        if new_uid and str(new_uid).startswith("("):
            continue
        if ctrl_new and str(ctrl_new).startswith("("):
            if "ARCH-AUTH-FEDERATION" in ctrl_new:
                changed = ensure_edge(edges, mk_edge("CAP-SSO.1", "ARCH-AUTH-FEDERATION", "satisfies"))
                for c in ("IA-2",):
                    if remove_conforms(edges, "CAP-SSO.1", c, NIST):
                        changed = True
                if changed:
                    report["moves_applied"] += 1
            continue
        frm_old = resolve_edit_uid(
            data, old_uid, {"apply": mv.get("apply", ""), "control": ctrl_old}, delivered, in_contract
        )
        frm_new = (
            resolve_edit_uid(
                data, new_uid, {"apply": mv.get("apply", ""), "control": ctrl_new}, delivered, in_contract
            )
            if new_uid
            else frm_old
        )
        if not frm_old:
            continue
        changed = False
        for co in split_controls(ctrl_old):
            imp = STIG if co.startswith("V-") else NIST
            if remove_conforms(edges, frm_old, co, imp):
                changed = True
        for cn in split_controls(ctrl_new):
            imp = STIG if cn.startswith("V-") else NIST
            target = frm_new or frm_old
            if ensure_edge(edges, mk_edge(target, cn, "conforms_to", imp)):
                changed = True
        if changed:
            report["moves_applied"] += 1


def apply_v222518(data: dict, mapping: dict, delivered: set[str], in_contract: set[str]) -> None:
    edges = data.setdefault("edges", [])
    v518 = mapping.get("v222518") or {}
    for rel in v518.get("recommendation", {}).get("relink") or []:
        uid = rel["from_uid"]
        row = {"apply": "unlocked: apply in place", "control": "V-222518"}
        frm = resolve_edit_uid(data, uid, row, delivered, in_contract)
        if frm and ensure_edge(
            edges, mk_edge(frm, "V-222518", "conforms_to", STIG)
        ):
            report["adds_applied"] += 1
    for raw in v518.get("recommendation", {}).get("additional_direct") or []:
        uid = raw.split("(")[0].strip() if isinstance(raw, str) else raw
        if uid == "ARCH-AUTH-LOCAL":
            uid = "ARCH-AUTH-LOCAL.1"
        row = {
            "apply": "shipped+locked: pin",
            "control": "V-222518",
            "catalog_imprint_id": STIG,
            "shipped_in": ["rel-r1-foundation-shell-auth"],
        }
        frm = resolve_edit_uid(data, uid, row, delivered, in_contract)
        if frm and ensure_edge(
            edges, mk_edge(frm, "V-222518", "conforms_to", STIG)
        ):
            report["adds_applied"] += 1


def active_tip_uid(data: dict, base_uid: str) -> str | None:
    if base_uid in PIN_TIP:
        return PIN_TIP[base_uid]
    tip = active_tip(data, base_uid)
    return tip["uid"] if tip else None


def strip_satisfies_from_base_to(edges, base_uid: str, to_uid: str) -> None:
    prefix = base_uid.split(".")[0]
    edges[:] = [
        e
        for e in edges
        if not (
            e.get("kind") == "satisfies"
            and e.get("to") == to_uid
            and (e.get("from") == base_uid or (e.get("from") or "").split(".")[0] == prefix)
        )
    ]


def apply_trace_recommendations(data: dict) -> None:
    edges = data.setdefault("edges", [])
    pairs = [
        ("CAP-SSO.1", "ARCH-AUTH-FEDERATION"),
        ("CAP-SVC-AUDIT-APPEND", "ARCH-WRITE-UOW-AUDIT"),
        ("CAP-SVC-STRUCTURED-LOG", "ARCH-CRED-AUDIT"),
        ("CAP-MFA-QR", "ARCH-SUPPLY-VENDORED"),
        ("CAP-SVC-STATIC-DEP-PATCH", "ARCH-SUPPLY-DEP-SCAN"),
    ]
    for frm_base, to in pairs:
        frm = active_tip_uid(data, frm_base) or frm_base
        ensure_edge(edges, mk_edge(frm, to, "satisfies"))
    rbac_tip = active_tip_uid(data, "ARCH-API-RBAC") or "ARCH-API-RBAC.1"
    for cap in SATISFIES_RETARGET_CAPS:
        frm = active_tip_uid(data, cap)
        if not frm:
            continue
        strip_satisfies_from_base_to(edges, cap, "ARCH-API-RBAC")
        strip_satisfies_from_base_to(edges, cap, "ARCH-API-RBAC.1")
        ensure_edge(edges, mk_edge(frm, rbac_tip, "satisfies"))


def remove_edge_satisfies(edges, frm, to):
    key = (frm, to, "satisfies", None)
    edges[:] = [e for e in edges if (e.get("from"), e.get("to"), e.get("kind"), e.get("catalog_imprint_id")) != key]


def retarget_arch_write_truncate_guard(data: dict) -> None:
    edges = data.setdefault("edges", [])
    remove_edge_satisfies(edges, "ARCH-WRITE-TRUNCATE-GUARD", "ARCH-CP-SCOPE")
    ensure_edge(edges, mk_edge("ARCH-WRITE-TRUNCATE-GUARD", "ARCH-WRITE-DB-RUNTIME-ROLE", "refines"))


def add_new_requirements(data: dict, mapping: dict) -> None:
    for spec in mapping.get("new_requirements") or []:
        base = spec["uid"]
        upsert_line(data, cm(
            base_uid=base,
            project_id="reqalm",
            parent=spec["parent"],
            kind=spec.get("kind", "requirement"),
            title=spec["title"],
        ))
        sec = spec.get("security") or {}
        ver = cm(
            uid=base,
            base_uid=base,
            version_n=spec.get("version_n", 0),
            status=spec.get("status", "draft"),
            statement=spec["statement"],
            priority=15,
            iteration="iter-r1",
            security={"catalog_ref": sec.get("catalog_ref", "CM-2"), "verification_note": sec.get("verification_note", "")},
            statement_hash=statement_hash(spec["statement"]),
            grooming_state="detailed",
        )
        if base == "ARCH-SUPPLY-VENDORED":
            ver["status"] = "active"
            ver["verification_outcome"] = "pass"
            ver["security"]["verification_note"] = (
                "Cyber control mapping 2026-10-09; verified by existing vendor hash test on main "
                "(apps/reqalm/src/web/mfa-enroll-ui.test.ts asserts qr-min.js SHA-256; vendor/README.md manifest)."
            )
        upsert_version(data, ver)
        edges = data.setdefault("edges", [])
        for ct in spec.get("conforms_to") or []:
            ctrl = norm_control(ct["control"])
            imp = ct.get("catalog_imprint_id") or imprint_for({}, ctrl)
            ensure_edge(edges, mk_edge(base, ctrl, "conforms_to", imp))
        for te in spec.get("trace_edges") or []:
            ensure_edge(edges, mk_edge(te["from_uid"], te["to"], te["kind"]))


def upsert_line(data, item):
    if find(data.get("requirement_lines"), "base_uid", item["base_uid"]) is None:
        data.setdefault("requirement_lines", []).append(item)


def upsert_version(data, item):
    cur = find(data.get("requirement_versions"), "uid", item["uid"])
    if cur is None:
        data.setdefault("requirement_versions", []).append(item)
        return
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v


def patch_a02_a03_v222550(data: dict) -> None:
    edges = data.setdefault("edges", [])
    for uid in ("A02", "A03"):
        if remove_conforms(edges, uid, "V-222550", STIG):
            report["removes_applied"] += 1


def patch_arch_sec_headers_partial(data: dict) -> None:
    ver = find(data.get("requirement_versions"), "uid", "ARCH-SEC-HEADERS")
    if not ver:
        return
    note = (ver.get("security") or {}).get("verification_note") or ""
    if "partial fit" not in note.lower() and "V-222602" in note:
        return
    vn = ver.setdefault("security", {})
    extra = " V-222602 (CSP) is a partial-fit XSS defence-in-depth claim; output encoding lives elsewhere."
    if extra.strip() not in vn.get("verification_note", ""):
        vn["verification_note"] = (vn.get("verification_note") or "").rstrip() + extra


def resolve_contract_scope_uid(data: dict, uid: str) -> str:
    uid = V0_TO_V1_CONTRACT.get(uid, uid)
    base = uid.split(".")[0]
    tip_uid = active_tip_uid(data, base)
    if tip_uid and uid == base and tip_uid != base:
        return tip_uid
    if base in CONTRACT_V0_TO_ACTIVE_TIP and tip_uid:
        if uid == base or uid in (base, f"{base}.0"):
            return tip_uid
    if tip_uid and uid != tip_uid:
        ver = find(data.get("requirement_versions"), "uid", uid)
        if ver and ver.get("status") == "superseded":
            return tip_uid
    return uid


def update_contracts_v34(data: dict) -> None:
    for cid in CONTRACT_IDS_V34:
        c = find(data.get("contracts"), "id", cid)
        if not c:
            continue
        seen = set()
        scope = []
        for u in c.get("in_scope_of") or []:
            resolved = resolve_contract_scope_uid(data, u)
            if resolved not in seen:
                seen.add(resolved)
                scope.append(resolved)
        c["in_scope_of"] = scope


def add_planned_release(data: dict) -> None:
    upsert_release(
        data,
        cm(
            id=REL_ID,
            project_id="reqalm",
            name="R1-cyber-control-placement",
            planned_on="2026-10-09",
            shipped_on=None,
            status="planned",
            delivers=[CAP_ID],
            cyber_gate=False,
            notes=(
                f"Seed-only Cyber control-placement mapping @ main {MAIN_SHA[:7]}. "
                "ConformsTo grooming (add/move/remove pins, pin-kind successors on shipped lines); "
                "no verification_outcome changes on existing shipped capabilities except ARCH-SUPPLY-VENDORED "
                "citing the existing vendor hash test. Not shipped until Security accepts pins."
            ),
        ),
    )
    upsert_line(
        data,
        cm(
            base_uid=CAP_ID,
            project_id="reqalm",
            parent="SEC-CAT",
            kind="capability",
            title="Cyber control-placement seed pass",
        ),
    )
    upsert_version(
        data,
        cm(
            uid=CAP_ID,
            base_uid=CAP_ID,
            version_n=0,
            status="draft",
            statement=(
                "Documentation-only capability for the Cyber control-placement seed PR: applies the "
                "conforms_to add/move/remove table to ARCH/CAP scope, mints pin-kind successors where "
                "shipped releases freeze prior version UIDs, adds ARCH-WRITE-DB-RUNTIME-ROLE / ARCH-SEC-TLS / "
                "ARCH-SUPPLY-* requirements, and regenerates StrictDoc out/."
            ),
            priority=10,
            iteration="iter-r1",
            security={
                "catalog_ref": "CM-2",
                "verification_note": "Planned seed-only; no runtime deliverable.",
            },
            statement_hash=statement_hash(
                "Documentation-only capability for the Cyber control-placement seed PR: applies the "
                "conforms_to add/move/remove table to ARCH/CAP scope, mints pin-kind successors where "
                "shipped releases freeze prior version UIDs, adds ARCH-WRITE-DB-RUNTIME-ROLE / ARCH-SEC-TLS / "
                "ARCH-SUPPLY-* requirements, and regenerates StrictDoc out/."
            ),
            grooming_state="detailed",
        ),
    )
    ensure_edge(data.setdefault("edges", []), mk_edge(CAP_ID, "ARCH-CAT-PIN", "satisfies"))


def upsert_release(data, rel):
    if find(data.get("releases"), "id", rel["id"]) is None:
        data.setdefault("releases", []).append(rel)


def count_conforms(data) -> int:
    return sum(1 for e in data.get("edges") or [] if e.get("kind") == "conforms_to")


def count_edges_by_kind(data) -> dict[str, int]:
    counts: dict[str, int] = {}
    for e in data.get("edges") or []:
        k = e.get("kind") or "?"
        counts[k] = counts.get(k, 0) + 1
    return counts


def main() -> None:
    with MAPPING.open(encoding="utf-8") as f:
        mapping = pyyaml.safe_load(f)
    with DOGFOOD.open(encoding="utf-8") as f:
        data = yaml.load(f)
    report["edges_before"] = count_edges_by_kind(data)
    report["conforms_to_before"] = count_conforms(data)
    delivered, in_contract = build_lock_sets(data)

    apply_mapping_adds_removes(data, mapping, delivered, in_contract)
    apply_move_links(data, mapping, delivered, in_contract)
    apply_v222518(data, mapping, delivered, in_contract)
    add_new_requirements(data, mapping)
    apply_trace_recommendations(data)
    retarget_arch_write_truncate_guard(data)
    patch_a02_a03_v222550(data)
    patch_arch_sec_headers_partial(data)
    update_contracts_v34(data)
    add_planned_release(data)

    report["edges_after"] = count_edges_by_kind(data)
    report["conforms_to_after"] = count_conforms(data)

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)

    print("Patched dogfood.yaml (Cyber control placement)")
    print(pyyaml.dump(report, default_flow_style=False))


if __name__ == "__main__":
    main()
