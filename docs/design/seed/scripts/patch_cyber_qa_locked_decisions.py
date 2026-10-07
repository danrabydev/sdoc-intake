#!/usr/bin/env python3
"""Encode Cyber+QA locked decisions (hash/status, approval-clear, suspect, ConformsTo, P0 extras).

Idempotent: safe to re-run. Does NOT git commit.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"

NIST = "nist-800-53@rev5-dogfood-20261006"
SEC = {"catalog_ref": "AC-3", "verification_note": "AC-3 access enforcement; AU-2/3/12 where mutating."}
SEC_AU = {"catalog_ref": "AU-2", "verification_note": "AU-2/3/12 workflow / approval / suspect audit."}
SEC_CM = {"catalog_ref": "CM-3", "verification_note": "CM-3 change control; mint kinds / succession."}
SEC_CAT = {
    "catalog_ref": "REQAML-SEC-CATALOG",
    "verification_note": "Catalog/ConformsTo authority; imprint pins. AC-3/CM-5.",
}

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 1200
yaml.indent(mapping=2, sequence=2, offset=0)


def cm(**kwargs):
    m = CommentedMap()
    for k, v in kwargs.items():
        m[k] = v
    return m


def line(base_uid, parent, kind, title, project_id="reqaml"):
    return cm(base_uid=base_uid, project_id=project_id, parent=parent, kind=kind, title=title)


def ver(uid, base_uid, statement, *, status="active", priority=20, iteration="iter-r1",
        rbac_op=None, security=None, version_n=0, **extra):
    m = cm(uid=uid, base_uid=base_uid, version_n=version_n, status=status, statement=statement)
    if priority is not None:
        m["priority"] = priority
    if iteration is not None:
        m["iteration"] = iteration
    if rbac_op:
        m["rbac_op"] = rbac_op
    m["security"] = security or deepcopy(SEC)
    for k, v in extra.items():
        m[k] = v
    return m


def add_conforms(edges, from_uid, controls=("AC-3", "AU-2", "AU-3", "AU-12")):
    existing = {(e.get("from"), e.get("to"), e.get("kind")) for e in edges}
    for c in controls:
        key = (from_uid, c, "conforms_to")
        if key not in existing:
            edges.append(cm(**{"from": from_uid, "to": c, "kind": "conforms_to", "catalog_imprint_id": NIST}))


def find_ver(versions, uid):
    for v in versions:
        if v.get("uid") == uid:
            return v
    raise KeyError(uid)


def find_line(lines, base_uid):
    for ln in lines:
        if ln.get("base_uid") == base_uid:
            return ln
    raise KeyError(base_uid)


def has_line(lines, base_uid):
    return any(ln.get("base_uid") == base_uid for ln in lines)


def has_ver(versions, uid):
    return any(v.get("uid") == uid for v in versions)


def has_audit(events, eid):
    return any(e.get("id") == eid for e in events)


def ensure_gate(gates, gate):
    for i, g in enumerate(gates):
        if g.get("id") == gate["id"]:
            gates[i] = gate
            return
    gates.append(gate)


def ensure_hook(hooks, hook):
    for i, h in enumerate(hooks):
        if h.get("id") == hook["id"]:
            hooks[i] = hook
            return
    hooks.append(hook)


def ensure_binding(bindings, rb):
    for i, b in enumerate(bindings):
        if b.get("id") == rb["id"]:
            bindings[i] = rb
            return
    bindings.append(rb)


NEW_UIDS = [
    # Decision 1 — mint kinds / status
    "ARCH-MINT-KIND",
    "FIX-ALLOW-PIN-MIGRATE-MINT",
    "FIX-DENY-NOOP-CONTENT",
    "FIX-ALLOW-STATUS-SUPERSEDE",
    "FIX-DENY-SECOND-ACTIVE",
    # Decision 2 — approval-clear downstream
    "FIX-PLANNING-BLOCKED-AFTER-CONTENT-N",
    "FIX-GRANDFATHER-SEED-APPROVED",
    # Decision 3 — suspect links
    "ARCH-SUSPECT",
    "ARCH-SUSPECT-QUEUE",
    "FIX-SUSPECT-ON-CONTENT-N",
    "FIX-ALLOW-SUSPECT-CARRY",
    "FIX-ALLOW-SUSPECT-KEEP-PINNED",
    "FIX-ALLOW-SUSPECT-DROP",
    "FIX-DENY-SHIP-WITH-OPEN-SUSPECT",
    # Decision 4 — ConformsTo authority
    "FIX-DENY-AUTHOR-PIN-APPLY",
    "FIX-ALLOW-PIN-REQUEST",
    "FIX-ALLOW-SECURITY-PIN-APPLY",
    # Extra P0
    "FIX-DENY-APPROVE-WITHOUT-SLOT",
    "FIX-ALLOW-APPROVE-LINE",
    "ARCH-GATE-SIGNOFF",
    "FIX-DENY-SHIP-UNSIGNED",
]

LINE_META = {
    "ARCH-MINT-KIND": ("SEC-WF", "requirement", "Mint kinds: content|status|pin|security_meta; noop gate = content only"),
    "FIX-ALLOW-PIN-MIGRATE-MINT": ("SEC-FIX", "requirement", "Allow pin-only .N mint (exempt from content noop)"),
    "FIX-DENY-NOOP-CONTENT": ("SEC-FIX", "requirement", "Deny content mint when statement_hash equals head"),
    "FIX-ALLOW-STATUS-SUPERSEDE": ("SEC-FIX", "requirement", "Allow in-place superseded / status-only terminal"),
    "FIX-DENY-SECOND-ACTIVE": ("SEC-FIX", "requirement", "Deny second active tip on same line"),
    "FIX-PLANNING-BLOCKED-AFTER-CONTENT-N": ("SEC-FIX", "requirement", "planning_blocked after content .N until re-approve"),
    "FIX-GRANDFATHER-SEED-APPROVED": ("SEC-FIX", "requirement", "Bootstrap imported_approved / seed ApprovalRecords"),
    "ARCH-SUSPECT": ("SEC-WF", "requirement", "trace_suspect on edges/junctions after content .N"),
    "ARCH-SUSPECT-QUEUE": ("SEC-WF", "requirement", "Suspect review queue: carry / keep-pinned / drop"),
    "FIX-SUSPECT-ON-CONTENT-N": ("SEC-FIX", "requirement", "Content .N marks inbound traces suspect"),
    "FIX-ALLOW-SUSPECT-CARRY": ("SEC-FIX", "requirement", "Allow suspect carry-forward to new tip"),
    "FIX-ALLOW-SUSPECT-KEEP-PINNED": ("SEC-FIX", "requirement", "Allow keep-pinned on suspect edge"),
    "FIX-ALLOW-SUSPECT-DROP": ("SEC-FIX", "requirement", "Allow drop of suspect edge/junction"),
    "FIX-DENY-SHIP-WITH-OPEN-SUSPECT": ("SEC-FIX", "requirement", "Optional profile gate: deny ship with open suspects"),
    "FIX-DENY-AUTHOR-PIN-APPLY": ("SEC-FIX", "requirement", "Deny Author applying ConformsTo pin"),
    "FIX-ALLOW-PIN-REQUEST": ("SEC-FIX", "requirement", "Allow Author conformance_pin_request"),
    "FIX-ALLOW-SECURITY-PIN-APPLY": ("SEC-FIX", "requirement", "Allow Security/Steward pin apply"),
    "FIX-DENY-APPROVE-WITHOUT-SLOT": ("SEC-FIX", "requirement", "Deny approve when actor misses RoleBinding slot"),
    "FIX-ALLOW-APPROVE-LINE": ("SEC-FIX", "requirement", "Allow approve when actor matches slot"),
    "ARCH-GATE-SIGNOFF": ("SEC-WF", "requirement", "gate_signoff record for cyber ship + locked migrate"),
    "FIX-DENY-SHIP-UNSIGNED": ("SEC-FIX", "requirement", "Deny cyber ship until required slots signed"),
}

STATEMENTS = {
    "ARCH-MINT-KIND": (
        "Successor mint carries mint_kind ∈ {content, status, pin, security_meta}. "
        "statement_hash is canonical STATEMENT BODY ONLY (trim + newline canonicalization — see ARCH-SUCCESSION-HASH). "
        "gate-noop-successor-block applies to content mints only: same statement_hash as head → deny (FIX-DENY-NOOP-CONTENT). "
        "status / pin / security_meta mints are exempt from the content no-op gate even when statement_hash is unchanged. "
        "Approval clear policy by mint_kind: content → clear ApprovalRecord; pin migrate → clear (+ DoD AO/Security "
        "gate_signoff on locked migrate then re-approve); status and security_meta → do NOT clear (audit only)."
    ),
    "FIX-ALLOW-PIN-MIGRATE-MINT": (
        "FIXTURE / TEST BED. Author/Security performs requirement:version:mint with mint_kind=pin (locked ConformsTo "
        "migrate successor) where statement_hash equals prior tip → expect HTTP 201. gate-noop-successor-block does "
        "NOT deny. Line ApprovalRecord clears; locked migrate also requires gate_signoff (AO/Security) then re-approve "
        "(ARCH-MINT-KIND / ARCH-GATE-SIGNOFF / ARCH-CAT-MIGRATE)."
    ),
    "FIX-DENY-NOOP-CONTENT": (
        "FIXTURE / TEST BED. Author attempts requirement:version:mint with mint_kind=content and statement_hash equal "
        "to the current head hash → expect HTTP 403/409 and audit outcome=deny (gate-noop-successor-block / "
        "ARCH-SUCCESSION-HASH / ARCH-MINT-KIND). Replaces/aligns FIX-DENY-NOOP-SUCCESSOR for content mints. "
        "Contrast status/pin/security_meta mints which are exempt from this gate."
    ),
    "FIX-ALLOW-STATUS-SUPERSEDE": (
        "FIXTURE / TEST BED. (1) D04 activate of a new tip sets the prior active version status to superseded "
        "IN PLACE in the same transaction (not a new version). (2) Terminal obsolete/withdraw WITHOUT a replacement "
        "tip may be an in-place status change, OR a status-only .N (mint_kind=status) exempt from content no-op and "
        "that does NOT clear ApprovalRecord. Expect allow + audit. Pairs ARCH-VER / D05 / ARCH-MINT-KIND."
    ),
    "FIX-DENY-SECOND-ACTIVE": (
        "FIXTURE / TEST BED. Attempt to leave two versions of the same line with status=active (e.g. succeed without "
        "superseding prior tip, or activate a second tip while prior remains active) → expect HTTP 403/409 and audit "
        "outcome=deny. Invariant: ≤1 active per line (ARCH-VER-SUCC / FIX-ALLOW-SUCCEED rewrite)."
    ),
    "FIX-PLANNING-BLOCKED-AFTER-CONTENT-N": (
        "FIXTURE / TEST BED. After a content mint_kind=.N clears ApprovalRecord, the line is planning_blocked until "
        "re-approve. Priority/grooming/iteration VALUES are RETAINED but D08 (and other profile planning gates) still "
        "DENY mutate while blocked/unapproved. Contract in_scope_of and release delivers membership are NOT auto-dropped "
        "— marked suspect (trace_suspect) instead. Expect priority mutate deny + planning_blocked=true + membership retained."
    ),
    "FIX-GRANDFATHER-SEED-APPROVED": (
        "FIXTURE / TEST BED. Bootstrap/import (L01) and dogfood seed may mint ApprovalRecord status=imported_approved "
        "(or seed approved records) for prioritized lines so load does not fail gate-line-approved. Grandfather is "
        "explicit audit-visible policy — not silent bypass. Contrast unapproved FIX-SAMPLE-UNAPPROVED which still denies D08."
    ),
    "ARCH-SUSPECT": (
        "When a target line receives a content mint_kind=.N, inbound trace edges (satisfies/refines/uses) and "
        "contract in_scope_of / release delivers junctions that pin a prior version of that line are marked "
        "trace_suspect=true. Pin-only migrate (mint_kind=pin) updates the ConformsTo pin and does NOT suspect that pin. "
        "Generalizes catalog_drift to internal traces (P1-1). Detect bed: edge FIX-CONTRACT-DOC-NOCTX → FIX-SUCC-2HOP.1 "
        "(stale uses on superseded UID)."
    ),
    "ARCH-SUSPECT-QUEUE": (
        "Suspect review queue actions: carry-forward (retarget edge/junction to new tip), keep-pinned (acknowledge "
        "stale pin, clear suspect flag without retarget), drop (remove edge/junction). Every reaction is audited. "
        "Role defaults: Satisfies/refines/uses → Author; ConformsTo → Security; contract/release membership → Author + "
        "Release manager. Mirrors ARCH-CAT-REACT pattern for internal traces."
    ),
    "FIX-SUSPECT-ON-CONTENT-N": (
        "FIXTURE / TEST BED. Content .N on FIX-SUCC-2HOP (or any line) marks inbound edges/junctions that still point "
        "at prior version UIDs as trace_suspect. Seed bed: uses edge FIX-CONTRACT-DOC-NOCTX → FIX-SUCC-2HOP.1 already "
        "targets a superseded UID — expect trace_suspect=true after content succession (ARCH-SUSPECT)."
    ),
    "FIX-ALLOW-SUSPECT-CARRY": (
        "FIXTURE / TEST BED. Author (Satisfies/refines/uses) or Author+Release mgr (contract/release) carries a "
        "suspect edge/junction forward to the new tip → expect 200, trace_suspect cleared, audit reaction=carry."
    ),
    "FIX-ALLOW-SUSPECT-KEEP-PINNED": (
        "FIXTURE / TEST BED. Authorized actor keeps a suspect edge pinned at the old version UID → expect 200, "
        "trace_suspect cleared with keep_pinned acknowledgment, audit reaction=keep_pinned."
    ),
    "FIX-ALLOW-SUSPECT-DROP": (
        "FIXTURE / TEST BED. Authorized actor drops a suspect edge or contract/release junction → expect 200, "
        "membership/edge removed, audit reaction=drop."
    ),
    "FIX-DENY-SHIP-WITH-OPEN-SUSPECT": (
        "FIXTURE / TEST BED (optional profile gate gate-no-open-suspect). When profile enables the gate, G05 ship "
        "with any open trace_suspect on delivers (or related edges in scope) → expect 403/409 deny. Commercial default "
        "may leave this gate disabled; DoD/cyber example may enable it."
    ),
    "FIX-DENY-AUTHOR-PIN-APPLY": (
        "FIXTURE / TEST BED. Author attempts catalog:pin:apply (or edge:create:conforms_to apply path) without "
        "conforms_to_applicator RoleBinding → expect 403 and audit deny (FIX-DENY-AUTHOR-PIN-APPLY). Author may only "
        "request (catalog:pin:request). Tree wins over E02/H06/H10 prior wording."
    ),
    "FIX-ALLOW-PIN-REQUEST": (
        "FIXTURE / TEST BED. Author creates conformance_pin_request (ops catalog:pin:request) → expect 201 and audit "
        "allow. Request waits for Security (standards) or Steward (non-standard) apply/deny. Profile slot "
        "conforms_to_applicator may bind Author on commercial profiles."
    ),
    "FIX-ALLOW-SECURITY-PIN-APPLY": (
        "FIXTURE / TEST BED. Security (standards imprint) or Steward (non-standard) with conforms_to_applicator slot "
        "applies (catalog:pin:apply) or denies a conformance_pin_request → expect 200 and audit. AO is approve-only on "
        "locked migrate (gate_signoff), never free pin edit."
    ),
    "FIX-DENY-APPROVE-WITHOUT-SLOT": (
        "FIXTURE / TEST BED. Actor without matching RoleBinding for gate-approver-slot attempts requirement:line:approve "
        "or capability:line:approve → expect 403 and audit deny. Approve hooks evaluate gates_before including "
        "gate-approver-slot (P0-4)."
    ),
    "FIX-ALLOW-APPROVE-LINE": (
        "FIXTURE / TEST BED. Actor matching stakeholder (or solution_approver) RoleBinding performs "
        "requirement:line:approve on an eligible line → expect 200, ApprovalRecord written, audit allow. Pairs D12 / "
        "UI-APPROVE-LINE / gate-approver-slot."
    ),
    "ARCH-GATE-SIGNOFF": (
        "gate_signoff records store subject_kind, subject_id, gate_id, slot, identity_id, decision (approve|deny), "
        "at, note. Required for cyber ship (security_signoff + ao_approve on gate-cyber-ship) and for AO/Security "
        "sign-off on locked catalog migrate before re-approve. ApprovalRecord remains line-only; release/migrate "
        "sign-offs use gate_signoff (P1-4)."
    ),
    "FIX-DENY-SHIP-UNSIGNED": (
        "FIXTURE / TEST BED. Release manager attempts G05 ship on a release with cyber_gate=true while gate-cyber-ship "
        "is enabled and required gate_signoff rows for security_signoff and/or ao_approve are missing → expect 403/409 "
        "deny (ARCH-GATE-SIGNOFF / ARCH-CYBER-GATE)."
    ),
}

# Major rewrites of existing statements
REWRITE = {
    "ARCH-SUCCESSION-HASH": (
        "statement_hash is the canonical hash of the STATEMENT BODY ONLY (trim whitespace; normalize newlines to \\n; "
        "no status, pins, or security metadata in the hash — ARCH-MINT-KIND). Minting a successor .N with "
        "mint_kind=content ALWAYS clears the line ApprovalRecord to unapproved and sets planning_blocked until "
        "re-approve. Same statement_hash content mint is BLOCKED (gate-noop-successor-block / FIX-DENY-NOOP-CONTENT) — "
        "no-op content mint must not launder a clear. mint_kind=pin clears approval (locked migrate also needs "
        "gate_signoff then re-approve). mint_kind=status|security_meta do NOT clear approval (audit only). After clear, "
        "explicit approve is required again even if a later edit restores a prior hash (default)."
    ),
    "ARCH-VER": (
        "Each requirement line has versions with UIDs base_uid or base_uid.N (static append). Children stay on the "
        "parent line (parent = base_uid); there is no cascade fork. INVARIANT: ≤1 active version per line. When a new "
        "tip is activated (D04), the prior active version is set to superseded IN PLACE in the same transaction (not a "
        "new version). Terminal obsolete/withdraw without replacement may be in-place status or a status-only .N "
        "(mint_kind=status) — see D05 / ARCH-MINT-KIND / FIX-ALLOW-STATUS-SUPERSEDE."
    ),
    "ARCH-VER-SUCC": (
        "Succession always increments version_n. uid for version_n 0 is base_uid (or base_uid.0); for n>0 uid is "
        "base_uid.n. Published (active) statement rows are immutable for content; content edits require a new successor "
        "(mint_kind=content). Exactly one active version per line is an INVARIANT (FIX-DENY-SECOND-ACTIVE). On activate "
        "of a new tip, prior active → superseded in-place same txn (FIX-ALLOW-SUCCEED)."
    ),
    "D04": (
        "An Author or Project admin marks a draft version active (lifecycle status only). ReqAML transitions status to "
        "active and, in the SAME transaction, sets any prior active version of the same line to superseded IN PLACE "
        "(not a new version) so the ≤1-active invariant holds (ARCH-VER / FIX-DENY-SECOND-ACTIVE). Activation is audited. "
        "IMPORTANT: activate (D04) is NOT stakeholder approval — approval is ApprovalRecord on the line (ARCH-APPROVAL-LINE / "
        "D12). An active but unapproved / planning_blocked line cannot receive priority mutate (D08)."
    ),
    "D05": (
        "An Author marks content obsolete or withdrawn. Terminal obsolete/withdraw WITHOUT a replacement tip is an "
        "in-place status change on the current tip (or a status-only .N with mint_kind=status, exempt from content "
        "no-op and NOT clearing ApprovalRecord). When a replacement tip exists, the prior tip becomes superseded via "
        "D04 activate — not a separate obsolete successor required for every replacement. Tombstoned lines disappear "
        "from default tree views. Soft-delete remains auditable (ARCH-VER-TOMB / AU-12)."
    ),
    "D08": (
        "An Author sets or clears integer priority on a version ONLY when the line's ApprovalRecord.status is approved "
        "(or imported_approved per FIX-GRANDFATHER-SEED-APPROVED) AND planning_blocked is false (ARCH-APPROVAL-LINE / "
        "gate-line-approved). After a content .N clears approval, priority/grooming/iteration VALUES are retained but "
        "D08 mutate is DENIED while planning_blocked (FIX-PLANNING-BLOCKED-AFTER-CONTENT-N). Contract/release membership "
        "is not auto-dropped — marked suspect. Setting priority on an unapproved/blocked line denies "
        "(FIX-DENY-PRIORITY-UNAPPROVED). Activate (D04) alone does not unlock priority."
    ),
    "FIX-ALLOW-SUCCEED": (
        "FIXTURE / TEST BED. Author with active grant creates successor .N+1 via requirement:version:succeed / mint "
        "(mint_kind=content) on a line with an active tip → 201; in the SAME transaction the prior tip status becomes "
        "superseded (not left active). Demonstrates D02/D04 ≤1-active invariant. Contrast FIX-DENY-SECOND-ACTIVE."
    ),
    "FIX-DENY-NOOP-SUCCESSOR": (
        "FIXTURE / TEST BED — ALIGNED / SUPERSEDED by FIX-DENY-NOOP-CONTENT for mint_kind=content. Retained as alias "
        "pointer: same-hash content mint deny via gate-noop-successor-block. Prefer FIX-DENY-NOOP-CONTENT in new tests. "
        "status/pin/security_meta mints are exempt (ARCH-MINT-KIND)."
    ),
    "E02": (
        "ConformsTo authority is request/apply (permission tree wins). Author may create a conformance_pin_request "
        "(catalog:pin:request) only — Author does NOT apply pins (FIX-DENY-AUTHOR-PIN-APPLY / FIX-ALLOW-PIN-REQUEST). "
        "Security (standards imprint items) or Steward (non-standard) applies or denies via catalog:pin:apply|deny when "
        "bound to profile slot conforms_to_applicator (commercial may bind Author). Applied pin is (catalog_imprint_id, "
        "item_uid) — not a floating project UID pair. AO is approve-only on locked migrate (gate_signoff), never free pin edit."
    ),
    "H06": (
        "A requirement version references a standard catalog item without copying control text (Northline). The live "
        "ConformsTo pin is applied by Security (or profile conforms_to_applicator) as (catalog_imprint_id, item_uid) — "
        "Authors request via conformance_pin_request; they do not store the pin themselves. security.catalog_ref may "
        "mirror the item_uid for browse."
    ),
    "H10": (
        "Security steward (or bound conforms_to_applicator) migrates ConformsTo pins to a new catalog imprint (whole "
        "imprint) or a single catalog item at a chosen hierarchy scope: requirement version, section (line subtree), "
        "document, project, or client. Authors may request migrate; they do not apply. ReqAML always runs a mandatory "
        "dry-run preview (editorial|normative|withdrawn|renumbered) before apply — no silent auto-retarget. Locked pins "
        "migrate only via mint_kind=pin successor .N; draft may retarget in-place after accept. Locked migrate requires "
        "Steward/Security gate plus AO gate_signoff then re-approve; audited (actor, scope, imprint_from/to, accept)."
    ),
    "L02": (
        "An Author exports a project tree or contract document view to StrictDoc interchange. ReqAML emits .sdoc "
        "suitable for external tools; Postgres remains authoritative. For contract-fixture-doc-walk with context "
        "parents off, the exported UID set must equal {A01, A02} — exactly the version UIDs in in_scope_of "
        "(FIX-EXPORT-L02-GOLDEN). Catalog item UIDs (e.g. AC-3) are NEVER members of in_scope_of; they appear only as "
        "ConformsTo pins."
    ),
    "FIX-EXPORT-L02-GOLDEN": (
        "FIXTURE / TEST BED. Exporting contract-fixture-doc-walk with context parents off must emit exactly UID set "
        "{A01, A02} (same as in_scope_of). Golden: seed/fixtures/L02-contract-fixture-doc-walk.uids.txt. AC-3 is a "
        "catalog pin, not a version UID — must NOT appear in in_scope_of or the golden set. Pairs L02 and "
        "FIX-CONTRACT-DOC-NOCTX."
    ),
    "FIX-CONTRACT-DOC-NOCTX": (
        "FIXTURE / TEST BED. Document view from a contract with include-context-parents=false must return exactly the "
        "in_scope_of version UID set (no ancestor section/requirement UIDs outside the junction). Expected set for "
        "contract-fixture-doc-walk: {A01, A02}. Catalog items (AC-3) are not version UIDs and are excluded. "
        "Pairs ARCH-CONTRACT-DOC pattern."
    ),
    "FIX-CONTRACT-DOC-CTX": (
        "FIXTURE / TEST BED. Document view with include-context-parents=true returns in_scope_of UIDs plus walked "
        "parent line versions (section ancestors) for readability. Expected: in_scope_of ∪ parent-walk(A01,A02) "
        "including SEC-IA / SEC-SEC section UIDs — NOT catalog item AC-3. Pairs ARCH-CONTRACT-DOC pattern."
    ),
    "ARCH-CP-SCOPE": (
        "Active clientId lives on the server session (not only in browser local storage). Business services and the "
        "data layer enforce client scope: every query carries a mandatory client_id predicate (repository filter and/or "
        "Postgres RLS). Search, audit, catalogs, grants, and imprint reads never cross clients. Least privilege cannot "
        "be bypassed by crafting URLs. Cross-client denial beds: FIX-DENY-CROSS-CLIENT / FIX-DENY-AUDIT-CROSS-CLIENT."
    ),
    "ARCH-VER-TOMB": (
        "Soft-delete of a line is expressed by obsolete or withdrawn status (in-place terminal, or status-only .N) — "
        "not by deleting requirement_line rows. When replaced by a newer tip, prior active becomes superseded in-place "
        "(D04). Historical contracts and releases that delivered prior UIDs remain coherent (may be marked "
        "trace_suspect). Succession and tombstone events are auditable (AU-12)."
    ),
}

AUDIT_SAMPLES = [
    ("ae-allow-pin-migrate-mint", "requirement:version:mint", "allow", 201,
     "FIX-ALLOW-PIN-MIGRATE-MINT: mint_kind=pin same statement_hash allowed; approval cleared."),
    ("ae-deny-noop-content", "requirement:version:mint", "deny", 409,
     "FIX-DENY-NOOP-CONTENT: mint_kind=content same statement_hash blocked."),
    ("ae-allow-status-supersede", "requirement:version:activate", "allow", 200,
     "FIX-ALLOW-STATUS-SUPERSEDE: prior active → superseded in-place same txn."),
    ("ae-deny-second-active", "requirement:version:activate", "deny", 409,
     "FIX-DENY-SECOND-ACTIVE: would leave two active tips on one line."),
    ("ae-deny-planning-blocked", "requirement:version:priority", "deny", 403,
     "FIX-PLANNING-BLOCKED-AFTER-CONTENT-N: D08 denied while planning_blocked after content .N."),
    ("ae-allow-grandfather-imported", "requirement:line:approve", "allow", 200,
     "FIX-GRANDFATHER-SEED-APPROVED: imported_approved bootstrap for prioritized seed line."),
    ("ae-suspect-on-content-n", "requirement:version:mint", "allow", 201,
     "FIX-SUSPECT-ON-CONTENT-N: content .N marked inbound traces trace_suspect."),
    ("ae-allow-suspect-carry", "trace:suspect:carry", "allow", 200,
     "FIX-ALLOW-SUSPECT-CARRY: carry-forward retarget to new tip; audit reaction=carry."),
    ("ae-allow-suspect-keep-pinned", "trace:suspect:keep_pinned", "allow", 200,
     "FIX-ALLOW-SUSPECT-KEEP-PINNED: keep pinned at old UID; audit reaction=keep_pinned."),
    ("ae-allow-suspect-drop", "trace:suspect:drop", "allow", 200,
     "FIX-ALLOW-SUSPECT-DROP: drop suspect edge/junction; audit reaction=drop."),
    ("ae-deny-ship-open-suspect", "release:ship", "deny", 403,
     "FIX-DENY-SHIP-WITH-OPEN-SUSPECT: gate-no-open-suspect denied ship."),
    ("ae-deny-author-pin-apply", "catalog:pin:apply", "deny", 403,
     "FIX-DENY-AUTHOR-PIN-APPLY: Author cannot apply ConformsTo pin."),
    ("ae-allow-pin-request", "catalog:pin:request", "allow", 201,
     "FIX-ALLOW-PIN-REQUEST: Author created conformance_pin_request."),
    ("ae-allow-security-pin-apply", "catalog:pin:apply", "allow", 200,
     "FIX-ALLOW-SECURITY-PIN-APPLY: Security applied pin via conforms_to_applicator."),
    ("ae-deny-approve-without-slot", "requirement:line:approve", "deny", 403,
     "FIX-DENY-APPROVE-WITHOUT-SLOT: actor missing RoleBinding for gate-approver-slot."),
    ("ae-allow-approve-line", "requirement:line:approve", "allow", 200,
     "FIX-ALLOW-APPROVE-LINE: stakeholder slot matched; ApprovalRecord written."),
    ("ae-deny-ship-unsigned", "release:ship", "deny", 403,
     "FIX-DENY-SHIP-UNSIGNED: missing gate_signoff for security_signoff and/or ao_approve."),
]


def main():
    data = yaml.load(DOGFOOD.read_text(encoding="utf-8"))
    lines = data["requirement_lines"]
    versions = data["requirement_versions"]
    edges = data["edges"]
    audits = data["audit_events"]

    # --- gates ---
    gates = data["gates"]
    ensure_gate(gates, cm(
        id="gate-noop-successor-block",
        subject_kinds=["RequirementVersion", "CapabilityLine"],
        mode="required",
        predicate="payload.mint_kind != 'content' OR payload.statement_hash != subject.head_hash",
        approver_slots=[],
        on_fail="deny",
        deny_fixture="FIX-DENY-NOOP-CONTENT",
        notes="Content-mint only: same-hash deny (ARCH-MINT-KIND / ARCH-SUCCESSION-HASH). status/pin/security_meta exempt.",
    ))
    ensure_gate(gates, cm(
        id="gate-approver-slot",
        subject_kinds=["RequirementLine", "CapabilityLine"],
        mode="required",
        predicate="actor matches RoleBinding for approve slot (stakeholder|solution_approver)",
        approver_slots=["stakeholder", "solution_approver"],
        on_fail="deny",
        deny_fixture="FIX-DENY-APPROVE-WITHOUT-SLOT",
        notes="Approve hooks require RoleBinding slot match (P0-4).",
    ))
    ensure_gate(gates, cm(
        id="gate-no-open-suspect",
        subject_kinds=["Release"],
        mode="optional",
        predicate="no open trace_suspect on delivers / related edges in ship scope",
        approver_slots=[],
        on_fail="deny",
        deny_fixture="FIX-DENY-SHIP-WITH-OPEN-SUSPECT",
        notes="Optional profile gate (ARCH-SUSPECT). Off in commercial default.",
    ))
    ensure_gate(gates, cm(
        id="gate-signoff-complete",
        subject_kinds=["Release"],
        mode="optional",
        predicate="required gate_signoff rows exist for gate-cyber-ship slots when cyber_gate",
        approver_slots=["security_signoff", "ao_approve"],
        on_fail="deny",
        deny_fixture="FIX-DENY-SHIP-UNSIGNED",
        notes="Cyber ship needs gate_signoff records (ARCH-GATE-SIGNOFF).",
    ))
    ensure_gate(gates, cm(
        id="gate-one-active",
        subject_kinds=["RequirementVersion", "CapabilityLine"],
        mode="required",
        predicate="count(active versions for line) <= 1 after mutate",
        approver_slots=[],
        on_fail="deny",
        deny_fixture="FIX-DENY-SECOND-ACTIVE",
        notes="≤1 active per line invariant (ARCH-VER-SUCC).",
    ))

    # --- action hooks ---
    hooks = data["action_hooks"]
    ensure_hook(hooks, cm(
        id="hook-line-approve",
        action_id="requirement:line:approve",
        subject_kind="RequirementLine",
        gates_before=["gate-approver-slot"],
        effects_after=["write_approval_record", "clear_planning_blocked", "mirror_version_stakeholder_approval", "audit"],
        notes="D12 Approve — line + direct children; slot-gated (UI-APPROVE-LINE).",
    ))
    ensure_hook(hooks, cm(
        id="hook-line-approve-tree",
        action_id="requirement:line:approve_tree",
        subject_kind="RequirementLine",
        gates_before=["gate-approver-slot"],
        effects_after=["write_approval_record_batch", "clear_planning_blocked", "mirror_version_stakeholder_approval", "audit"],
        notes="D13 Approve Tree — full descendants; slot-gated (UI-APPROVE-TREE).",
    ))
    ensure_hook(hooks, cm(
        id="hook-cap-approve",
        action_id="capability:line:approve",
        subject_kind="CapabilityLine",
        gates_before=["gate-satisfies-at-create", "gate-approver-slot"],
        effects_after=["write_approval_record", "clear_planning_blocked", "audit"],
        notes="CapabilityLine approval as solution; slot-gated (ARCH-CAP-APPROVE).",
    ))
    ensure_hook(hooks, cm(
        id="hook-mint",
        action_id="requirement:version:mint",
        subject_kind="RequirementVersion",
        gates_before=["gate-noop-successor-block", "gate-one-active"],
        effects_after=[
            "clear_line_approval_if_content_or_pin",
            "set_planning_blocked_if_content",
            "mark_trace_suspect_if_content",
            "supersede_prior_active_on_activate",
            "audit",
        ],
        notes="Mint kinds drive clear/suspect/noop (ARCH-MINT-KIND). Content clears+blocks+suspects; pin clears; status/security_meta audit-only.",
    ))
    ensure_hook(hooks, cm(
        id="hook-activate",
        action_id="requirement:version:activate",
        subject_kind="RequirementVersion",
        gates_before=["gate-one-active"],
        effects_after=["supersede_prior_active", "audit"],
        notes="D04: prior active → superseded in-place same txn.",
    ))
    ensure_hook(hooks, cm(
        id="hook-ship",
        action_id="release:ship",
        subject_kind="Release",
        gates_before=["gate-cyber-ship", "gate-verification-ship", "gate-signoff-complete", "gate-no-open-suspect"],
        effects_after=["audit"],
        notes="Optional gates skipped when disabled on profile. Signoff + suspect gates optional.",
    ))
    ensure_hook(hooks, cm(
        id="hook-pin-request",
        action_id="catalog:pin:request",
        subject_kind="EdgeConformsTo",
        gates_before=[],
        effects_after=["write_conformance_pin_request", "audit"],
        notes="Author request-only path (E02 rewrite).",
    ))
    ensure_hook(hooks, cm(
        id="hook-pin-apply",
        action_id="catalog:pin:apply",
        subject_kind="EdgeConformsTo",
        gates_before=["gate-conforms-applicator"],
        effects_after=["apply_conformance_pin", "audit"],
        notes="Security/Steward (or commercial-bound Author) apply.",
    ))
    ensure_gate(gates, cm(
        id="gate-conforms-applicator",
        subject_kinds=["EdgeConformsTo"],
        mode="required",
        predicate="actor matches RoleBinding slot conforms_to_applicator",
        approver_slots=["conforms_to_applicator"],
        on_fail="deny",
        deny_fixture="FIX-DENY-AUTHOR-PIN-APPLY",
        notes="Tree wins: Author request only unless profile binds Author to applicator slot.",
    ))

    # --- role bindings ---
    bindings = data["role_bindings"]
    ensure_binding(bindings, cm(
        id="rb-commercial-approver-slot",
        profile_id="wf-commercial-default",
        gate_id="gate-approver-slot",
        slot="stakeholder",
        roles=["Client admin"],
        identities=[],
        notes="Approve verb RoleBinding (P0-4).",
    ))
    ensure_binding(bindings, cm(
        id="rb-commercial-cap-approver-slot",
        profile_id="wf-commercial-default",
        gate_id="gate-approver-slot",
        slot="solution_approver",
        roles=["Client admin"],
        identities=[],
        notes="Capability approve slot.",
    ))
    ensure_binding(bindings, cm(
        id="rb-commercial-conforms-applicator",
        profile_id="wf-commercial-default",
        gate_id="gate-conforms-applicator",
        slot="conforms_to_applicator",
        roles=["Security"],
        identities=[],
        notes="Commercial default: Security applies standards pins; profile may bind Author.",
    ))
    ensure_binding(bindings, cm(
        id="rb-dod-conforms-applicator",
        profile_id="wf-dod-cyber",
        gate_id="gate-conforms-applicator",
        slot="conforms_to_applicator",
        roles=["Security"],
        identities=[],
        notes="DoD example: Security applies; Steward for non-standard via separate binding if needed.",
    ))

    # --- workflow profiles: add new gate/hook ids ---
    for prof in data["workflow_profiles"]:
        gids = list(prof.get("gate_ids") or [])
        for gid in ["gate-approver-slot", "gate-one-active", "gate-conforms-applicator",
                    "gate-signoff-complete", "gate-no-open-suspect"]:
            if gid not in gids:
                gids.append(gid)
        prof["gate_ids"] = CommentedSeq(gids)
        hooks_ids = list(prof.get("action_hook_ids") or [])
        for hid in ["hook-activate", "hook-pin-request", "hook-pin-apply"]:
            if hid not in hooks_ids:
                hooks_ids.append(hid)
        prof["action_hook_ids"] = CommentedSeq(hooks_ids)
        if prof.get("id") == "wf-commercial-default":
            dis = list(prof.get("disabled_optional_gates") or [])
            for g in ["gate-no-open-suspect"]:
                if g not in dis and g not in (prof.get("enabled_optional_gates") or []):
                    dis.append(g)
            prof["disabled_optional_gates"] = CommentedSeq(dis)
            en = list(prof.get("enabled_optional_gates") or [])
            if "gate-signoff-complete" not in en:
                en.append("gate-signoff-complete")
            prof["enabled_optional_gates"] = CommentedSeq(en)
        if prof.get("id") == "wf-dod-cyber":
            en = list(prof.get("enabled_optional_gates") or [])
            for g in ["gate-no-open-suspect", "gate-signoff-complete"]:
                if g not in en:
                    en.append(g)
            prof["enabled_optional_gates"] = CommentedSeq(en)

    # --- subject kinds note ---
    for sk in data.get("subject_kinds") or []:
        if sk.get("id") == "RequirementVersion":
            sk["notes"] = (
                "Lifecycle (draft|active|superseded|obsolete|withdrawn), statement_hash (body only), "
                "mint_kind, grooming, priority, planning_blocked downstream."
            )
        if sk.get("id") == "EdgeConformsTo":
            sk["notes"] = "Imprint pin; Author request / applicator apply (conformance_pin_request)."

    # --- approval_records: add imported_approved samples for grandfather demo ---
    ars = data["approval_records"]
    if not any(a.get("id") == "ar-imported-a02" for a in ars):
        ars.append(cm(
            id="ar-imported-a02",
            subject_kind="RequirementLine",
            base_uid="A02",
            status="imported_approved",
            by="system-bootstrap",
            at="2026-10-06T08:00:00-04:00",
            notes="FIX-GRANDFATHER-SEED-APPROVED sample: prioritized seed line grandfathered.",
            approved_version_uid="A02",
            approved_statement_hash="sha256:a02-v0-imported",
        ))

    # --- gate_signoffs collection ---
    if "gate_signoffs" not in data:
        data["gate_signoffs"] = CommentedSeq()
    gso = data["gate_signoffs"]
    if not any(g.get("id") == "gso-sample-r1-security" for g in gso):
        gso.append(cm(
            id="gso-sample-r1-security",
            subject_kind="Release",
            subject_id="rel-r1-core-alm",
            gate_id="gate-cyber-ship",
            slot="security_signoff",
            identity_id="sam-security",
            decision="approve",
            at="2026-10-07T11:00:00-04:00",
            note="SAMPLE partial signoff — ao_approve still missing for FIX-DENY-SHIP-UNSIGNED bed.",
        ))

    # --- conformance_pin_requests collection ---
    if "conformance_pin_requests" not in data:
        data["conformance_pin_requests"] = CommentedSeq()
    cpr = data["conformance_pin_requests"]
    if not any(r.get("id") == "cpr-sample-a01-ac3" for r in cpr):
        cpr.append(cm(
            id="cpr-sample-a01-ac3",
            project_id="reqaml",
            requirement_version_uid="A01",
            catalog_imprint_id=NIST,
            item_uid="AC-3",
            requested_by="alex-author",
            requested_at="2026-10-07T11:20:00-04:00",
            status="pending",
            notes="FIX-ALLOW-PIN-REQUEST sample; Security apply → FIX-ALLOW-SECURITY-PIN-APPLY.",
        ))

    # --- mark FIX-SUCC-2HOP.0/.1 as superseded; edge suspect ---
    for uid in ("FIX-SUCC-2HOP", "FIX-SUCC-2HOP.1"):
        v = find_ver(versions, uid)
        v["status"] = "superseded"
        if uid == "FIX-SUCC-2HOP":
            v["statement"] = (
                "FIXTURE / TEST BED (not a product feature). Version .0 wording — superseded in-place when .1 then .2 "
                "became tip (≤1-active / D04). Detect bed for ARCH-SUSPECT."
            )
        else:
            v["statement"] = (
                "FIXTURE / TEST BED (not a product feature). Version .1 wording — superseded in-place when .2 activated. "
                "An edge intentionally still targets this superseded UID for stale-link / trace_suspect UX tests "
                "(FIX-SUSPECT-ON-CONTENT-N / FIX-SUCC-2HOP.1)."
            )
    find_ver(versions, "FIX-SUCC-2HOP.2")["statement"] = (
        "FIXTURE / TEST BED (not a product feature). Active successor after two superseded hops (.0 → .1 → .2). "
        "Implementers must resolve lineage to .2 while detecting edges that still point at superseded UIDs "
        "(FIX-SUCC-2HOP.1) as trace_suspect (ARCH-SUSPECT)."
    )

    # Mark the stale uses edge as suspect
    for e in edges:
        if e.get("from") == "FIX-CONTRACT-DOC-NOCTX" and e.get("to") == "FIX-SUCC-2HOP.1" and e.get("kind") == "uses":
            e["trace_suspect"] = True
            e["suspect_reason"] = "target line content-succeeded; edge still on superseded .1 (FIX-SUSPECT-ON-CONTENT-N)"

    # --- rewrite existing version statements ---
    for uid, stmt in REWRITE.items():
        find_ver(versions, uid)["statement"] = stmt

    # Tighten D12 / ARCH-APPROVAL-LINE notes for planning_blocked
    d12 = find_ver(versions, "D12")
    if "planning_blocked" not in d12["statement"]:
        d12["statement"] = (
            d12["statement"].rstrip(".")
            + ". Re-approve after content .N clears planning_blocked (FIX-PLANNING-BLOCKED-AFTER-CONTENT-N). "
            "Approve hooks evaluate gate-approver-slot (FIX-DENY-APPROVE-WITHOUT-SLOT / FIX-ALLOW-APPROVE-LINE)."
        )

    # ARCH-CAT-MIGRATE / ARCH-LOCKED pin mint kind note if present
    for uid in ("ARCH-CAT-MIGRATE", "ARCH-LOCKED"):
        try:
            v = find_ver(versions, uid)
            if "mint_kind=pin" not in v["statement"]:
                v["statement"] = (
                    v["statement"].rstrip(".")
                    + " Locked migrate uses mint_kind=pin successor (ARCH-MINT-KIND); clears approval; "
                    "requires gate_signoff then re-approve (ARCH-GATE-SIGNOFF)."
                )
        except KeyError:
            pass

    # Update line titles for rewritten
    title_updates = {
        "ARCH-SUCCESSION-HASH": "statement_hash=body only; content .N clears; noop=content only",
        "ARCH-VER": "Line versions; ≤1 active; prior→superseded in-place on activate",
        "ARCH-VER-SUCC": "Succession UID rules; ≤1 active invariant; supersede same txn",
        "D04": "Activate draft→active; prior active→superseded in-place (≠ approve)",
        "D05": "Terminal obsolete/withdraw in-place or status-only .N",
        "D08": "Priority mutate requires approved + not planning_blocked",
        "E02": "ConformsTo: Author request; Security/Steward apply (tree wins)",
        "H06": "Reference catalog via applicator-applied imprint pin (Author requests)",
        "H10": "Migrate pins: applicator apply; locked=mint_kind=pin + gate_signoff",
        "L02": "StrictDoc export; fixture golden {A01,A02} only",
        "ARCH-CP-SCOPE": "Server-bound clientId + mandatory client_id / RLS",
        "FIX-DENY-NOOP-SUCCESSOR": "ALIGNED→FIX-DENY-NOOP-CONTENT (content mint noop deny)",
        "FIX-ALLOW-SUCCEED": "Succeed .N; prior tip→superseded same txn",
        "FIX-EXPORT-L02-GOLDEN": "Export golden UID set {A01,A02} (no AC-3)",
        "FIX-CONTRACT-DOC-NOCTX": "Doc view no-context = {A01,A02}",
        "FIX-CONTRACT-DOC-CTX": "Doc view + parents = {A01,A02} ∪ section walk",
    }
    for bu, title in title_updates.items():
        try:
            find_line(lines, bu)["title"] = title
        except KeyError:
            pass

    # --- add new lines + versions ---
    new_line_uids = []
    for uid in NEW_UIDS:
        if has_line(lines, uid):
            continue
        parent, kind, title = LINE_META[uid]
        lines.append(line(uid, parent, kind, title))
        new_line_uids.append(uid)

    new_ver_uids = []
    for uid in NEW_UIDS:
        if has_ver(versions, uid):
            # refresh statement on re-run
            find_ver(versions, uid)["statement"] = STATEMENTS[uid]
            continue
        sec = deepcopy(SEC_CAT) if "PIN" in uid or "CONFORMS" in uid or uid.startswith("FIX-ALLOW-SECURITY") or uid.startswith("FIX-DENY-AUTHOR") else deepcopy(SEC)
        if uid.startswith("ARCH-SUSPECT") or uid.startswith("FIX-SUSPECT") or uid.startswith("FIX-ALLOW-SUSPECT") or uid.startswith("FIX-DENY-SHIP"):
            sec = deepcopy(SEC_AU)
        if uid in ("ARCH-MINT-KIND", "FIX-DENY-NOOP-CONTENT", "FIX-ALLOW-STATUS-SUPERSEDE", "FIX-DENY-SECOND-ACTIVE",
                   "FIX-ALLOW-PIN-MIGRATE-MINT"):
            sec = deepcopy(SEC_CM)
        rbac = {
            "ARCH-MINT-KIND": "requirement:version:mint",
            "ARCH-SUSPECT": "trace:suspect",
            "ARCH-SUSPECT-QUEUE": "trace:suspect:queue",
            "ARCH-GATE-SIGNOFF": "gate:signoff",
            "FIX-ALLOW-PIN-MIGRATE-MINT": "requirement:version:mint",
            "FIX-DENY-NOOP-CONTENT": "requirement:version:mint",
            "FIX-ALLOW-STATUS-SUPERSEDE": "requirement:version:activate",
            "FIX-DENY-SECOND-ACTIVE": "requirement:version:activate",
            "FIX-PLANNING-BLOCKED-AFTER-CONTENT-N": "requirement:version:priority",
            "FIX-GRANDFATHER-SEED-APPROVED": "requirement:line:approve",
            "FIX-SUSPECT-ON-CONTENT-N": "requirement:version:mint",
            "FIX-ALLOW-SUSPECT-CARRY": "trace:suspect:carry",
            "FIX-ALLOW-SUSPECT-KEEP-PINNED": "trace:suspect:keep_pinned",
            "FIX-ALLOW-SUSPECT-DROP": "trace:suspect:drop",
            "FIX-DENY-SHIP-WITH-OPEN-SUSPECT": "release:ship",
            "FIX-DENY-AUTHOR-PIN-APPLY": "catalog:pin:apply",
            "FIX-ALLOW-PIN-REQUEST": "catalog:pin:request",
            "FIX-ALLOW-SECURITY-PIN-APPLY": "catalog:pin:apply",
            "FIX-DENY-APPROVE-WITHOUT-SLOT": "requirement:line:approve",
            "FIX-ALLOW-APPROVE-LINE": "requirement:line:approve",
            "FIX-DENY-SHIP-UNSIGNED": "release:ship",
        }.get(uid)
        pri = 15 if uid.startswith("ARCH-") else 20
        versions.append(ver(uid, uid, STATEMENTS[uid], priority=pri, iteration="iter-r1",
                            rbac_op=rbac, security=sec))
        new_ver_uids.append(uid)
        add_conforms(edges, uid)

    # uses edges for key FIX→ARCH links
    link_uses = [
        ("FIX-DENY-NOOP-CONTENT", "ARCH-SUCCESSION-HASH"),
        ("FIX-DENY-NOOP-CONTENT", "ARCH-MINT-KIND"),
        ("FIX-ALLOW-PIN-MIGRATE-MINT", "ARCH-MINT-KIND"),
        ("FIX-ALLOW-STATUS-SUPERSEDE", "ARCH-VER"),
        ("FIX-DENY-SECOND-ACTIVE", "ARCH-VER-SUCC"),
        ("FIX-PLANNING-BLOCKED-AFTER-CONTENT-N", "ARCH-SUCCESSION-HASH"),
        ("FIX-SUSPECT-ON-CONTENT-N", "ARCH-SUSPECT"),
        ("FIX-ALLOW-SUSPECT-CARRY", "ARCH-SUSPECT-QUEUE"),
        ("FIX-ALLOW-SUSPECT-KEEP-PINNED", "ARCH-SUSPECT-QUEUE"),
        ("FIX-ALLOW-SUSPECT-DROP", "ARCH-SUSPECT-QUEUE"),
        ("FIX-DENY-SHIP-WITH-OPEN-SUSPECT", "ARCH-SUSPECT"),
        ("FIX-DENY-AUTHOR-PIN-APPLY", "E02"),
        ("FIX-ALLOW-PIN-REQUEST", "E02"),
        ("FIX-ALLOW-SECURITY-PIN-APPLY", "E02"),
        ("FIX-DENY-APPROVE-WITHOUT-SLOT", "D12"),
        ("FIX-ALLOW-APPROVE-LINE", "D12"),
        ("FIX-DENY-SHIP-UNSIGNED", "ARCH-GATE-SIGNOFF"),
        ("ARCH-MINT-KIND", "ARCH-SUCCESSION-HASH"),
        ("ARCH-SUSPECT", "ARCH-SUCCESSION-HASH"),
        ("ARCH-GATE-SIGNOFF", "ARCH-CYBER-GATE"),
    ]
    existing_edges = {(e.get("from"), e.get("to"), e.get("kind")) for e in edges}
    for frm, to in link_uses:
        key = (frm, to, "uses")
        if key not in existing_edges and has_ver(versions, frm) and has_ver(versions, to):
            edges.append(cm(**{"from": frm, "to": to, "kind": "uses"}))
            existing_edges.add(key)

    # --- audit samples ---
    for eid, action, outcome, http, notes in AUDIT_SAMPLES:
        if has_audit(audits, eid):
            continue
        audits.append(cm(
            id=eid,
            at="2026-10-07T12:00:00-04:00",
            identity_id="alex-author" if outcome == "deny" or "author" in eid else (
                "sam-security" if "security" in eid or "pin-apply" in eid else "pat-client-admin"
            ),
            client_id="raby-family",
            project_id="reqaml",
            action=action,
            outcome=outcome,
            http_status=http,
            notes=notes,
            subject_kind="RequirementLine" if "approve" in action or "line" in action else None,
            subject_id=None,
            payload={"fixture": notes.split(":")[0] if ":" in notes else eid},
        ))

    # Update ae-deny-noop-successor notes to point at new fixture
    for e in audits:
        if e.get("id") == "ae-deny-noop-successor":
            e["notes"] = (
                "ALIGNED→FIX-DENY-NOOP-CONTENT / ae-deny-noop-content: same statement_hash content mint blocked."
            )

    # --- R1 delivers: add new ARCH + critical FIX ---
    for rel in data["releases"]:
        if rel.get("id") != "rel-r1-core-alm":
            continue
        delivers = list(rel.get("delivers") or [])
        for uid in [
            "ARCH-MINT-KIND", "ARCH-SUSPECT", "ARCH-SUSPECT-QUEUE", "ARCH-GATE-SIGNOFF",
            "ARCH-SUCCESSION-HASH", "ARCH-WORKFLOW", "ARCH-APPROVAL-LINE", "ARCH-HOOK-EVAL",
            "ARCH-GATE-MODEL", "ARCH-APPROVER-SLOTS", "ARCH-CP-SCOPE",
            "FIX-DENY-NOOP-CONTENT", "FIX-DENY-SECOND-ACTIVE", "FIX-PLANNING-BLOCKED-AFTER-CONTENT-N",
            "FIX-GRANDFATHER-SEED-APPROVED", "FIX-SUSPECT-ON-CONTENT-N",
            "FIX-DENY-AUTHOR-PIN-APPLY", "FIX-ALLOW-PIN-REQUEST", "FIX-ALLOW-SECURITY-PIN-APPLY",
            "FIX-DENY-APPROVE-WITHOUT-SLOT", "FIX-ALLOW-APPROVE-LINE", "FIX-DENY-SHIP-UNSIGNED",
            "D13", "UI-APPROVE-LINE", "UI-APPROVE-TREE",
        ]:
            if uid not in delivers and has_ver(versions, uid):
                delivers.append(uid)
        rel["delivers"] = CommentedSeq(delivers)

    # Reorder keys: insert new collections after approval_records
    keys = list(data.keys())
    for k in ("gate_signoffs", "conformance_pin_requests"):
        if k in keys:
            keys.remove(k)
    insert_after = "approval_records" if "approval_records" in keys else "role_bindings"
    idx = keys.index(insert_after) + 1
    keys.insert(idx, "gate_signoffs")
    keys.insert(idx + 1, "conformance_pin_requests")
    new_data = CommentedMap()
    for k in keys:
        if k in data:
            new_data[k] = data[k]
    for k in data.keys():
        if k not in new_data:
            new_data[k] = data[k]

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(new_data, f)

    print("Patched", DOGFOOD)
    print("NEW_LINE_UIDS", new_line_uids)
    print("NEW_VER_UIDS", new_ver_uids)
    print("ALL_NEW_UIDS", NEW_UIDS)
    print("REWRITTEN", sorted(REWRITE.keys()))


if __name__ == "__main__":
    main()
