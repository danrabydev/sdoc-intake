#!/usr/bin/env python3
"""Encode Dan's change-set revert stack policy into dogfood.yaml (additive + statement updates)."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"

NIST = "nist-800-53@rev5-dogfood-20261006"
SEC = {"catalog_ref": "AC-3", "verification_note": "AC-3 access enforcement; AU-2/3/12 where mutating."}
SEC_AU = {"catalog_ref": "AU-2", "verification_note": "AU-2/3/12 revert / change-set audit."}

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 1000
yaml.indent(mapping=2, sequence=2, offset=0)


def cm(**kwargs):
    m = CommentedMap()
    for k, v in kwargs.items():
        m[k] = v
    return m


def line(base_uid, parent, kind, title, project_id="reqalm"):
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


def has_id(seq, key, val):
    return any(x.get(key) == val for x in seq)


def main():
    data = yaml.load(DOGFOOD.read_text())

    lines = data["requirement_lines"]
    versions = data["requirement_versions"]
    edges = data["edges"]
    gates = data["gates"]
    hooks = data["action_hooks"]
    profiles = data["workflow_profiles"]
    change_sets = data["change_sets"]
    audit = data["audit_events"]

    # --- Update titles on lines ---
    find_line(lines, "ARCH-CHANGESET-RETAIN")["title"] = (
        "Change sets retained forever; revert latest on stack only"
    )
    find_line(lines, "ARCH-CHANGESET-CONFLICT")["title"] = (
        "Stack revert policy: latest-only; abandon suffix for older whole sets"
    )
    find_line(lines, "M07")["title"] = (
        "Revert / re-apply latest change set on stack (or abandon suffix)"
    )

    # --- Add new lines if missing ---
    if not has_line(lines, "FIX-DENY-REVERT-NON-LATEST"):
        # Insert after FIX-DENY-NOOP-SUCCESSOR if present, else append near FIX lines
        idx = next((i for i, ln in enumerate(lines) if ln.get("base_uid") == "FIX-DENY-NOOP-SUCCESSOR"), None)
        new_ln = line(
            "FIX-DENY-REVERT-NON-LATEST",
            "SEC-FIX",
            "requirement",
            "Non-latest change-set revert denied (unless abandon suffix)",
        )
        if idx is not None:
            lines.insert(idx + 1, new_ln)
        else:
            lines.append(new_ln)

    if not has_line(lines, "WANT-CHANGESET-FIELD-UNDO"):
        # After ARCH-CHANGESET-CONFLICT
        idx = next((i for i, ln in enumerate(lines) if ln.get("base_uid") == "ARCH-CHANGESET-CONFLICT"), None)
        new_ln = line(
            "WANT-CHANGESET-FIELD-UNDO",
            "SEC-AUDIT",
            "requirement",
            "Future: undo individual item fields from history (not whole older change sets)",
        )
        if idx is not None:
            lines.insert(idx + 1, new_ln)
        else:
            lines.append(new_ln)

    # --- Update version statements ---
    find_ver(versions, "ARCH-CHANGESET")["statement"] = (
        "Mutating audit is nested under project-scoped change_set records. A change_set may be a leaf "
        "(single user save / transaction) or an optional SDLC parent session that nests leaf change sets. "
        "Default scope is project; any hierarchy scope is allowed when opening an SDLC parent. "
        "audit_events optionally reference change_set_id. Open / close / revert / apply operate at the leaf; "
        "SDLC parents open/close as sessions (M05–M07). Closed change sets are retained forever "
        "(ARCH-CHANGESET-RETAIN). Revert policy is stack-ordered (ARCH-CHANGESET-CONFLICT / M07): only the "
        "latest non-abandoned change set on the stack may be reverted; older whole sets require abandoning "
        "that set and everything after it. Field-level history undo is a future want "
        "(WANT-CHANGESET-FIELD-UNDO)."
    )

    find_ver(versions, "ARCH-CHANGESET-RETAIN")["statement"] = (
        "Closed (and open) change sets are retained forever for audit — no TTL deletion in product policy. "
        "Status may move to reverted or abandoned; records are never deleted. Authorized roles (M07) may "
        "revert only the latest change set on the project stack (ARCH-CHANGESET-CONFLICT). Re-apply restores "
        "a previously reverted tip when still latest. Older whole-set undo is via abandon of that set and "
        "every later set — not selective mid-stack revert. Field-level history undo is deferred "
        "(WANT-CHANGESET-FIELD-UNDO)."
    )
    find_ver(versions, "ARCH-CHANGESET-RETAIN")["rbac_op"] = "changeset:retain"

    conflict = find_ver(versions, "ARCH-CHANGESET-CONFLICT")
    conflict["statement"] = (
        "LOCKED stack revert policy (Dan 2026-10-07): (1) Only the latest change set on the stack may be "
        "reverted (changeset:revert). Non-latest whole-set revert DENIES (gate-revert-latest-only / "
        "FIX-DENY-REVERT-NON-LATEST). (2) Never revert an entire older change set unless that set AND "
        "everything after it are abandoned (abandon-suffix / unwind from tip). Abandoned sets remain "
        "retained forever (ARCH-CHANGESET-RETAIN) with status=abandoned. (3) Later product want: undo "
        "individual item fields from history without reverting whole older change sets "
        "(WANT-CHANGESET-FIELD-UNDO) — not encoded as current behavior. Tip revert may still surface "
        "unmanageable conflicts with external side effects (shipped delivers, closed contracts); those "
        "deny with FIX-DENY-* when defined. Do not invent mid-stack whole-set revert."
    )
    conflict["priority"] = 20
    conflict["iteration"] = "iter-r1"
    conflict["rbac_op"] = "changeset:conflict_engine"

    m07 = find_ver(versions, "M07")
    m07["statement"] = (
        "Author (own objects + rights), Security (security objects), or Project/Client admin reverts or "
        "re-applies a change_set within their rights. Developer cannot revert/re-apply (permission-tree). "
        "Change sets are retained forever (ARCH-CHANGESET-RETAIN). Revert applies ONLY to the latest "
        "non-abandoned change set on the project stack (ARCH-CHANGESET-CONFLICT / gate-revert-latest-only). "
        "Attempting to revert a non-latest set denies (FIX-DENY-REVERT-NON-LATEST) unless the actor abandons "
        "that set and everything after it. Re-apply targets a reverted tip still at the stack head. "
        "Field-level history undo is a future want (WANT-CHANGESET-FIELD-UNDO), not M07 scope."
    )
    m07["security"] = {
        "catalog_ref": "AU-2",
        "verification_note": "AU-2/3/12 revert/re-apply; latest-only; Developer denied; FIX-DENY-REVERT-NON-LATEST.",
    }
    if "verification_note" in m07:
        del m07["verification_note"]

    # --- New versions ---
    if not has_ver(versions, "FIX-DENY-REVERT-NON-LATEST"):
        versions.append(ver(
            "FIX-DENY-REVERT-NON-LATEST",
            "FIX-DENY-REVERT-NON-LATEST",
            "FIXTURE / TEST BED (not a product feature). Authorized actor attempts changeset:revert on a "
            "closed change set that is NOT the latest on the project stack while later sets remain "
            "non-abandoned (sample: revert cs-stack-older while cs-stack-newer is still closed tip) → "
            "expect HTTP 403/409 and audit_events row (action=changeset:revert, outcome=deny, "
            "gate-revert-latest-only). Contrast: revert of cs-stack-newer (latest) allowed; or abandon "
            "cs-stack-older AND cs-stack-newer then unwind. Pairs ARCH-CHANGESET-CONFLICT / M07.",
            priority=20,
            iteration="iter-r1",
            rbac_op="changeset:revert",
            security=deepcopy(SEC_AU),
        ))
        add_conforms(edges, "FIX-DENY-REVERT-NON-LATEST")

    if not has_ver(versions, "WANT-CHANGESET-FIELD-UNDO"):
        versions.append(ver(
            "WANT-CHANGESET-FIELD-UNDO",
            "WANT-CHANGESET-FIELD-UNDO",
            "FUTURE WANT (not current product behavior): allow undoing individual item fields from "
            "per-object history without reverting an entire older change set. Must not enable mid-stack "
            "whole-set revert (ARCH-CHANGESET-CONFLICT remains: only latest whole set, or abandon suffix). "
            "Encode UX/engine details when prioritized; until then M07 stays latest-only / abandon-suffix.",
            priority=40,
            iteration="iter-r2",
            rbac_op="changeset:field_undo",
            security=deepcopy(SEC_AU),
            grooming_state="want",
        ))
        add_conforms(edges, "WANT-CHANGESET-FIELD-UNDO")

    # --- Gate + hook ---
    if not has_id(gates, "id", "gate-revert-latest-only"):
        gates.append(cm(
            id="gate-revert-latest-only",
            subject_kinds=["ChangeSet"],
            mode="required",
            predicate="subject.id == project.change_set_stack.latest_non_abandoned",
            approver_slots=[],
            on_fail="deny",
            deny_fixture="FIX-DENY-REVERT-NON-LATEST",
            notes=(
                "M07 / ARCH-CHANGESET-CONFLICT: whole-set revert only for latest on stack. "
                "Older whole sets require abandon-suffix."
            ),
        ))

    if not has_id(hooks, "id", "hook-changeset-revert"):
        hooks.append(cm(
            id="hook-changeset-revert",
            action_id="changeset:revert",
            subject_kind="ChangeSet",
            gates_before=["gate-revert-latest-only"],
            effects_after=["audit"],
            notes="M07 tip revert; non-latest deny FIX-DENY-REVERT-NON-LATEST.",
        ))

    # Attach gate/hook to commercial default profile
    for p in profiles:
        if p.get("id") == "wf-commercial-default":
            gids = list(p.get("gate_ids") or [])
            if "gate-revert-latest-only" not in gids:
                gids.append("gate-revert-latest-only")
                p["gate_ids"] = gids
            aids = list(p.get("action_hook_ids") or [])
            if "hook-changeset-revert" not in aids:
                aids.append("hook-changeset-revert")
                p["action_hook_ids"] = aids
        if p.get("id") == "wf-dod-cyber":
            gids = list(p.get("gate_ids") or [])
            if "gate-revert-latest-only" not in gids:
                gids.append("gate-revert-latest-only")
                p["gate_ids"] = gids
            aids = list(p.get("action_hook_ids") or [])
            if "hook-changeset-revert" not in aids:
                aids.append("hook-changeset-revert")
                p["action_hook_ids"] = aids

    # --- Stack fixture change sets ---
    if not has_id(change_sets, "id", "cs-stack-older"):
        change_sets.append(cm(
            id="cs-stack-older",
            project_id="reqalm",
            kind="leaf",
            parent_id=None,
            scope="project",
            status="closed",
            opened_by="alex-author",
            opened_at="2026-10-07T10:00:00-04:00",
            closed_at="2026-10-07T10:05:00-04:00",
            summary="Stack fixture older leaf (not tip)",
            notes="FIX-DENY-REVERT-NON-LATEST: older than cs-stack-newer; revert of this while newer exists denies.",
        ))
    if not has_id(change_sets, "id", "cs-stack-newer"):
        change_sets.append(cm(
            id="cs-stack-newer",
            project_id="reqalm",
            kind="leaf",
            parent_id=None,
            scope="project",
            status="closed",
            opened_by="alex-author",
            opened_at="2026-10-07T10:10:00-04:00",
            closed_at="2026-10-07T10:15:00-04:00",
            summary="Stack fixture latest leaf (tip)",
            notes="Latest on stack; M07 revert of this tip is the allowed whole-set path.",
        ))

    # Audit deny sample
    if not has_id(audit, "id", "ae-deny-revert-non-latest"):
        audit.append(cm(
            id="ae-deny-revert-non-latest",
            at="2026-10-07T11:20:00-04:00",
            identity_id="alex-author",
            client_id="raby-family",
            project_id="reqalm",
            action="changeset:revert",
            outcome="deny",
            http_status=409,
            change_set_id="cs-stack-older",
            notes=(
                "FIX-DENY-REVERT-NON-LATEST: revert cs-stack-older while cs-stack-newer is tip denied "
                "(gate-revert-latest-only)."
            ),
        ))

    # SubjectKind notes refresh
    for sk in data.get("subject_kinds") or []:
        if sk.get("id") == "ChangeSet":
            sk["notes"] = (
                "open/close/revert hooks; stack latest-only revert (gate-revert-latest-only); "
                "abandon suffix for older whole sets; retain forever."
            )

    yaml.dump(data, DOGFOOD)
    print("patched", DOGFOOD)
    print("IDs touched/added: ARCH-CHANGESET, ARCH-CHANGESET-RETAIN, ARCH-CHANGESET-CONFLICT, M07,")
    print("  FIX-DENY-REVERT-NON-LATEST, WANT-CHANGESET-FIELD-UNDO,")
    print("  gate-revert-latest-only, hook-changeset-revert,")
    print("  cs-stack-older, cs-stack-newer, ae-deny-revert-non-latest")


if __name__ == "__main__":
    main()
