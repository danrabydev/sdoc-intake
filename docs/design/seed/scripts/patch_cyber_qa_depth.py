#!/usr/bin/env python3
"""Depth-pass patch for dogfood.yaml — preserves Cyber+QA minimal cut; merges steered UIDs."""
from __future__ import annotations

import copy
from pathlib import Path

import yaml

SEED = Path(__file__).resolve().parent.parent
SRC = SEED / "dogfood.yaml"
FIXTURES = SEED / "fixtures"


def dump(data: dict) -> None:
    # Prefer block style for readability; keep unicode
    with SRC.open("w", encoding="utf-8") as f:
        yaml.safe_dump(
            data,
            f,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
            width=100,
        )


def ver(
    uid: str,
    base: str,
    statement: str,
    *,
    status: str = "active",
    version_n: int = 0,
    rbac_op: str | None = None,
    catalog_ref: str | None = None,
    verification_note: str | None = None,
    priority: int | None = None,
    iteration: str | None = "iter-r1",
    title: str | None = None,
) -> dict:
    v: dict = {
        "uid": uid,
        "base_uid": base,
        "version_n": version_n,
        "statement": statement.strip() + ("\n" if "\n" not in statement.strip() else ""),
        "status": status,
    }
    # normalize statement like existing (no trailing newline forced oddly)
    v["statement"] = statement.strip()
    if priority is not None:
        v["priority"] = priority
    if iteration is not None:
        v["iteration"] = iteration
    if rbac_op is not None:
        v["rbac_op"] = rbac_op
    if catalog_ref or verification_note:
        sec: dict = {}
        if catalog_ref:
            sec["catalog_ref"] = catalog_ref
        if verification_note:
            sec["verification_note"] = verification_note
        v["security"] = sec
    if title:
        v["title"] = title
    return v


def line(base_uid: str, title: str, parent: str, kind: str = "requirement") -> dict:
    return {
        "base_uid": base_uid,
        "project_id": "reqalm",
        "parent": parent,
        "kind": kind,
        "title": title,
    }


def edge(frm: str, to: str, kind: str) -> dict:
    return {"from": frm, "to": to, "kind": kind}


def find_ver(data: dict, uid: str) -> dict | None:
    for v in data["requirement_versions"]:
        if v["uid"] == uid:
            return v
    return None


def ensure_line(data: dict, ln: dict) -> None:
    existing = {x["base_uid"] for x in data["requirement_lines"]}
    if ln["base_uid"] not in existing:
        data["requirement_lines"].append(ln)


def ensure_ver(data: dict, v: dict) -> None:
    existing = {x["uid"] for x in data["requirement_versions"]}
    if v["uid"] not in existing:
        data["requirement_versions"].append(v)
    else:
        # replace only if we're intentionally upserting thin/security — caller uses set_ver
        pass


def set_ver(data: dict, v: dict) -> None:
    for i, old in enumerate(data["requirement_versions"]):
        if old["uid"] == v["uid"]:
            data["requirement_versions"][i] = v
            return
    data["requirement_versions"].append(v)


def ensure_edge(data: dict, e: dict) -> None:
    for x in data["edges"]:
        if x["from"] == e["from"] and x["to"] == e["to"] and x["kind"] == e["kind"]:
            return
    data["edges"].append(e)


def stamp_security(v: dict, catalog_ref: str, note: str) -> None:
    sec = dict(v.get("security") or {})
    if not sec.get("catalog_ref"):
        sec["catalog_ref"] = catalog_ref
    # merge note if empty or still TBD-only without new specifics — always set if provided and missing STIG map
    if not sec.get("verification_note"):
        sec["verification_note"] = note
    v["security"] = sec


