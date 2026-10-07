#!/usr/bin/env python3
"""Encode workflow-system locked decisions into dogfood.yaml (additive)."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"

NIST = "nist-800-53@rev5-dogfood-20261006"
SEC = {"catalog_ref": "AC-3", "verification_note": "AC-3 access enforcement; AU-2/3/12 where mutating."}
SEC_AU = {"catalog_ref": "AU-2", "verification_note": "AU-2/3/12 workflow / approval audit."}
SEC_CM = {"catalog_ref": "CM-3", "verification_note": "CM-3 change control; gate evaluation."}

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 1000
yaml.indent(mapping=2, sequence=2, offset=0)


def cm(**kwargs):
    m = CommentedMap()
    for k, v in kwargs.items():
        m[k] = v
    return m


def line(base_uid, parent, kind, title, project_id="reqaml"):
    return cm(
        base_uid=base_uid,
        project_id=project_id,
        parent=parent,
        kind=kind,
        title=title,
    )


def ver(uid, base_uid, statement, *, status="active", priority=20, iteration="iter-r1",
        rbac_op=None, security=None, version_n=0, **extra):
    m = cm(
        uid=uid,
        base_uid=base_uid,
        version_n=version_n,
        status=status,
        statement=statement,
    )
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


def conforms(from_uid, to_uid="AC-3"):
    return cm(from_=None)  # placeholder unused


def add_conforms(edges, from_uid, controls=("AC-3", "AU-2", "AU-3", "AU-12")):
    for c in controls:
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


def main():
    data = yaml.load(DOGFOOD.read_text(encoding="utf-8"))

    # --- project.workflow_profile_id ---
    proj = data["projects"][0]
    proj["workflow_profile_id"] = "wf-commercial-default"
    notes = proj.get("notes") or ""
    if "workflow_profile" not in notes:
        proj["notes"] = (
            notes.rstrip()
            + " Uses WorkflowProfile wf-commercial-default (ARCH-WORKFLOW)."
        )

    # --- subject_kinds registry ---
    data["subject_kinds"] = CommentedSeq([
        cm(id="RequirementLine", backing="requirement_line",
           kind_filter=["requirement", "section", "control"],
           notes="Client sys-req tree node; approval grain (ARCH-APPROVAL-LINE)."),
        cm(id="CapabilityLine", backing="requirement_line", kind_filter=["capability"],
           notes="Contractor capability; first-class SubjectKind (ARCH-REQ-VS-CAP)."),
        cm(id="RequirementVersion", backing="requirement_version",
           notes="Lifecycle, statement_hash, grooming, priority."),
        cm(id="EdgeSatisfies", backing="edge", kind_filter=["satisfies"],
           notes="Cap→req coverage; created with cap (no orphan caps). Not a separate approve subject by default."),
        cm(id="EdgeConformsTo", backing="edge", kind_filter=["conforms_to"],
           notes="Imprint pin."),
        cm(id="ChangeSet", backing="change_set",
           notes="open/close/revert hooks."),
        cm(id="Release", backing="release",
           notes="Ship / gate-cyber-ship / gate-verification-ship."),
    ])

    # --- gates ---
    data["gates"] = CommentedSeq([
        cm(id="gate-line-approved",
           subject_kinds=["RequirementLine", "RequirementVersion"],
           mode="required",
           predicate="subject.approval.status == approved",
           approver_slots=["stakeholder"],
           on_fail="deny",
           deny_fixture="FIX-DENY-PRIORITY-UNAPPROVED",
           notes="D08 and other profile-selected planning actions require line ApprovalRecord."),
        cm(id="gate-cap-approved",
           subject_kinds=["CapabilityLine"],
           mode="required",
           predicate="subject.approval.status == approved",
           approver_slots=["solution_approver"],
           on_fail="deny",
           notes="CapabilityLine ApprovalRecord accepts solution; Satisfies edge itself not separately approved."),
        cm(id="gate-noop-successor-block",
           subject_kinds=["RequirementVersion", "CapabilityLine"],
           mode="required",
           predicate="payload.statement_hash != subject.head_hash",
           approver_slots=[],
           on_fail="deny",
           deny_fixture="FIX-DENY-NOOP-SUCCESSOR",
           notes="Same-hash / no-op .N mint denied (ARCH-SUCCESSION-HASH)."),
        cm(id="gate-cyber-ship",
           subject_kinds=["Release"],
           mode="optional",
           predicate="release.cyber_gate == true",
           approver_slots=["security_signoff", "ao_approve"],
           on_fail="deny",
           notes="Example Gate instance under WorkflowProfile (ARCH-CYBER-GATE / ARCH-GATE-MODEL)."),
        cm(id="gate-verification-ship",
           subject_kinds=["Release"],
           mode="optional",
           predicate="all delivers.verification_outcome == pass",
           approver_slots=[],
           on_fail="deny",
           notes="Configurable ship gate on verification_outcome (ARCH-VERIFICATION-GATE). Off in commercial default."),
        cm(id="gate-satisfies-at-create",
           subject_kinds=["CapabilityLine", "EdgeSatisfies"],
           mode="required",
           predicate="exists edge satisfies from this cap",
           approver_slots=[],
           on_fail="deny",
           notes="No orphan caps — Satisfies linked at capability creation (ARCH-CAP-LINK)."),
    ])

    # --- action_hooks ---
    data["action_hooks"] = CommentedSeq([
        cm(id="hook-line-approve",
           action_id="requirement:line:approve",
           subject_kind="RequirementLine",
           gates_before=[],
           effects_after=["write_approval_record", "mirror_version_stakeholder_approval", "audit"],
           notes="D12 Approve — line + direct children (UI-APPROVE-LINE)."),
        cm(id="hook-line-approve-tree",
           action_id="requirement:line:approve_tree",
           subject_kind="RequirementLine",
           gates_before=[],
           effects_after=["write_approval_record_batch", "mirror_version_stakeholder_approval", "audit"],
           notes="D13 Approve Tree — full descendants (UI-APPROVE-TREE)."),
        cm(id="hook-cap-approve",
           action_id="capability:line:approve",
           subject_kind="CapabilityLine",
           gates_before=["gate-satisfies-at-create"],
           effects_after=["write_approval_record", "audit"],
           notes="CapabilityLine approval as solution (ARCH-CAP-APPROVE)."),
        cm(id="hook-priority",
           action_id="requirement:version:priority",
           subject_kind="RequirementVersion",
           gates_before=["gate-line-approved"],
           effects_after=["audit"],
           notes="D08 — reads line ApprovalRecord."),
        cm(id="hook-mint",
           action_id="requirement:version:mint",
           subject_kind="RequirementVersion",
           gates_before=["gate-noop-successor-block"],
           effects_after=["clear_line_approval", "audit"],
           notes="Any substantive .N clears line approval; same-hash blocked."),
        cm(id="hook-cap-create",
           action_id="capability:line:create",
           subject_kind="CapabilityLine",
           gates_before=["gate-satisfies-at-create"],
           effects_after=["audit"],
           notes="Create CapabilityLine requires Satisfies target(s) in same mutation."),
        cm(id="hook-ship",
           action_id="release:ship",
           subject_kind="Release",
           gates_before=["gate-cyber-ship", "gate-verification-ship"],
           effects_after=["audit"],
           notes="Profile enables which ship gates evaluate (optional gates skipped when disabled)."),
        cm(id="hook-planning-wi-ready",
           action_id="requirement:version:grooming",
           subject_kind="RequirementVersion",
           gates_before=[],
           effects_after=["audit"],
           notes="Profile may add gate-line-approved to WI-ready / iteration / backlog actions (ARCH-PLANNING-GATES)."),
    ])

    # --- role_bindings ---
    data["role_bindings"] = CommentedSeq([
        cm(id="rb-commercial-stakeholder",
           profile_id="wf-commercial-default",
           gate_id="gate-line-approved",
           slot="stakeholder",
           roles=["Client admin"],
           identities=[],
           notes="Commercial default: Client admin fills stakeholder slot (configurable)."),
        cm(id="rb-commercial-solution",
           profile_id="wf-commercial-default",
           gate_id="gate-cap-approved",
           slot="solution_approver",
           roles=["Client admin"],
           identities=[],
           notes="Same role as stakeholder in commercial default; profile may split."),
        cm(id="rb-cyber-security",
           profile_id="wf-commercial-default",
           gate_id="gate-cyber-ship",
           slot="security_signoff",
           roles=["Security"],
           identities=[],
           notes="Cyber ship Security sign-off slot."),
        cm(id="rb-cyber-ao",
           profile_id="wf-commercial-default",
           gate_id="gate-cyber-ship",
           slot="ao_approve",
           roles=["AO"],
           identities=[],
           notes="Cyber ship AO approve slot."),
        cm(id="rb-dod-stakeholder-example",
           profile_id="wf-dod-cyber",
           gate_id="gate-line-approved",
           slot="stakeholder",
           roles=["AO", "Project admin"],
           identities=[],
           notes="Example DoD-ish binding — project sets actual roles; not hard-coded in engine."),
    ])

    # --- workflow_profiles ---
    data["workflow_profiles"] = CommentedSeq([
        cm(id="wf-commercial-default",
           scope="project",
           client_id="raby-family",
           project_id="reqaml",
           title="Commercial default workflow",
           gate_ids=[
               "gate-line-approved",
               "gate-cap-approved",
               "gate-noop-successor-block",
               "gate-satisfies-at-create",
               "gate-cyber-ship",  # honored when release.cyber_gate=true
           ],
           enabled_optional_gates=["gate-cyber-ship"],
           disabled_optional_gates=["gate-verification-ship"],
           planning_gate_actions=["requirement:version:priority"],
           notes=(
               "Dogfood commercial profile. planning_gate_actions lists which planning mutations require "
               "gate-line-approved (profile-configurable — not priority-only forever; ARCH-PLANNING-GATES). "
               "gate-verification-ship present in catalog but disabled here."
           ),
           action_hook_ids=[
               "hook-line-approve",
               "hook-line-approve-tree",
               "hook-cap-approve",
               "hook-priority",
               "hook-mint",
               "hook-cap-create",
               "hook-ship",
               "hook-planning-wi-ready",
           ]),
        cm(id="wf-dod-cyber",
           scope="client",
           client_id="raby-family",
           project_id=None,
           title="DoD / cyber-oriented workflow (example)",
           gate_ids=[
               "gate-line-approved",
               "gate-cap-approved",
               "gate-noop-successor-block",
               "gate-satisfies-at-create",
               "gate-cyber-ship",
               "gate-verification-ship",
           ],
           enabled_optional_gates=["gate-cyber-ship", "gate-verification-ship"],
           disabled_optional_gates=[],
           planning_gate_actions=[
               "requirement:version:priority",
               "requirement:version:grooming",
               "requirement:version:iteration",
               "release:membership",
           ],
           notes="Example broader planning gates + verification ship. Not attached to reqaml project by default.",
           action_hook_ids=[
               "hook-line-approve",
               "hook-line-approve-tree",
               "hook-cap-approve",
               "hook-priority",
               "hook-mint",
               "hook-cap-create",
               "hook-ship",
               "hook-planning-wi-ready",
           ]),
    ])

    # --- approval_records (line grain SoT) ---
    data["approval_records"] = CommentedSeq([
        cm(id="ar-fix-sample-approved",
           subject_kind="RequirementLine",
           base_uid="FIX-SAMPLE-APPROVED",
           status="approved",
           by="pat-client-admin",
           at="2026-10-06T09:00:00-04:00",
           notes="Line-grain SoT; version stakeholder_approval is denormalized mirror (dual-write).",
           approved_version_uid="FIX-SAMPLE-APPROVED",
           approved_statement_hash="sha256:fix-sample-approved-v0"),
        cm(id="ar-a01",
           subject_kind="RequirementLine",
           base_uid="A01",
           status="approved",
           by="pat-client-admin",
           at="2026-10-05T12:00:00-04:00",
           notes="SAMPLE approved line; pins A01 version + hash.",
           approved_version_uid="A01",
           approved_statement_hash="sha256:a01-v0"),
        cm(id="ar-fix-sample-unapproved",
           subject_kind="RequirementLine",
           base_uid="FIX-SAMPLE-UNAPPROVED",
           status="unapproved",
           by=None,
           at=None,
           notes="Unapproved line — D08 deny via gate-line-approved.",
           approved_version_uid=None,
           approved_statement_hash=None),
        cm(id="ar-wf-sample-req",
           subject_kind="RequirementLine",
           base_uid="FIX-SAMPLE-WF-REQ",
           status="approved",
           by="pat-client-admin",
           at="2026-10-07T10:30:00-04:00",
           notes="Workflow path sample: client sys-req approved before cap solution.",
           approved_version_uid="FIX-SAMPLE-WF-REQ",
           approved_statement_hash="sha256:fix-wf-req-v0"),
        cm(id="ar-wf-sample-cap",
           subject_kind="CapabilityLine",
           base_uid="FIX-SAMPLE-WF-CAP",
           status="approved",
           by="pat-client-admin",
           at="2026-10-07T10:35:00-04:00",
           notes="CapabilityLine approved as solution; Satisfies edge created at cap create (no orphan).",
           approved_version_uid="FIX-SAMPLE-WF-CAP",
           approved_statement_hash="sha256:fix-wf-cap-v0"),
    ])

    # --- new requirement_lines ---
    lines = data["requirement_lines"]
    new_lines = [
        line("SEC-WF", None, "section", "Dynamic workflow system"),
        line("ARCH-WORKFLOW", "SEC-WF", "requirement",
             "Composition: WorkflowProfile + Gate + ActionHook + RoleBinding (not mega-status)"),
        line("ARCH-SUBJECT-KIND", "SEC-WF", "requirement",
             "SubjectKind registry (RequirementLine, CapabilityLine, edges, ChangeSet, Release)"),
        line("ARCH-REQ-VS-CAP", "SEC-WF", "requirement",
             "Client sys-req vs CapabilityLine first-class; canonical need→solution path"),
        line("ARCH-APPROVAL-LINE", "SEC-WF", "requirement",
             "Approval grain = requirement line; pin approved_version_uid + statement_hash"),
        line("ARCH-SUCCESSION-HASH", "SEC-WF", "requirement",
             "Any .N clears line approval; same-hash / no-op successor blocked"),
        line("ARCH-HOOK-EVAL", "SEC-WF", "requirement",
             "ActionHook evaluator: RBAC → gates_before → mutate → effects_after → audit"),
        line("ARCH-PLANNING-GATES", "SEC-WF", "requirement",
             "Which planning actions need approval = profile-configurable"),
        line("ARCH-APPROVER-SLOTS", "SEC-WF", "requirement",
             "Approver slots profile-configurable (many / one / contract-specific)"),
        line("ARCH-CAP-LINK", "SEC-WF", "requirement",
             "Capabilities linked at creation via Satisfies (no orphan caps)"),
        line("ARCH-CAP-APPROVE", "SEC-WF", "requirement",
             "CapabilityLine approval enough for solution; Satisfies not separate approve subject"),
        line("ARCH-GATE-MODEL", "SEC-WF", "requirement",
             "Cyber / verification / ship modeled as Gates under WorkflowProfile"),
        line("ARCH-VERIFICATION-GATE", "SEC-WF", "requirement",
             "verification_outcome first-class; configurable gate to ship"),
        line("ARCH-CHANGESET-RETAIN", "SEC-AUDIT", "requirement",
             "Change sets retained forever; post-close revert when conflicts manageable"),
        line("ARCH-CHANGESET-CONFLICT", "SEC-AUDIT", "requirement",
             "Conflict-aware revert engine (design open — intent locked)"),
        line("ARCH-WF-ADMIN", "SEC-UI", "requirement",
             "Workflow profile admin UI (Client/Project admin configures gates, slots, hooks)"),
        line("ARCH-BACKLOG", "SEC-GROOM", "requirement",
             "Backlog planning views (priority queues, release backlog) as product requirements"),
        line("ARCH-GANTT", "SEC-REL", "requirement",
             "Gantt / schedule views as product requirements (with backlog)"),
        line("UI-APPROVE-LINE", "SEC-UI", "requirement",
             "Approve action: selected line + direct children"),
        line("UI-APPROVE-TREE", "SEC-UI", "requirement",
             "Approve Tree action: selected line + full descendants"),
        line("D13", "SEC-RL", "requirement",
             "Stakeholder Approve Tree (full descendants) on requirement lines"),
        line("FIX-DENY-NOOP-SUCCESSOR", "SEC-FIX", "requirement",
             "Same-hash / no-op successor mint denied"),
        line("FIX-SAMPLE-WF-REQ", "SEC-FIX", "requirement",
             "Sample client sys-req line with ApprovalRecord + Satisfies target"),
        line("FIX-SAMPLE-WF-CAP", "SEC-FIX", "capability",
             "Sample capability created with Satisfies + ApprovalRecord"),
    ]
    # Insert before SEC-FIX if present, else append
    insert_at = next((i for i, ln in enumerate(lines) if ln.get("base_uid") == "SEC-FIX"), len(lines))
    # Put SEC-WF and children before FIX section; fixtures after SEC-FIX title already exists
    # Actually append all new lines at end of requirement_lines (before versions section in file = end of array)
    for ln in new_lines:
        lines.append(ln)

    # Update existing line titles where needed
    find_line(lines, "D12")["title"] = "Stakeholder Approve (line + direct children)"
    find_line(lines, "ARCH-APPROVAL")["title"] = "ApprovalRecord on line (SoT); version mirror dual-write"
    find_line(lines, "ARCH-APPROVAL-VIEW")["title"] = "Approval queue tree (unapproved primary; approved dimmed/collapsed)"
    find_line(lines, "ARCH-CYBER-GATE")["title"] = "gate-cyber-ship Gate instance (release.cyber_gate example)"
    find_line(lines, "ARCH-VERIFICATION")["title"] = "verification_outcome first-class; configurable ship gate"
    find_line(lines, "G07")["title"] = "Gantt / schedule view from releases + priorities + iterations"

    # --- update existing version statements ---
    versions = data["requirement_versions"]

    find_ver(versions, "D08")["statement"] = (
        "An Author sets or clears integer priority on a version ONLY when the line's ApprovalRecord.status "
        "is approved (ARCH-APPROVAL-LINE / gate-line-approved). The ActionHook for requirement:version:priority "
        "evaluates WorkflowProfile gates (ARCH-HOOK-EVAL). Priority feeds grooming queues and release backlog "
        "ordering; clearing removes the version from priority-sorted queues without deleting content. Setting "
        "priority on an unapproved line denies (FIX-DENY-PRIORITY-UNAPPROVED). Activate (D04) alone does not "
        "unlock priority. Version.stakeholder_approval may mirror the line record (dual-write) but ApprovalRecord "
        "on the line is source of truth."
    )

    find_ver(versions, "D12")["statement"] = (
        "An actor matching the WorkflowProfile RoleBinding for the stakeholder (or solution_approver) slot "
        "approves a requirement or capability LINE — not a hard-coded Client admin vs AO. Approve (UI-APPROVE-LINE / "
        "requirement:line:approve) writes ApprovalRecord(s) for the selected line AND its direct children, pinning "
        "approved_version_uid and approved_statement_hash for each. Approval is separate from lifecycle status "
        "(draft/active/obsolete). Activate (D04) ≠ approve. Unapproved lines appear in the approval tree "
        "(ARCH-APPROVAL-VIEW); approved ones are dimmed/collapsed. Priority and other profile-selected planning "
        "actions require line approved (ARCH-PLANNING-GATES). Version.stakeholder_approval is a denormalized mirror "
        "during migrate (dual-write); do not treat it as SoT."
    )
    find_ver(versions, "D12")["rbac_op"] = "requirement:line:approve"
    find_ver(versions, "D12")["security"] = cm(
        catalog_ref="AC-3",
        verification_note="Approver = RoleBinding slot (profile-configurable). AC-3/AU-2/3/12.",
    )

    find_ver(versions, "ARCH-APPROVAL")["statement"] = (
        "Stakeholder / solution approval SoT is ApprovalRecord on the line (subject_kind RequirementLine or "
        "CapabilityLine; status unapproved|approved; by, at, notes; approved_version_uid; approved_statement_hash) — "
        "NOT a lifecycle status and NOT version-only. D04 activate remains draft→active only. D08 and other "
        "profile-gated planning actions read ApprovalRecord on the line (ARCH-APPROVAL-LINE). Approver roles come "
        "from RoleBinding on the WorkflowProfile (ARCH-APPROVER-SLOTS) — never hard-coded Client admin vs AO in the "
        "engine. Dogfood commercial profile binds stakeholder → Client admin; DoD example profile may bind AO / "
        "Project admin. During migrate, requirement_version.stakeholder_approval may dual-write as a mirror; "
        "clearing and gate evaluation always use the line ApprovalRecord + hash."
    )

    find_ver(versions, "ARCH-APPROVAL-VIEW")["statement"] = (
        "The approval UI is a filtered requirement tree keyed by LINE: unapproved lines (and their head versions) "
        "are the primary visible set; approved lines are dimmed and/or collapsed — same interaction pattern as other "
        "filtered trees (C07). Readers with access can browse; only actors matching RoleBinding approver slots "
        "mutate ApprovalRecords. Supports Approve (line + direct children) and Approve Tree (full descendants)."
    )

    find_ver(versions, "ARCH-CYBER-GATE")["statement"] = (
        "cyber_gate is modeled as Gate instance gate-cyber-ship under WorkflowProfile (ARCH-GATE-MODEL), not a "
        "one-off flag-only path. Optional boolean release.cyber_gate remains the per-release switch; when true AND "
        "the profile enables gate-cyber-ship, G05 ship requires Security cyber sign-off plus AO approve "
        "(RoleBinding slots security_signoff + ao_approve) before freeze. When false/absent or gate disabled, "
        "Release manager ships without AO. Ship-gate only — not a full ATO workflow. Other ship gates "
        "(e.g. gate-verification-ship) compose the same way."
    )

    find_ver(versions, "ARCH-VERIFICATION")["statement"] = (
        "verification_outcome on requirement_version is first-class (pass | fail | pending), set by Tester "
        "(D10). It complements verification_note without inventing a full evidence CMS. Ship may be gated by "
        "Gate gate-verification-ship under WorkflowProfile when the profile enables it (ARCH-VERIFICATION-GATE / "
        "ARCH-GATE-MODEL) — not soft-only dismiss. Commercial default leaves gate-verification-ship disabled; "
        "DoD/cyber example profile may enable it. Cyber gate and stakeholder approval do not automatically imply "
        "verification pass."
    )
    find_ver(versions, "ARCH-VERIFICATION")["priority"] = 25
    find_ver(versions, "ARCH-VERIFICATION")["iteration"] = "iter-r1"

    find_ver(versions, "D10")["statement"] = (
        "A Tester adds or updates a verification_note on a version's security metadata (or adjacent test note field). "
        "The Tester also sets first-class verification_outcome (pass|fail|pending) on the version (ARCH-VERIFICATION). "
        "ReqAML records the tester identity and timestamp; Authors cannot silently overwrite tester notes without "
        "audit. Whether verification_outcome blocks G05 ship is determined by WorkflowProfile Gate "
        "gate-verification-ship (ARCH-VERIFICATION-GATE) — configurable, not permanently soft."
    )

    find_ver(versions, "G05")["statement"] = (
        "A Release manager ships a release. ReqAML sets status shipped, records shipped_on, and freezes delivers as an "
        "immutable snapshot. Ship is a high-value auditable event (AU-2/3/12). Further delivers mutations deny "
        "(FIX-DENY-SHIPPED-DELIVERS). ActionHook release:ship evaluates profile Gates: gate-cyber-ship when "
        "release.cyber_gate=true and enabled (ARCH-CYBER-GATE); gate-verification-ship when enabled "
        "(ARCH-VERIFICATION-GATE). Without those gates enabled/triggered, Release manager ships without AO / "
        "verification pass."
    )

    find_ver(versions, "G07")["statement"] = (
        "A Reader opens a Gantt / schedule view derived from releases, priorities, and iterations (ARCH-GANTT). "
        "ReqAML provides a first-class schedule read model for planning — alongside backlog planning views "
        "(ARCH-BACKLOG / G04 / K01). Schedule overlays show release windows, iteration bands, and prioritized "
        "work; they are product requirements, not exploratory-only."
    )
    find_ver(versions, "G07")["priority"] = 30
    find_ver(versions, "G07")["iteration"] = "iter-r1"

    find_ver(versions, "K06")["statement"] = (
        "A Reader compares release delivers membership against the iteration work track to spot gaps "
        "(planned vs committed). Gantt/schedule overlays are product requirements (G07 / ARCH-GANTT) used "
        "together with this gap view; backlog planning remains G04 / K01 / ARCH-BACKLOG."
    )

    find_ver(versions, "M07")["statement"] = (
        "Author (own objects + rights), Security (security objects), or Project/Client admin reverts or re-applies a "
        "change_set within their rights. Developer cannot revert/re-apply (permission-tree). Change sets are retained "
        "forever for audit (ARCH-CHANGESET-RETAIN). Post-close revert is allowed when conflicts are manageable; "
        "conflict detection and resolution rules are a separate design (ARCH-CHANGESET-CONFLICT) — encode intent "
        "here, detailed engine later."
    )
    find_ver(versions, "M07")["priority"] = 30
    find_ver(versions, "M07")["iteration"] = "iter-r1"

    find_ver(versions, "ARCH-CHANGESET")["statement"] = (
        "Mutating audit is nested under project-scoped change_set records. A change_set may be a leaf (single user "
        "save / transaction) or an optional SDLC parent session that nests leaf change sets. Default scope is project; "
        "any hierarchy scope is allowed when opening an SDLC parent. audit_events optionally reference change_set_id. "
        "Open / close / revert / apply operate at the leaf; SDLC parents open/close as sessions (M05–M07). Closed "
        "change sets are retained forever (ARCH-CHANGESET-RETAIN); post-close revert when conflicts manageable "
        "(ARCH-CHANGESET-CONFLICT)."
    )

    find_ver(versions, "FIX-DENY-PRIORITY-UNAPPROVED")["statement"] = (
        "FIXTURE / TEST BED (not a product feature). Alex Author attempts requirement:version:priority on "
        "FIX-SAMPLE-UNAPPROVED whose line ApprovalRecord.status=unapproved (version mirror may also show "
        "unapproved) → expect HTTP 403/409 and an audit_events row (action=requirement:version:priority, "
        "outcome=deny). Gate gate-line-approved. Contrast FIX-SAMPLE-APPROVED / ar-fix-sample-approved."
    )

    # Update FIX-SAMPLE mirrors notes
    sa = find_ver(versions, "FIX-SAMPLE-APPROVED")["stakeholder_approval"]
    sa["notes"] = (
        "MIRROR of ApprovalRecord ar-fix-sample-approved (line grain SoT). Dual-write during migrate."
    )
    find_ver(versions, "FIX-SAMPLE-APPROVED")["statement"] = (
        "SAMPLE / FIXTURE: line FIX-SAMPLE-APPROVED has ApprovalRecord.status=approved (ar-fix-sample-approved) "
        "so D08 priority and grooming are allowed. Version.stakeholder_approval mirrors the line record. "
        "grooming_state=wi_ready; has work_item_link wil-fix-approved-ado."
    )
    find_ver(versions, "FIX-SAMPLE-UNAPPROVED")["statement"] = (
        "SAMPLE / FIXTURE: line FIX-SAMPLE-UNAPPROVED has ApprovalRecord.status=unapproved "
        "(ar-fix-sample-unapproved). Priority must be null; attempts to set priority deny "
        "(FIX-DENY-PRIORITY-UNAPPROVED). grooming_state=want. Version mirror shows unapproved."
    )
    find_ver(versions, "FIX-SAMPLE-UNAPPROVED")["stakeholder_approval"]["notes"] = (
        "MIRROR of ApprovalRecord ar-fix-sample-unapproved. Awaiting RoleBinding stakeholder sign-off."
    )

    # A01 mirror note
    a01 = find_ver(versions, "A01")
    if a01.get("stakeholder_approval"):
        a01["stakeholder_approval"]["notes"] = (
            "MIRROR of ApprovalRecord ar-a01 (line grain SoT). Dual-write; commercial RoleBinding → Client admin."
        )

    # I01 / E04 — Satisfies at create
    find_ver(versions, "I01")["statement"] = (
        "An Author creates a capability-kind line (CapabilityLine SubjectKind) together with at least one Satisfies "
        "edge to a target requirement version in the same mutation (ARCH-CAP-LINK / gate-satisfies-at-create). "
        "Orphan capabilities without Satisfies are denied. UI coaches link quality before approve "
        "(ARCH-CAP-APPROVE)."
    )
    find_ver(versions, "E04")["statement"] = (
        "An Author links a capability version to a requirement version via satisfies. At capability creation, "
        "Satisfies MUST be supplied (no orphan caps — ARCH-CAP-LINK). Additional Satisfies edges may be added "
        "later. ReqAML treats Satisfies as the primary coverage edge; the Satisfies edge itself is NOT a separate "
        "approve subject by default — CapabilityLine ApprovalRecord is enough for accepted solution "
        "(ARCH-CAP-APPROVE). Profiles may later add an EdgeSatisfies approve gate if configured."
    )

    # statement_hash on sample versions (optional field)
    for uid, h in [
        ("FIX-SAMPLE-APPROVED", "sha256:fix-sample-approved-v0"),
        ("FIX-SAMPLE-UNAPPROVED", "sha256:fix-sample-unapproved-v0"),
        ("A01", "sha256:a01-v0"),
    ]:
        find_ver(versions, uid)["statement_hash"] = h

    # --- new versions ---
    new_versions = [
        ver("SEC-WF", "SEC-WF",
            "Dynamic workflow control plane for ReqAML: WorkflowProfile, SubjectKind registry, Gate, ActionHook, "
            "RoleBinding, thin Transition, and ApprovalRecord — composition over a mega-status enum (ARCH-WORKFLOW). "
            "See roles/workflow-system.md.",
            priority=10, iteration="iter-r0", security=deepcopy(SEC_AU)),
        ver("ARCH-WORKFLOW", "ARCH-WORKFLOW",
            "ReqAML workflow is composed of WorkflowProfile (per project, optional client default), SubjectKind "
            "registry, Gate, ActionHook, RoleBinding, thin Transition, and ApprovalRecord. Do NOT encode product "
            "control as one lifecycle megamachine. Lifecycle status (draft|active|obsolete|withdrawn) and "
            "grooming_state remain thin; gates/hooks evaluate at action time. Workflow is app logic + seed fixtures; "
            "StrictDoc stays interchange only.",
            priority=10, iteration="iter-r0", rbac_op="workflow:architecture", security=deepcopy(SEC_AU)),
        ver("ARCH-SUBJECT-KIND", "ARCH-SUBJECT-KIND",
            "SubjectKinds register what can be a workflow subject: RequirementLine, CapabilityLine, "
            "RequirementVersion, EdgeSatisfies, EdgeConformsTo, ChangeSet, Release (extensible). Each declares "
            "stable id path, readable attributes for predicates, and allowed actions. Engine does not special-case "
            "every table in if/else forever.",
            priority=15, iteration="iter-r0", rbac_op="workflow:subject_kind"),
        ver("ARCH-REQ-VS-CAP", "ARCH-REQ-VS-CAP",
            "Client system requirements (RequirementLine: kind requirement|section|control) and contractor "
            "capabilities (CapabilityLine: kind=capability) share line/version storage but are distinct "
            "SubjectKinds with often different RoleBindings and gates. Canonical early path: draft client req → "
            "optional activate → line approve → create CapabilityLine with Satisfies → cap approve as solution → "
            "profile-gated planning (priority/grooming/…) → later ship with profile Gates. Satisfies is the "
            "primary coverage edge (not implements in v1 encode).",
            priority=10, iteration="iter-r0", rbac_op="workflow:req_vs_cap"),
        ver("ARCH-APPROVAL-LINE", "ARCH-APPROVAL-LINE",
            "Approval grain is the requirement/capability LINE. ApprovalRecord stores status, by, at, notes, "
            "approved_version_uid, and approved_statement_hash. Tree UI batches many ApprovalRecords in one "
            "change set (Approve = line+direct children; Approve Tree = full descendants). Supersedes "
            "version-only wording; reconcile D08/D12/ARCH-APPROVAL to line grain + profile hooks. Version "
            "stakeholder_approval may dual-write as mirror.",
            priority=10, iteration="iter-r0", rbac_op="requirement:line:approval"),
        ver("ARCH-SUCCESSION-HASH", "ARCH-SUCCESSION-HASH",
            "Minting a successor .N always clears the line ApprovalRecord to unapproved when content changes. "
            "statement_hash is computed over canonical statement (+ agreed metadata). Same-hash / no-op successor "
            "is BLOCKED (gate-noop-successor-block / FIX-DENY-NOOP-SUCCESSOR) — no-op mint must not launder a clear. "
            "After clear, explicit approve is required again even if a later edit restores a prior hash (default).",
            priority=10, iteration="iter-r0", rbac_op="requirement:version:mint"),
        ver("ARCH-HOOK-EVAL", "ARCH-HOOK-EVAL",
            "On each domain action: authorize RBAC (permission-tree) → load ActionHooks for the project's "
            "WorkflowProfile matching action_id → evaluate gates_before (skip optional gates disabled on profile) "
            "including RoleBinding slot checks → apply mutation → run effects_after (e.g. write_approval_record, "
            "clear_line_approval, audit) → ideally nest under change_set. RBAC = can attempt; gates = contextual allow.",
            priority=15, iteration="iter-r0", rbac_op="workflow:hook_eval"),
        ver("ARCH-PLANNING-GATES", "ARCH-PLANNING-GATES",
            "Which planning mutations require line approval is profile-configurable via "
            "WorkflowProfile.planning_gate_actions and ActionHook gates_before — NOT permanently priority-only. "
            "Commercial default gates requirement:version:priority (D08). Profiles may also gate WI-ready "
            "(J01/K03), iteration assign (D09/K04), and release backlog membership (G03/G04). Engine reads the "
            "profile; dogfood ships both a narrow commercial and a broader DoD example profile.",
            priority=15, iteration="iter-r1", rbac_op="workflow:planning_gates"),
        ver("ARCH-APPROVER-SLOTS", "ARCH-APPROVER-SLOTS",
            "Gate approver_slots are filled by RoleBinding (profile_id, gate_id, slot, roles[], optional "
            "identities[]). Supports many stakeholders, one overall approver, or contract-specific bindings — "
            "project/client configurable. Authors cannot redefine who fills a slot. D12/D13 mutate ApprovalRecord "
            "only if actor matches the bound slot. Commercial vs DoD differences are data, not hard-coded branches.",
            priority=15, iteration="iter-r0", rbac_op="workflow:role_binding"),
        ver("ARCH-CAP-LINK", "ARCH-CAP-LINK",
            "CapabilityLine creation MUST include at least one Satisfies edge to a requirement version in the same "
            "mutation (gate-satisfies-at-create). No orphan capabilities. Additional Satisfies may be added later "
            "(E04). UI coaches link quality before capability approve.",
            priority=15, iteration="iter-r1", rbac_op="capability:line:create"),
        ver("ARCH-CAP-APPROVE", "ARCH-CAP-APPROVE",
            "CapabilityLine ApprovalRecord is sufficient to accept a capability as a solution. The Satisfies edge "
            "itself is NOT a separate approve subject by default (EdgeSatisfies remains a registered SubjectKind for "
            "hooks/structural gates). UI coaches link quality before approve. Profiles may later enable an optional "
            "Satisfies-approval gate without schema break.",
            priority=15, iteration="iter-r1", rbac_op="capability:line:approve"),
        ver("ARCH-GATE-MODEL", "ARCH-GATE-MODEL",
            "Cyber ship, verification→ship, line-approved→planning, noop-successor-block, and satisfies-at-create "
            "are Gates under WorkflowProfile — configurable composition, not one-off flags only. release.cyber_gate "
            "remains an example per-release switch that triggers gate-cyber-ship when the profile enables that gate "
            "(ARCH-CYBER-GATE). Same pattern for gate-verification-ship.",
            priority=15, iteration="iter-r0", rbac_op="workflow:gate_model", security=deepcopy(SEC_CM)),
        ver("ARCH-VERIFICATION-GATE", "ARCH-VERIFICATION-GATE",
            "verification_outcome is first-class. WorkflowProfile may enable gate-verification-ship so G05 ship "
            "requires delivers verification_outcome=pass (or profile predicate). When the gate is disabled, ship "
            "does not require pass. This replaces soft-only / permanently-dismissed verification policy with "
            "configurable Gates (ARCH-GATE-MODEL).",
            priority=20, iteration="iter-r1", rbac_op="release:verification_gate"),
        ver("ARCH-CHANGESET-RETAIN", "ARCH-CHANGESET-RETAIN",
            "Closed (and open) change sets are retained forever for audit — no TTL deletion in product policy. "
            "Post-close revert/re-apply is allowed for authorized roles (M07) when conflicts are manageable. "
            "Conflict detection, merge, and deny-when-unmanageable rules are specified under "
            "ARCH-CHANGESET-CONFLICT (design open for engine details; intent locked here).",
            priority=20, iteration="iter-r1", rbac_op="changeset:retain", security=deepcopy(SEC_AU)),
        ver("ARCH-CHANGESET-CONFLICT", "ARCH-CHANGESET-CONFLICT",
            "INTENT LOCKED / ENGINE DESIGN OPEN: post-close revert must be conflict-aware. When reverting a closed "
            "change set would conflict with later mutations (overlapping fields, superseded versions, shipped "
            "delivers, closed contract links, etc.), ReqAML shall detect conflicts and either apply a defined "
            "resolution policy or deny with a clear FIX-DENY-* outcome. Detailed conflict rules, precedence, and "
            "UI are a separate design — do not invent engine specifics in other reqs; keep this ARCH as the open "
            "design anchor.",
            priority=40, iteration="iter-r2", rbac_op="changeset:conflict_engine", security=deepcopy(SEC_AU)),
        ver("ARCH-WF-ADMIN", "ARCH-WF-ADMIN",
            "Client admin configures default WorkflowProfile and default RoleBindings for the client. Project admin "
            "selects/overrides the project's WorkflowProfile, enables/disables optional gates, edits per-project "
            "RoleBindings (slots), and reviews ActionHooks. Authors cannot redefine approver slots. Admin UI "
            "exposes gates, slots, hooks, and planning_gate_actions without requiring code changes for ordinary "
            "commercial vs DoD differences.",
            priority=25, iteration="iter-r1", rbac_op="workflow:profile:admin"),
        ver("ARCH-BACKLOG", "ARCH-BACKLOG",
            "Backlog planning is a first-class product capability: priority queues (K01), release backlog ordering "
            "(G04), and related grooming/work-track views. Together with ARCH-GANTT / G07 these define planning "
            "end-to-end — do not treat backlog or schedule as defer-only.",
            priority=20, iteration="iter-r1", rbac_op="planning:backlog"),
        ver("ARCH-GANTT", "ARCH-GANTT",
            "Gantt / schedule views are first-class product requirements (G07): schedule read model over releases, "
            "priorities, and iterations with overlays for release windows and iteration bands. Defined alongside "
            "backlog planning (ARCH-BACKLOG) — both are wanted; neither is marked defer or v1-only cut.",
            priority=25, iteration="iter-r1", rbac_op="release:gantt"),
        ver("UI-APPROVE-LINE", "UI-APPROVE-LINE",
            "Approval UI action Approve selects a line and applies ApprovalRecord writes to that line PLUS its "
            "direct children only (not deeper descendants). Batched in one change set. Actor must match "
            "RoleBinding for the gate slot. Pairs D12 / requirement:line:approve.",
            priority=20, iteration="iter-r1", rbac_op="requirement:line:approve"),
        ver("UI-APPROVE-TREE", "UI-APPROVE-TREE",
            "Approval UI action Approve Tree selects a line and applies ApprovalRecord writes to that line AND "
            "all descendants (full subtree). Batched in one change set. Actor must match RoleBinding. Pairs D13 / "
            "requirement:line:approve_tree.",
            priority=20, iteration="iter-r1", rbac_op="requirement:line:approve_tree"),
        ver("D13", "D13",
            "An actor matching the stakeholder (or bound) RoleBinding performs Approve Tree on a requirement or "
            "capability line: writes ApprovalRecord for the line and every descendant, pinning each "
            "approved_version_uid + approved_statement_hash. Same activate≠approve and mirror dual-write rules as "
            "D12. Use when signing off a whole section/subtree; use D12/UI-APPROVE-LINE for line+direct children only.",
            priority=15, iteration="iter-r1", rbac_op="requirement:line:approve_tree"),
        ver("FIX-DENY-NOOP-SUCCESSOR", "FIX-DENY-NOOP-SUCCESSOR",
            "FIXTURE / TEST BED. Author attempts requirement:version:mint (or succeed) with statement_hash equal to "
            "the current head hash → expect HTTP 403/409 and audit outcome=deny (gate-noop-successor-block / "
            "ARCH-SUCCESSION-HASH). Contrast a substantive .N which clears line ApprovalRecord.",
            priority=20, iteration="iter-r1", rbac_op="requirement:version:mint"),
        ver("FIX-SAMPLE-WF-REQ", "FIX-SAMPLE-WF-REQ",
            "SAMPLE / FIXTURE: client system requirement line for workflow path demo. ApprovalRecord "
            "ar-wf-sample-req approved; head version active; Satisfies target for FIX-SAMPLE-WF-CAP.",
            priority=20, iteration="iter-r1",
            statement_hash="sha256:fix-wf-req-v0",
            stakeholder_approval=cm(
                status="approved", by="pat-client-admin", at="2026-10-07T10:30:00-04:00",
                notes="MIRROR of ar-wf-sample-req.",
            ),
            grooming_state="detailed"),
        ver("FIX-SAMPLE-WF-CAP", "FIX-SAMPLE-WF-CAP",
            "SAMPLE / FIXTURE: CapabilityLine created with Satisfies→FIX-SAMPLE-WF-REQ in the same mutation "
            "(no orphan). ApprovalRecord ar-wf-sample-cap approved as solution (ARCH-CAP-APPROVE).",
            priority=20, iteration="iter-r1",
            statement_hash="sha256:fix-wf-cap-v0",
            stakeholder_approval=cm(
                status="approved", by="pat-client-admin", at="2026-10-07T10:35:00-04:00",
                notes="MIRROR of ar-wf-sample-cap (CapabilityLine).",
            ),
            grooming_state="detailed"),
    ]
    for v in new_versions:
        versions.append(v)

    # --- edges: Satisfies sample + conforms_to for new ARCH ---
    edges = data["edges"]
    edges.append(cm(**{"from": "FIX-SAMPLE-WF-CAP", "to": "FIX-SAMPLE-WF-REQ", "kind": "satisfies"}))

    new_arch_uids = [
        "ARCH-WORKFLOW", "ARCH-SUBJECT-KIND", "ARCH-REQ-VS-CAP", "ARCH-APPROVAL-LINE",
        "ARCH-SUCCESSION-HASH", "ARCH-HOOK-EVAL", "ARCH-PLANNING-GATES", "ARCH-APPROVER-SLOTS",
        "ARCH-CAP-LINK", "ARCH-CAP-APPROVE", "ARCH-GATE-MODEL", "ARCH-VERIFICATION-GATE",
        "ARCH-CHANGESET-RETAIN", "ARCH-CHANGESET-CONFLICT", "ARCH-WF-ADMIN", "ARCH-BACKLOG",
        "ARCH-GANTT", "UI-APPROVE-LINE", "UI-APPROVE-TREE", "D13", "FIX-DENY-NOOP-SUCCESSOR",
        "FIX-SAMPLE-WF-REQ", "FIX-SAMPLE-WF-CAP", "SEC-WF",
    ]
    for uid in new_arch_uids:
        add_conforms(edges, uid)

    # --- audit sample for noop deny + line approve ---
    data["audit_events"].append(cm(
        id="ae-deny-noop-successor",
        at="2026-10-07T11:10:00-04:00",
        identity_id="alex-author",
        client_id="raby-family",
        project_id="reqaml",
        action="requirement:version:mint",
        outcome="deny",
        http_status=409,
        notes="FIX-DENY-NOOP-SUCCESSOR: same statement_hash as head blocked.",
    ))
    data["audit_events"].append(cm(
        id="ae-allow-line-approve-wf-req",
        at="2026-10-07T10:30:00-04:00",
        identity_id="pat-client-admin",
        client_id="raby-family",
        project_id="reqaml",
        action="requirement:line:approve",
        outcome="allow",
        http_status=200,
        notes="D12 RoleBinding stakeholder approved FIX-SAMPLE-WF-REQ line (ar-wf-sample-req).",
    ))
    data["audit_events"].append(cm(
        id="ae-allow-cap-approve-wf-cap",
        at="2026-10-07T10:35:00-04:00",
        identity_id="pat-client-admin",
        client_id="raby-family",
        project_id="reqaml",
        action="capability:line:approve",
        outcome="allow",
        http_status=200,
        notes="CapabilityLine FIX-SAMPLE-WF-CAP approved as solution after Satisfies-at-create.",
    ))

    # Reorder top-level keys: put workflow collections in a sensible place
    # (ruamel preserves order of existing keys; new keys were appended — move them)
    preferred_tail = [
        "subject_kinds", "workflow_profiles", "gates", "action_hooks", "role_bindings",
        "approval_records",
    ]
    # Rebuild key order: insert workflow keys after catalog_imprints / before iterations if possible
    keys = list(data.keys())
    for k in preferred_tail:
        if k in keys:
            keys.remove(k)
    # place after projects
    insert_after = "iterations" if "iterations" in keys else "projects"
    idx = keys.index(insert_after) + 1
    for i, k in enumerate(preferred_tail):
        keys.insert(idx + i, k)
    new_data = CommentedMap()
    for k in keys:
        new_data[k] = data[k]
    # copy any remaining
    for k in data.keys():
        if k not in new_data:
            new_data[k] = data[k]

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(new_data, f)

    print("Patched", DOGFOOD)
    print("New line UIDs:", [ln["base_uid"] for ln in new_lines])
    print("approval_records:", len(new_data["approval_records"]))
    print("workflow_profiles:", [p["id"] for p in new_data["workflow_profiles"]])


if __name__ == "__main__":
    main()