def main() -> None:
    data = yaml.safe_load(SRC.read_text(encoding="utf-8"))

    # ---------- 1. Identity + client grant (pat-client-admin) ----------
    ids = {i["id"] for i in data["identities"]}
    if "pat-client-admin" not in ids:
        data["identities"].append(
            {
                "id": "pat-client-admin",
                "external_sub": "oidc:pat-client-admin",
                "email": "pat.clientadmin@therabyfamily.com",
                "display_name": "Pat Client-Admin",
                "notes": "Client admin on raby-family — FIX-ALLOW-CLIENT-CREATE happy path.",
            }
        )

    data.setdefault("client_grants", [])
    cg_ids = {g.get("id") for g in data["client_grants"]}
    if "grant-pat-raby-client-admin" not in cg_ids:
        data["client_grants"].append(
            {
                "id": "grant-pat-raby-client-admin",
                "client_id": "raby-family",
                "identity_id": "pat-client-admin",
                "role": "Client admin",
                "notes": "Enables B01 client:create / FIX-ALLOW-CLIENT-CREATE.",
            }
        )

    # ---------- 2. NIST catalog depth ----------
    nist = next(c for c in data["catalogs"] if c["id"] == "cat-nist-global")
    nist_ids = {e["id"] for e in nist["entries"]}
    nist_add = [
        ("NIST-AC-5", "AC-5 Separation of Duties"),
        ("NIST-AU-9", "AU-9 Protection of Audit Information"),
        ("NIST-CM", "Configuration Management (CM) family"),
        ("NIST-CM-3", "CM-3 Configuration Change Control"),
        ("NIST-CM-5", "CM-5 Access Restrictions for Change"),
        ("NIST-IA-5", "IA-5 Authenticator Management"),
        ("NIST-IA-8", "IA-8 Identification and Authentication (Non-Organizational Users)"),
        ("NIST-SC-13", "SC-13 Cryptographic Protection"),
        ("NIST-SI", "System and Information Integrity (SI) family"),
        ("NIST-SI-4", "SI-4 System Monitoring"),
        ("NIST-SI-10", "SI-10 Information Input Validation"),
    ]
    for eid, title in nist_add:
        if eid not in nist_ids:
            nist["entries"].append({"id": eid, "title": title})
            nist_ids.add(eid)

    # ---------- 3. STIG stubs ----------
    stig = next(c for c in data["catalogs"] if c["id"] == "cat-stig-asd-v6r4")
    stig_ids = {e["id"] for e in stig["entries"]}
    # Keep existing STIG-V-222550; add steered + a few theme stubs (session/TLS/audit/account/least-priv)
    stig_add = [
        ("STIG-V-222536", "STUB: V-222536 Minimum 15-character password length (IdP-delegated)"),
        ("STIG-V-222542", "STUB: V-222542 Store only cryptographic representations of passwords (IdP)"),
        ("STIG-V-222567", "STUB: V-222567 Not vulnerable to race conditions (TLS/session seal)"),
        ("STIG-V-222578", "STUB: V-222578 Destroy session ID on logoff / browser close"),
        ("STIG-V-222389", "STUB: V-222389 Idle session termination (non-privileged, 15 min)"),
        ("STIG-V-222391", "STUB: V-222391 User-initiated logoff capability"),
        ("STIG-V-222396", "STUB: V-222396 DoD-approved encryption for remote access confidentiality"),
        ("STIG-V-222407", "STUB: V-222407 Automated account management mechanisms"),
        ("STIG-V-222429", "STUB: V-222429 Prevent non-privileged users from privileged functions"),
        ("STIG-V-222430", "STUB: V-222430 Execute without excessive account permissions"),
        ("STIG-V-222441", "STUB: V-222441 Audit record generation for session ID creation"),
        ("STIG-V-222464", "STUB: V-222464 Audit session start and end times"),
        ("STIG-V-222467", "STUB: V-222467 Audit account create/modify/disable/terminate"),
        ("STIG-V-222596", "STUB: V-222596 Protect confidentiality and integrity of transmitted information"),
    ]
    for eid, title in stig_add:
        if eid not in stig_ids:
            stig["entries"].append({"id": eid, "title": title})
            stig_ids.add(eid)

    # ---------- 4. New CTL lines + versions ----------
    new_ctls = [
        (
            "CTL-AC-2",
            "Account management via grants",
            """ReqALM manages application accounts through identity linkage and project/client/catalog grants
rather than local passwords. Grant create, revoke, and list are audited (actor, subject, role, scope).
Inactive or revoked grants cannot authorize API calls. Conforms to NIST AC-2 Account Management.""",
            "NIST-AC-2",
            "NIST AC-2. STIG ASD V6R4 STIG-V-222407 / STIG-V-222467 (account management stubs).",
        ),
        (
            "CTL-AU-9",
            "Protect audit information",
            """Audit event storage and OTEL export channels are writable only by the audit pipeline and readable
by Auditor (and ops configure sinks). Mutating actors cannot edit or delete prior audit rows from the
product UI/API. Conforms to NIST AU-9 Protection of Audit Information.""",
            "NIST-AU-9",
            "NIST AU-9. STIG ASD V6R4 STIG-V-222578 session teardown complements audit integrity.",
        ),
        (
            "CTL-CM-3",
            "Configuration change control on versions and releases",
            """Published requirement versions (active/obsolete/withdrawn) are immutable; changes require
successor versions. Shipped release delivers sets are frozen. Catalog standard entries are read-only.
These change-control gates map to NIST CM-3 Configuration Change Control.""",
            "NIST-CM-3",
            "NIST CM-3. Pairs FIX-DENY-EDIT-ACTIVE, FIX-DENY-SHIPPED-DELIVERS, ARCH-RELEASE-FREEZE.",
        ),
        (
            "CTL-AC-12",
            "Session termination on sign-out and scope clear",
            """Sign-out and Client Scoped View clear destroy server-bound session state so subsequent requests
cannot reuse the prior client scope or auth context. Idle/session-lock expectations are enforced at
the IdP/app session layer. Conforms to NIST AC-12 Session Termination.""",
            "NIST-AC-12",
            "NIST AC-12. STIG ASD V6R4 STIG-V-222389 / STIG-V-222391 / STIG-V-222578.",
        ),
        (
            "CTL-AU-3",
            "Content of audit records",
            """Security-relevant audit records include timestamp, identity, client/project scope, action
(rbac_op), outcome (allow/deny), and optional grant_id/entity refs. Content aligns to NIST AU-3.""",
            "NIST-AU-3",
            "NIST AU-3. STIG ASD V6R4 STIG-V-222441 / STIG-V-222464.",
        ),
        (
            "CTL-AU-12",
            "Audit record generation",
            """ReqALM generates audit records for grant, scope, release ship, catalog steward, and other
security-relevant mutations and denials, exported via OTEL. Conforms to NIST AU-12.""",
            "NIST-AU-12",
            "NIST AU-12. STIG ASD V6R4 STIG-V-222464 / STIG-V-222467.",
        ),
        (
            "CTL-SC-13",
            "Cryptographic protection",
            """TLS protects UI/API/MCP HTTP; desk WebSockets use session-sealed WSS. Cryptographic modules
for transit follow platform defaults (FIPS-capable deploy target). Conforms to NIST SC-13.""",
            "NIST-SC-13",
            "NIST SC-13. STIG ASD V6R4 STIG-V-222396 / STIG-V-222596.",
        ),
        (
            "CTL-CM-5",
            "Access restrictions for change",
            """Only roles with matching rbac_op (Author, Project admin, Release manager, Catalog steward,
Client admin, Security) may mutate their domains; Readers and Auditors cannot. Separation of
client-admin vs project-admin vs steward scopes enforces CM-5 / AC-5 alignment.""",
            "NIST-CM-5",
            "NIST CM-5 / AC-5. STIG ASD V6R4 STIG-V-222429 / STIG-V-222430.",
        ),
        (
            "CTL-SI-10",
            "Information input validation",
            """HTTP adapters validate DTOs (Zod/OpenAPI) before RBAC and business services run. Invalid
payloads are rejected without mutating domain state. Conforms to NIST SI-10.""",
            "NIST-SI-10",
            "NIST SI-10. Pairs ARCH-API schema-first validation.",
        ),
    ]
    for base, title, stmt, cref, note in new_ctls:
        ensure_line(data, line(base, title, "SEC-SEC", "control"))
        if not find_ver(data, base):
            data["requirement_versions"].append(
                ver(base, base, stmt, catalog_ref=cref, verification_note=note, priority=40, iteration="iter-r0")
            )

    # ---------- 5. QA FIX-* fixtures ----------
    fix_specs = [
        (
            "FIX-ALLOW-CLIENT-CREATE",
            "Pat Client-Admin client:create allow",
            """FIXTURE / TEST BED (not a product feature). Identity pat-client-admin with client_grant
Client admin on raby-family performs client:create → HTTP 201 and an allow audit row
(action=client:create, outcome=allow). Demonstrates B01 happy path without inventing new product roles.""",
            "client:create",
            "NIST-AC-3",
            "Happy path for B01. Sample audit ae-allow-pat-client-create.",
        ),
        (
            "FIX-ALLOW-STEWARD-UPDATE",
            "Morgan steward catalog:entry:update allow on project catalog",
            """FIXTURE / TEST BED (not a product feature). Identity morgan-steward with
catalog_steward_grants on cat-reqalm-security performs catalog:entry:update → 200 and allow audit.
Pairs H05; contrasts FIX-DENY-STEWARD-STANDARD on cat-nist-global.""",
            "catalog:entry:update",
            "REQALM-SEC-CATALOG",
            "Happy path steward update on mutable project catalog. Sample ae-allow-morgan-steward-update.",
        ),
        (
            "FIX-DENY-CLOSED-LINK",
            "Link to closed contract denied",
            """FIXTURE / TEST BED (not a product feature). Author attempts contract:link against
contract-legacy-intake-closed (status=closed) → 403/409 and deny audit. Closed contracts freeze
membership edits (pairs F03).""",
            "contract:link",
            "NIST-AC-3",
            "NIST AC-3 + CM-3 change control on closed contracts. Sample ae-deny-closed-link.",
        ),
        (
            "FIX-DENY-SHIPPED-DELIVERS",
            "Mutate shipped release delivers denied",
            """FIXTURE / TEST BED (not a product feature). Release manager attempts release:membership
add/remove on R0-sequences (status=shipped) → 403/409 and deny audit. Shipped delivers are immutable
(pairs G03, ARCH-RELEASE-FREEZE, CTL-CM-3).""",
            "release:membership",
            "NIST-CM-3",
            "NIST CM-3 freeze. Sample ae-deny-shipped-delivers.",
        ),
        (
            "FIX-DENY-EDIT-ACTIVE",
            "Edit active version fields denied",
            """FIXTURE / TEST BED (not a product feature). Author attempts requirement:version:update_draft
on an active version (e.g. A01) → 403/409; must create successor instead (pairs D03, CTL-CM-3).""",
            "requirement:version:update_draft",
            "NIST-CM-3",
            "NIST CM-3 immutability of published versions. Sample ae-deny-edit-active.",
        ),
        (
            "FIX-ALLOW-SUCCEED",
            "Author succession happy path",
            """FIXTURE / TEST BED (not a product feature). Author with active grant creates successor
.N+1 via requirement:version:succeed on a line with an active tip → 201; prior tip may remain active
until explicitly obsoleted per product rules. Demonstrates D02 happy path.""",
            "requirement:version:succeed",
            "NIST-AC-3",
            "Happy path succession. Sample ae-allow-succeed.",
        ),
        (
            "FIX-COMPARE-2HOP",
            "Compare across two-hop succession",
            """FIXTURE / TEST BED (not a product feature). Reader compares FIX-SUCC-2HOP.0 vs
FIX-SUCC-2HOP.2 (two-hop succession). Field-level diff must surface statement changes across both hops
(pairs D07). Edge FIX-COMPARE-2HOP → D07 uses.""",
            "requirement:version:compare",
            "NIST-AC-3",
            "Uses D07 compare; lineage spans obsolete .0/.1 to active .2.",
        ),
        (
            "FIX-ALLOW-AUDIT-CLIENT",
            "Jordan Auditor audit:client:read allow",
            """FIXTURE / TEST BED (not a product feature). jordan-auditor with Auditor grant performs
audit:client:read on raby-family → 200 (pairs M02 and existing ae-jordan-audit-client-read).""",
            "audit:client:read",
            "NIST-AU-6",
            "Auditor happy path. Existing ae-jordan-audit-client-read.",
        ),
        (
            "FIX-DENY-AUDIT-CROSS-CLIENT",
            "Auditor denied cross-client audit read",
            """FIXTURE / TEST BED (not a product feature). jordan-auditor attempts audit:client:read
while effectively scoped/requesting other-family → 403 and deny audit. Auditor role does not pierce
client isolation (pairs FIX-DENY-CROSS-CLIENT, M02).""",
            "audit:client:read",
            "NIST-AC-3",
            "Cross-client audit isolation. Sample ae-deny-audit-cross-client.",
        ),
        (
            "FIX-EXPORT-L02-GOLDEN",
            "StrictDoc export golden UID set for fixture doc-walk",
            """FIXTURE / TEST BED (not a product feature). Exporting contract-fixture-doc-walk with
context parents off must emit exactly UID set {A01, A02, CTL-AC-3} (same as in_scope_of). Golden file:
seed/fixtures/L02-contract-fixture-doc-walk.uids.txt. Pairs L02 and FIX-CONTRACT-DOC-NOCTX.""",
            "io:export:strictdoc",
            "NIST-AC-3",
            "Golden UID set equality for L02 export of contract-fixture-doc-walk (context off).",
        ),
    ]
    for base, title, stmt, rbac, cref, note in fix_specs:
        ensure_line(data, line(base, title, "SEC-FIX", "requirement"))
        if not find_ver(data, base):
            data["requirement_versions"].append(
                ver(
                    base,
                    base,
                    stmt,
                    rbac_op=rbac,
                    catalog_ref=cref,
                    verification_note=note,
                    priority=30,
                    iteration="iter-r1",
                )
            )

    # ---------- 6. Edges ----------
    for e in [
        edge("FIX-COMPARE-2HOP", "D07", "uses"),
        edge("A12.1", "A12", "refines"),
        # CTL conforms_to wiring
        edge("CTL-AC-2", "A06", "conforms_to"),
        edge("CTL-AC-2", "A07", "conforms_to"),
        edge("CTL-AC-2", "A08", "conforms_to"),
        edge("CTL-AC-2", "A09", "conforms_to"),
        edge("CTL-AC-2", "FIX-ALLOW-CLIENT-CREATE", "conforms_to"),
        edge("CTL-AC-12", "A02", "conforms_to"),
        edge("CTL-AC-12", "A04", "conforms_to"),
        edge("CTL-AU-3", "ARCH-OTEL", "conforms_to"),
        edge("CTL-AU-3", "M01", "conforms_to"),
        edge("CTL-AU-9", "M01", "conforms_to"),
        edge("CTL-AU-9", "M02", "conforms_to"),
        edge("CTL-AU-12", "ARCH-OTEL", "conforms_to"),
        edge("CTL-AU-12", "G05", "conforms_to"),
        edge("CTL-AU-12", "ARCH-VER-TOMB", "conforms_to"),
        edge("CTL-CM-3", "ARCH-RELEASE-FREEZE", "conforms_to"),
        edge("CTL-CM-3", "FIX-REL-SNAP", "conforms_to"),
        edge("CTL-CM-3", "FIX-DENY-EDIT-ACTIVE", "conforms_to"),
        edge("CTL-CM-3", "FIX-DENY-SHIPPED-DELIVERS", "conforms_to"),
        edge("CTL-CM-3", "FIX-SUCC-2HOP.2", "conforms_to"),
        edge("CTL-CM-5", "A07", "conforms_to"),
        edge("CTL-CM-5", "FIX-DENY-READER-GRANT", "conforms_to"),
        edge("CTL-SC-13", "CTL-SC-8", "conforms_to"),
        edge("CTL-SC-13", "MC01.1", "conforms_to"),
        edge("CTL-SI-10", "ARCH-API", "conforms_to"),
        edge("FIX-ALLOW-CLIENT-CREATE", "B01", "uses"),
        edge("FIX-ALLOW-STEWARD-UPDATE", "H05", "uses"),
        edge("FIX-DENY-CLOSED-LINK", "F03", "uses"),
        edge("FIX-DENY-SHIPPED-DELIVERS", "G03", "uses"),
        edge("FIX-DENY-EDIT-ACTIVE", "D03", "uses"),
        edge("FIX-ALLOW-SUCCEED", "D02", "uses"),
        edge("FIX-EXPORT-L02-GOLDEN", "L02", "uses"),
        edge("FIX-ALLOW-AUDIT-CLIENT", "M02", "uses"),
        edge("FIX-DENY-AUDIT-CROSS-CLIENT", "M02", "uses"),
        edge("CTL-AC-3", "B01", "conforms_to"),
        edge("CTL-AC-6", "A11", "conforms_to"),
    ]:
        ensure_edge(data, e)

    # ---------- 7. Clear STIG TBD + map steered STIGs on A01–A11 / CTL* / MC* / ARCH-OTEL ----------
    stig_maps = {
        "A01": (
            "NIST-IA-2",
            "NIST IA-2 / AC-3 / AU-2/3/12. STIG ASD V6R4 STIG-V-222536 (password length IdP-delegated); no local passwords; MFA at IdP.",
        ),
        "A02": (
            "NIST-AC-12",
            "NIST AC-12 session termination; AU-2/3/12 logout audit. STIG ASD V6R4 STIG-V-222578 / STIG-V-222391 / STIG-V-222550.",
        ),
        "A03": (
            "NIST-AC-3",
            "NIST AC-3/AC-6 least privilege via server-bound scope. STIG ASD V6R4 STIG-V-222429 / STIG-V-222550.",
        ),
        "A04": (
            "NIST-AC-3",
            "NIST AC-3 access enforcement on scope clear/change. STIG ASD V6R4 STIG-V-222578 / STIG-V-222389.",
        ),
        "A05": (
            "NIST-AC-3",
            "NIST AC-3 self-read boundary; AU access logging where required. STIG ASD V6R4 STIG-V-222430.",
        ),
        "A06": (
            "NIST-IA-2",
            "NIST IA-2/AC-2 account/identity linkage; AU-2/3/12 admin actions. STIG ASD V6R4 STIG-V-222542 / STIG-V-222407.",
        ),
        "A07": (
            "NIST-AC-2",
            "NIST AC-2/AC-3/AC-6 grant administration. STIG ASD V6R4 STIG-V-222542 / STIG-V-222467 / STIG-V-222429.",
        ),
        "A08": (
            "NIST-AC-2",
            "NIST AC-2/AC-3 revoke path; AU-2/3/12. STIG ASD V6R4 STIG-V-222467 / STIG-V-222407.",
        ),
        "A09": (
            "NIST-AC-2",
            "NIST AC-2 account management for steward roles; AU-2/3/12. STIG ASD V6R4 STIG-V-222407 / STIG-V-222467.",
        ),
        "A10": (
            "NIST-AC-2",
            "NIST AC-2/AC-3 steward revoke; AU-2/3/12. STIG ASD V6R4 STIG-V-222467.",
        ),
        "A11": (
            "NIST-AC-3",
            "NIST AC-3 least disclosure of grant listings; AU optional. STIG ASD V6R4 STIG-V-222430.",
        ),
        "CTL-AC-3": (
            "NIST-AC-3",
            "Conforms to NIST AC-3 (Access Enforcement). STIG ASD V6R4 STIG-V-222429 / STIG-V-222430.",
        ),
        "CTL-AU-2": (
            "NIST-AU-2",
            "NIST AU-2/3/12 event content. STIG ASD V6R4 STIG-V-222578 / STIG-V-222441 / STIG-V-222464.",
        ),
        "CTL-IA-2": (
            "NIST-IA-2",
            "NIST IA-2 organizational users. STIG ASD V6R4 STIG-V-222536 (IdP MFA/password policy).",
        ),
        "CTL-SC-8": (
            "NIST-SC-8",
            "NIST SC-8 transmission confidentiality. STIG ASD V6R4 STIG-V-222567 / STIG-V-222396 / STIG-V-222596.",
        ),
        "CTL-AC-6": (
            "NIST-AC-6",
            "Conforms to NIST AC-6 (Least Privilege). STIG ASD V6R4 STIG-V-222429 / STIG-V-222430 / STIG-V-222550.",
        ),
        "CTL-AU-6": (
            "NIST-AU-6",
            "Conforms to NIST AU-6 (Audit Record Review). STIG ASD V6R4 STIG-V-222464. Pairs jordan-auditor.",
        ),
        "MC01": (
            "NIST-SC-8",
            "NIST IA/AC/AU/SC; desk sealing pattern (OC ADR 0018 analogue). STIG ASD V6R4 STIG-V-222567 / STIG-V-222596.",
        ),
        "MC01.1": (
            "NIST-SC-8",
            "Draft successor refining desk-seal wording. STIG ASD V6R4 STIG-V-222567 / STIG-V-222396.",
        ),
        "MC02": (
            "NIST-AC-3",
            "NIST AC-3/CM-3/AU; mutations not on desk socket. STIG ASD V6R4 STIG-V-222567.",
        ),
        "ARCH-OTEL": (
            "NIST-AU-2",
            "NIST AU-2/3/6/12. STIG ASD V6R4 STIG-V-222578 (session ID destroy complements audit lifecycle).",
        ),
        "CAP-SCOPED-VIEW": (
            "REQALM-SEC-SCOPE",
            "Server-bound Client Scoped View. STIG ASD V6R4 STIG-V-222429 / STIG-V-222550.",
        ),
    }
    for uid, (cref, note) in stig_maps.items():
        v = find_ver(data, uid)
        if not v:
            continue
        v["security"] = {"catalog_ref": cref, "verification_note": note}

    # ---------- 8. Stamp bare rbac_op / ARCH / FIX rows ----------
    # Default mutators/reads → NIST-AC-3; catalog H* → REQALM-SEC-CATALOG; IO L* → NIST-AC-3+AU note
    for v in data["requirement_versions"]:
        uid = v["uid"]
        op = v.get("rbac_op") or ""
        base = v.get("base_uid") or ""

        # steered thin ARCH stamps
        if uid == "ARCH-API" or uid == "ARCH-API-LAYERS" or uid == "ARCH-UI":
            stamp_security(v, "NIST-AC-3", "Architecture enforces AC-3 via adapters/guards/layers.")
        elif uid == "ARCH-RELEASE-FREEZE" or uid == "FIX-REL-SNAP":
            stamp_security(
                v,
                "NIST-CM-3",
                "NIST CM-3 configuration change control on shipped delivers. STIG ASD V6R4 STIG-V-222407 context.",
            )
        elif uid == "ARCH-VER-TOMB":
            stamp_security(v, "NIST-AU-12", "Tombstone/obsolete path generates auditable succession (AU-12).")
        elif uid.startswith("FIX-SUCC-2HOP"):
            stamp_security(v, "NIST-CM-3", "Succession immutability / change control (CM-3).")

        if v.get("security"):
            continue
        if not op and not uid.startswith(("ARCH-", "CAP-", "FIX-")):
            continue

        if base.startswith("H") or op.startswith("catalog:"):
            stamp_security(
                v,
                "REQALM-SEC-CATALOG",
                "Catalog steward gates; standard catalogs read-only. NIST AC-3/CM-5 aligned.",
            )
        elif base.startswith("L") or op.startswith("io:"):
            stamp_security(
                v,
                "NIST-AC-3",
                "NIST AC-3 scoped export/import; AU-2/3/12 on interchange actions.",
            )
        elif uid.startswith("MC") or "mcp:" in op or "desk:" in op:
            # keep existing if any; else SC-8/RBAC
            if "mcp:authorize" in op or uid == "MC03":
                stamp_security(v, "REQALM-SEC-RBAC", "MCP uses same RBAC pack as UI.")
            else:
                stamp_security(v, "NIST-SC-8", "NIST SC-8 / REQALM-SEC-MCP. STIG ASD V6R4 STIG-V-222567.")
        elif op or uid.startswith(("ARCH-", "CAP-", "FIX-")):
            stamp_security(
                v,
                "NIST-AC-3",
                "NIST AC-3 access enforcement; AU-2/3/12 where mutating.",
            )

    # ---------- 9. Enrich thin statements (2–4 sentences where decided) ----------
    enrich = {
        "G08": """A Reader lists releases for the scoped project. ReqALM returns planned and shipped releases with
dates and status, permission-filtered by project grants. Cross-client leakage is blocked by server-bound
Client Scoped View. List reads are low-sensitivity but still scoped.""",
        "I05": """An Author removes an artifact attachment. ReqALM deletes the artifact row; the capability version
remains. The removal is audited (actor, capability UID, prior URI). Downstream packs that referenced the
URI must re-attach if still needed.""",
        "CAP-TREE": """Capability pack covering line create/move/reorder, tree views, and search for the requirements shell
(mockup 01). Authors mutate structure under project grants; Readers expand/collapse and search within
Client Scoped View. All structure mutations audit actor and affected base_uid.""",
        "CAP-CONTRACT-UI": """Capability pack for contract list/detail and document view from contract (mockups 02–03).
Document view builds from in_scope_of version UIDs with optional context-parent walk. Closed contracts
freeze membership; Readers still open document views read-only.""",
        "CAP-VERSION-UI": """Capability pack for version succession, lineage, and compare UX (mockup 04). Authors create
successors; published tips are immutable and require .N+1 for edits. Compare shows field-level diffs used
by FIX-COMPARE-2HOP across multi-hop lineages.""",
        "CAP-AUDIT": """Capability pack for entity/client audit log reads and OTEL export configuration used by auditors
and ops. Auditor role allows audit:client:read within granted clients; cross-client reads deny.
Ops configures sinks without granting domain write.""",
        "CAP-SSO": """Capability pack for federated SSO session establishment and teardown against the enterprise IdP.
Covers sign-in and sign-out paths used by UI and MCP hosts. No local passwords; MFA and authenticator
policy live at the IdP (NIST IA-2/IA-5, STIG-V-222536/542).""",
        "CAP-RBAC": """Capability pack for project_grant create/revoke/list and permission checks used by business services
on every mutating API. Effective permissions recompute from active grants only; revoked tombstones never
authorize. Aligns to CTL-AC-2 / CTL-AC-6 / REQALM-SEC-RBAC.""",
        "CAP-MCP-DESK": """Capability pack for ReqALM MCP server, desk list/attach, and session-sealed desk WebSocket.
Mutations stay on HTTPS; the desk socket is push-only. MCP authorization reuses the same RBAC pack as the
UI (MC03); race-safe session sealing maps to STIG-V-222567.""",
        "CAP-SCOPED-VIEW": """Capability pack for selecting, clearing, and binding Client Scoped View on the server session.
UI App providers consume the bound clientId for navigation guards. Scope change and clear are audited;
server rejects cross-client resource access even if the client id appears in a forged request.""",
        "J07": """A Reader views sync status and last sync timestamps for a requirement–work-item link.
ReqALM returns link state, last push/pull times, and any unresolved conflict flag without exposing
external system credentials. Missing links return an empty status, not an error.""",
        "J08": """An Author disconnects a work-item link. ReqALM removes the mapping and audits the disconnect;
the external work item is left unchanged. Subsequent push/pull against the version fails until remapped.""",
        "K05": """A Reader views the work track for an iteration — versions assigned to that window with grooming state
and priorities. Data is scoped to the bound client/project. This is a read model over existing version
fields; it does not invent a separate planning store.""",
        "K06": """A Reader compares release delivers membership against the iteration work track to spot gaps
(planned vs committed). Gantt/schedule overlays remain exploratory (see G07) and are not core product
requirements. Gap view is informational only.""",
        "F04": """An Author links a requirement version UID into a contract's in_scope_of set. ReqALM validates the
version exists in the scoped project and rejects links when the contract is closed (FIX-DENY-CLOSED-LINK).
The junction change is audited.""",
        "F05": """An Author unlinks a version UID from a contract. ReqALM removes the junction membership and audits
the change. Closed contracts reject unlink as well as link; versions themselves are untouched.""",
        "F10": """A Reader lists contracts for the scoped client/project. ReqALM returns name, status, and date fields
permission-filtered to the caller's access. Closed contracts appear in lists but membership is frozen.""",
        "G01": """A Release manager creates a planned release with name and planned_on date. ReqALM inserts a release
row with empty delivers and status planned. Creation is audited; shipped snapshots cannot be created
directly — ship is a separate action (G05).""",
        "G02": """A Release manager updates a planned release's name or planned_on. Shipped releases reject metadata
edits. Updates are audited; this does not alter the delivers UID set (see G03).""",
        "G05": """A Release manager ships a release. ReqALM sets status shipped, records shipped_on, and freezes
delivers as an immutable snapshot. Ship is a high-value auditable event (AU-2/3/12). Further delivers
mutations deny (FIX-DENY-SHIPPED-DELIVERS).""",
        "G06": """A Reader diffs a release snapshot against a prior release. ReqALM computes added/removed/unchanged
version UIDs from frozen delivers sets. Diff is read-only and scoped to the project.""",
        "H04": """A steward adds a catalog entry (id + title template) to a mutable catalog. ReqALM rejects duplicate
ids and rejects adds on is_standard catalogs. The add is audited (actor, catalog_id, entry id).""",
        "H05": """A steward updates an entry in a non-standard catalog. Standard catalog entries are read-only;
ReqALM returns a conflict if the catalog is_standard (FIX-DENY-STEWARD-STANDARD). Morgan's project
steward grant on cat-reqalm-security enables the happy path (FIX-ALLOW-STEWARD-UPDATE).""",
        "H08": """A steward deprecates a catalog item. ReqALM marks the entry deprecated for browse UI; existing
requirement catalog_ref links remain valid. Deprecation is audited and forbidden on locked standard
entry rewrite paths.""",
        "I01": """An Author creates a capability-kind line (or promotes a requirement to capability packaging).
ReqALM inserts a requirement_line with kind=capability and an initial version. Artifacts attach in
later steps (I03); create is audited.""",
        "I04": """An Author updates or replaces an artifact URI on a version. ReqALM audits before/after URI; kind may
stay the same. Invalid URIs fail validation (SI-10) before persistence.""",
        "ARCH-API": """API is schema-first (Zod + OpenAPI): HTTP adapters validate DTOs, RBAC authorizes, business services
orchestrate, data providers implement repositories against Postgres. Invalid input never reaches domain
mutations (CTL-SI-10). The same stack serves UI and MCP tools.""",
        "ARCH-API-LAYERS": """HTTP adapters do not embed SQL. Business services own orchestration and authorization calls; repositories
own persistence. This layering is mandatory for MCP tools and UI clients alike and keeps AC-3 checks in
one place (ARCH-API-RBAC).""",
        "ARCH-UI": """UI stack is App (auth + ClientScope) → Routes + guards → Layout → Page → View → pure components,
with optional stores scoped by clientId. Pages own data fetching; views stay presentational where practical.
Route guards enforce AC-3 in the shell (ARCH-UI-GUARD) but server RBAC remains authoritative.""",
        "ARCH-OTEL": """Security-relevant actions emit structured audit events exported via OTEL (OTLP) for centralized
review, aligned to NIST AU-2/3/6/9/12. Session teardown destroys session identifiers (STIG-V-222578).
Auditors read via M01/M02; actors cannot alter prior audit rows (CTL-AU-9).""",
        "ARCH-RELEASE-FREEZE": """On ship, ReqALM freezes the delivers list as an immutable snapshot. Further edits require a new planned
release or an explicit reopen policy (out of scope for R0). Diff against prior shipped releases uses UID sets.
Attempts to mutate shipped delivers deny under CTL-CM-3 (FIX-DENY-SHIPPED-DELIVERS).""",
        "ARCH-VER-TOMB": """Soft-delete of a line is expressed by an obsolete or withdrawn successor version, not by deleting
requirement_line rows. Historical contracts and releases that delivered prior UIDs remain coherent.
Succession and tombstone events are auditable (AU-12).""",
        "ARCH-CONTRACT": """Contracts mark requirements in scope of an agreement. (Initial wording — superseded.)""",  # keep obsolete thin
        "D07": """A Reader compares two versions of the same or related UIDs. ReqALM returns a field-level diff of
statement and metadata. Multi-hop lineages (FIX-SUCC-2HOP) are supported so .0 vs .2 compares remain
meaningful for QA (FIX-COMPARE-2HOP).""",
        "E05": """An Author removes an edge. ReqALM deletes or tombstones the edge row and audits actor, kind, and
endpoints. Removal does not cascade-delete requirement versions.""",
        "F03": """A Project admin closes a contract. ReqALM sets status closed and freezes membership edits
(link/unlink/bulk_link deny — FIX-DENY-CLOSED-LINK); requirement versions remain in the store.
Document view stays readable. Reopening requires an explicit admin action (later policy).""",
        "G03": """A Release manager adds or removes requirement version UIDs on a planned release's delivers set.
ReqALM validates UIDs and rejects mutations on shipped releases (FIX-DENY-SHIPPED-DELIVERS). Membership
changes on planned releases are audited; freeze pairs ARCH-RELEASE-FREEZE / CTL-CM-3.""",
        "D03": """An Author edits fields on a draft version (statement, metadata). ReqALM allows mutation only while
status is draft; active/obsolete/withdrawn rows are immutable and require a successor for changes
(FIX-DENY-EDIT-ACTIVE, CTL-CM-3). Draft updates are audited.""",
        "L02": """An Author exports a project tree or contract document view to StrictDoc interchange. ReqALM emits
.sdoc suitable for external tools; Postgres remains authoritative. For contract-fixture-doc-walk with
context parents off, the exported UID set must equal {A01, A02, CTL-AC-3} (FIX-EXPORT-L02-GOLDEN).""",
        "M04": """Any authenticated caller (or public probe per deploy policy) reads health and API version.
ReqALM returns readiness without leaking client data. Health is not a substitute for scoped resource
authorization.""",
        "N03": """A Reader uses global search across titles and statements in the scoped client. Results deep-link to
lines/versions and never include hits from other clients. Search respects the same AC-3 scope bind as
tree reads.""",
        "CTL-SC-8": """All UI, API, and MCP HTTP traffic uses TLS. Desk WebSockets are session-sealed WSS. ReqALM rejects
cleartext mutators. Aligns to NIST SC-8 and STIG-V-222567 / STIG-V-222396 / STIG-V-222596.""",
        "B02": """A client admin updates client display name or metadata. ReqALM persists the change without altering
project membership or grants. The update is audited (actor, client_id, fields). Pat Client-Admin on
raby-family is the dogfood actor for client-level mutations.""",
        "B04": """A Project admin creates a project under the scoped client. ReqALM inserts a project row; grants are
not auto-created beyond the creating admin policy already decided. Create is audited and AC-3 gated.""",
        "B05": """A Project admin updates project display name or notes. ReqALM persists metadata without moving the
project across clients. Updates are audited.""",
        "B06": """A Project admin archives a project. ReqALM marks the project inactive and blocks new mutating work
while preserving historical versions, contracts, and releases. Archive is audited.""",
        "B08": """A Reader lists projects in the scoped client. ReqALM returns only projects the caller can access
under active grants within the bound client — never a cross-client dump.""",
    }
    for uid, stmt in enrich.items():
        v = find_ver(data, uid)
        if v and uid != "ARCH-CONTRACT":  # leave obsolete initial wording
            v["statement"] = stmt.strip()

    # ---------- 10. audit_events (happy + deny samples) ----------
    existing_ae = {a["id"] for a in data.get("audit_events") or []}
    new_aes = [
        {
            "id": "ae-allow-pat-client-create",
            "at": "2026-10-06T11:00:00-04:00",
            "identity_id": "pat-client-admin",
            "client_id": "raby-family",
            "project_id": None,
            "action": "client:create",
            "outcome": "allow",
            "http_status": 201,
            "notes": "FIX-ALLOW-CLIENT-CREATE sample row.",
        },
        {
            "id": "ae-allow-dan-grant-create",
            "at": "2026-10-06T11:05:00-04:00",
            "identity_id": "dan",
            "client_id": "raby-family",
            "project_id": "reqalm",
            "action": "project:grant:create",
            "outcome": "allow",
            "http_status": 201,
            "notes": "Project admin grant-create happy path (contrast ae-deny-reader-grant-create).",
        },
        {
            "id": "ae-allow-scope-select",
            "at": "2026-10-06T11:10:00-04:00",
            "identity_id": "dan",
            "client_id": "raby-family",
            "project_id": "reqalm",
            "action": "client:scope:select",
            "outcome": "allow",
            "http_status": 200,
            "notes": "A03 scoped view select happy path.",
        },
        {
            "id": "ae-deny-release-ship-reader",
            "at": "2026-10-06T11:15:00-04:00",
            "identity_id": "casey-reader",
            "client_id": "raby-family",
            "project_id": "reqalm",
            "action": "release:ship",
            "outcome": "deny",
            "http_status": 403,
            "notes": "Reader denied release:ship (pairs FIX-DENY-MCP-ESCALATE / G05).",
        },
        {
            "id": "ae-deny-steward-standard",
            "at": "2026-10-06T11:20:00-04:00",
            "identity_id": "morgan-steward",
            "client_id": "raby-family",
            "project_id": "reqalm",
            "action": "catalog:entry:update",
            "outcome": "deny",
            "http_status": 403,
            "notes": "FIX-DENY-STEWARD-STANDARD: morgan cannot mutate cat-nist-global.",
        },
        {
            "id": "ae-allow-morgan-steward-update",
            "at": "2026-10-06T11:25:00-04:00",
            "identity_id": "morgan-steward",
            "client_id": "raby-family",
            "project_id": "reqalm",
            "action": "catalog:entry:update",
            "outcome": "allow",
            "http_status": 200,
            "notes": "FIX-ALLOW-STEWARD-UPDATE on cat-reqalm-security.",
        },
        {
            "id": "ae-deny-closed-link",
            "at": "2026-10-06T11:30:00-04:00",
            "identity_id": "alex-author",
            "client_id": "raby-family",
            "project_id": "reqalm",
            "action": "contract:link",
            "outcome": "deny",
            "http_status": 409,
            "notes": "FIX-DENY-CLOSED-LINK against contract-legacy-intake-closed.",
        },
        {
            "id": "ae-deny-shipped-delivers",
            "at": "2026-10-06T11:35:00-04:00",
            "identity_id": "riley-release",
            "client_id": "raby-family",
            "project_id": "reqalm",
            "action": "release:membership",
            "outcome": "deny",
            "http_status": 409,
            "notes": "FIX-DENY-SHIPPED-DELIVERS on R0-sequences.",
        },
        {
            "id": "ae-deny-edit-active",
            "at": "2026-10-06T11:40:00-04:00",
            "identity_id": "alex-author",
            "client_id": "raby-family",
            "project_id": "reqalm",
            "action": "requirement:version:update_draft",
            "outcome": "deny",
            "http_status": 409,
            "notes": "FIX-DENY-EDIT-ACTIVE on active A01.",
        },
        {
            "id": "ae-allow-succeed",
            "at": "2026-10-06T11:45:00-04:00",
            "identity_id": "alex-author",
            "client_id": "raby-family",
            "project_id": "reqalm",
            "action": "requirement:version:succeed",
            "outcome": "allow",
            "http_status": 201,
            "notes": "FIX-ALLOW-SUCCEED sample row.",
        },
        {
            "id": "ae-deny-audit-cross-client",
            "at": "2026-10-06T11:50:00-04:00",
            "identity_id": "jordan-auditor",
            "client_id": "other-family",
            "project_id": None,
            "action": "audit:client:read",
            "outcome": "deny",
            "http_status": 403,
            "notes": "FIX-DENY-AUDIT-CROSS-CLIENT sample row.",
        },
    ]
    data.setdefault("audit_events", [])
    for ae in new_aes:
        if ae["id"] not in existing_ae:
            data["audit_events"].append(ae)

    # ---------- 11. L02 golden fixture file ----------
    FIXTURES.mkdir(parents=True, exist_ok=True)
    golden = FIXTURES / "L02-contract-fixture-doc-walk.uids.txt"
    golden.write_text("# context parents OFF — UID set must equal contract-fixture-doc-walk.in_scope_of\nA01\nA02\nCTL-AC-3\n", encoding="utf-8")

    # ---------- 12. Keep G07 minimal (exploratory; do not elevate) ----------
    g07 = find_ver(data, "G07")
    if g07:
        g07["statement"] = (
            "A Reader opens a schedule view derived from releases, priorities, and iterations. ReqALM provides "
            "data for Gantt-style overlays; planning mockups 05* are exploratory and not locked UI. "
            "This remains a thin read model — not a core planning/Gantt product requirement."
        )
        if not g07.get("security"):
            stamp_security(g07, "NIST-AC-3", "Read-only schedule overlay; exploratory — not core Gantt product.")

    dump(data)
    print("patched", SRC)
    print("golden", golden)


if __name__ == "__main__":
    main()
