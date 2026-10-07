# ReqALM dynamic workflow system (design)

**Status:** encoding (2026-10-07) — workflow + Cyber+QA locked decisions folded into seed  
**Audience:** Dan + implementers  
**Related:** `seed/schema.md`, `user-actions.md`, `roles/permission-tree.html`, `roles/open-questions.md`, `c4/data-erd.puml`  
**Diagram:** `roles/workflow-system.puml` → `roles/workflow_system.png`  
**Seed:** `seed/dogfood.yaml` — `workflow_profiles`, `gates`, `action_hooks`, `role_bindings`, `approval_records`, `subject_kinds`

Locked decisions (encoded — do **not** contradict):

- Stakeholder approval **before** prioritize (D08 gated); which planning actions need approval = **profile-configurable** (ARCH-PLANNING-GATES).
- Approver role is **project/client configurable** via RoleBinding (not hard-coded Client admin vs AO).
- Approval grain = **requirement line**; pin `approved_version_uid` + `approved_statement_hash`.
- UI: **Approve** = line + direct children; **Approve Tree** = full descendants.
- Mint-kind aware clear: `content`/`pin` clear; `status`/`security_meta` do not. **Content** same-hash blocked (`gate-noop-successor-block`). `statement_hash` = body only.
- Caps linked at **creation** via Satisfies (no orphan caps).
- CapabilityLine approval enough for solution; UI coaches link quality; Satisfies edge **not** a separate approve subject by default (configurable later).
- Approver slots profile-configurable (many / one overall / contract-specific).
- Change sets: **retain forever**; **latest-only** whole-set revert on stack; older whole sets only via **abandon-suffix**; field-level history undo = future want (`WANT-CHANGESET-FIELD-UNDO`).
- Cyber / verification / ship = **Gates under WorkflowProfile**; `cyber_gate` remains example gate instance trigger.
- Client sys-req vs CapabilityLine = first-class SubjectKinds; canonical path encoded.
- Components: WorkflowProfile, SubjectKind registry, Gate, ActionHook, RoleBinding, thin Transition, ApprovalRecord.
- Gantt **and** backlog = full product reqs (not defer / not v1-only cut).
- `verification_outcome` first-class with configurable gate to ship.

---

## 1. Problem

A single lifecycle enum (`draft | active | obsolete | withdrawn`) cannot express ReqALM’s real control plane.

| Pressure | Why fixed status fails |
|----------|-------------------------|
| **Req vs capability** | Client sys-reqs and contractor caps share `requirement_line` / `requirement_version` storage but play different roles. Caps are often *solutions* linked via `satisfies`, with their own propose → approve path. One status field cannot say “req approved for planning” vs “cap accepted as coverage.” |
| **Gates ≠ status** | D08 priority, G05 ship (when `cyber_gate` / verification gate), locked migrate, and profile-selected planning actions are **preconditions on actions**, not new lifecycle values. |
| **DoD vs commercial** | Same product, different *who* may approve and which gates are on. Hard-coding Client admin vs AO fights project config. |
| **DoD vs SDLC vs commercial DoD** | Lifecycle (`active`) is engineering publishability; stakeholder approval is commercial/mission sign-off; cyber ship is risk accept. Collapsing them loses audit meaning. |
| **Succession** | `.N` is content change under a stable line. Approval hangs on the **line’s current accepted content** — and no-op mint must not launder a clear. |

**Composition over a mega-state-machine:** keep thin lifecycle + grooming enums; attach **gates, hooks, and role bindings** that evaluate at action time. Workflow is **ReqALM app logic** with seed fixtures — do not blow up StrictDoc interchange.

---

## 2. Objects

### WorkflowProfile

Named configuration bundle. Attached to a **Project** (optional Client default inherited by new projects).

| Field | Notes |
|-------|--------|
| `id` | e.g. `wf-commercial-default`, `wf-dod-cyber` |
| `scope` | `client` \| `project` |
| `client_id` / `project_id` | as scope requires |
| `title` | display |
| `gate_ids[]` | which gates are active in this profile |
| `enabled_optional_gates` / `disabled_optional_gates` | optional gate switches |
| `planning_gate_actions[]` | which planning action_ids require `gate-line-approved` |
| `action_hook_ids[]` | hooks in profile |
| `notes` | |

Dogfood: `wf-commercial-default` on project `reqalm`; `wf-dod-cyber` as broader example.

### SubjectKind

Registry — types **register**; engine does not special-case every table forever.

| `id` | Backing | Notes |
|------|---------|--------|
| `RequirementLine` | `requirement_line` kind ∈ {requirement, section, control} | Client sys-req; **approval grain** |
| `CapabilityLine` | `requirement_line` kind = capability | Contractor capability; first-class |
| `RequirementVersion` | `requirement_version` | Lifecycle, hash, grooming, priority |
| `EdgeSatisfies` | `edge` kind=satisfies | Cap → req; create-with-cap; not default approve subject |
| `EdgeConformsTo` | `edge` kind=conforms_to | Imprint pin |
| `ChangeSet` | `change_set` | open/close/revert |
| `Release` | `release` | ship / cyber / verification gates |

### Gate

Named precondition evaluated before an action proceeds.

Examples encoded: `gate-line-approved`, `gate-cap-approved`, `gate-noop-successor-block`, `gate-cyber-ship`, `gate-verification-ship`, `gate-satisfies-at-create`.

### Transition (thin)

Optional declarative attribute moves (grooming/lifecycle). Approval is **not** a lifecycle transition — it remains ApprovalRecord.

### RoleBinding

Fills Gate `approver_slots` from project/client config — **approver stays configurable.**

### ActionHook

Binds domain action → `gates_before` + `effects_after`. Flow: **RBAC → gates → mutate → effects → audit** (under `change_set`).

### ApprovalRecord (line grain)

| Field | Notes |
|-------|--------|
| `subject_kind` | `RequirementLine` \| `CapabilityLine` |
| `base_uid` | line id |
| `status` | `unapproved` \| `approved` |
| `by` / `at` / `notes` | |
| `approved_version_uid` | content pin |
| `approved_statement_hash` | drift / no-op detection |

Version `stakeholder_approval` may **dual-write** as mirror; SoT is line ApprovalRecord.

### StatementHash + mint kinds

`statement_hash` = canonical **statement body only** (trim + newline canon). Mint kinds: `content` | `status` | `pin` | `security_meta`.

| Kind | No-op gate | Clears approval | Suspects inbound |
|------|------------|-----------------|------------------|
| content | yes | yes + `planning_blocked` | yes |
| pin | no | yes (+ locked migrate `gate_signoff`) | no |
| status / security_meta | no | no (audit only) | no |

### Suspect + gate_signoff

- `trace_suspect` on edges / in_scope_of / delivers after **content** `.N` (ARCH-SUSPECT / queue).
- `gate_signoff` for cyber ship slots + locked migrate AO/Security (ARCH-GATE-SIGNOFF).
- Approve hooks: `gates_before` includes `gate-approver-slot`.

---

## 3. Subject kinds — req vs cap

Same storage shape, different SubjectKind and often different bindings:

```
RequirementLine (kind=requirement|section|control)
    └── versions (lifecycle, statement, priority, grooming…)
CapabilityLine (kind=capability)
    └── versions + capability_artifact
EdgeSatisfies: CapabilityVersion → RequirementVersion (required at cap create)
```

---

## 4. Canonical early path

```text
1. Draft client req          — create RequirementLine + version (draft)
2. Activate (optional)       — D04; NOT approval
3. Line approve              — D12 Approve (line+children) or D13 Approve Tree
4. Contractor cap propose    — create CapabilityLine WITH Satisfies (no orphans)
5. Cap approve as solution   — CapabilityLine ApprovalRecord (Satisfies not separately approved)
6. Priority / planning       — profile-gated (default: D08 via gate-line-approved)
7. Ship                      — G05; profile Gates (cyber / verification) when enabled
```

---

## 5. Dynamic hooks

```text
onAction(action_id, subject, actor, payload):
  rbac.assert(actor, action_id, subject)
  hooks = profile.action_hooks.filter(action_id)
  for gate_id in hooks.gates_before:
    if not profile.enables(gate): continue
    eval predicate + RoleBinding slots
  apply mutation
  run effects_after
  audit(allow)
```

---

## 6. Config surface

| Actor | What they set |
|-------|----------------|
| **Client admin** | Default WorkflowProfile; default RoleBindings |
| **Project admin** | Project profile override; optional gates; per-project RoleBindings |
| **Not Authors** | Cannot redefine approver slots |

Admin UI: ARCH-WF-ADMIN / user-actions 102e–102f.

---

## 7. Locked answers (formerly open)

| Topic | Locked answer |
|-------|----------------|
| Cap vs Satisfies order | Satisfies **at create** (no orphans); may add more Satisfies later |
| Tree approve | **Approve** = line + direct children; **Approve Tree** = full descendants |
| Solution approver slot | Distinct slot `solution_approver`; may bind same roles as stakeholder |
| Satisfies own approval? | **No** by default; CapabilityLine ApprovalRecord enough; optional later |
| Planning gate breadth | **Profile-configurable** (`planning_gate_actions`) |
| Verification → ship | Configurable `gate-verification-ship` (not soft-only dismiss) |
| Change-set retention + revert | **Forever**; latest-only tip revert; abandon-suffix for older whole sets; field undo = want |
| Gantt vs backlog | **Both** full product reqs (ARCH-GANTT + ARCH-BACKLOG) |

**Still open (true unknown):** field-level history undo engine/UX details → `WANT-CHANGESET-FIELD-UNDO` (want only).

---

## 8. Encode status

Encoded in dogfood (2026-10-07). Key UIDs:

| UID | Intent |
|-----|--------|
| `ARCH-WORKFLOW` | Composition model |
| `ARCH-APPROVAL-LINE` | Grain = line |
| `ARCH-REQ-VS-CAP` / `ARCH-SUBJECT-KIND` | Subject kinds + canonical path |
| `ARCH-SUCCESSION-HASH` | Clear on `.N`; same-hash deny |
| `ARCH-HOOK-EVAL` | Evaluator |
| `ARCH-PLANNING-GATES` / `ARCH-APPROVER-SLOTS` | Profile config |
| `ARCH-CAP-LINK` / `ARCH-CAP-APPROVE` | Satisfies-at-create; cap approve |
| `ARCH-GATE-MODEL` / `ARCH-VERIFICATION-GATE` | Gates incl. verification→ship |
| `ARCH-CHANGESET-RETAIN` / `ARCH-CHANGESET-CONFLICT` / `M07` | Retain forever; latest-only revert; abandon-suffix |
| `FIX-DENY-REVERT-NON-LATEST` / `gate-revert-latest-only` | Non-latest whole-set revert deny |
| `WANT-CHANGESET-FIELD-UNDO` | Future field-level history undo (want) |
| `ARCH-WF-ADMIN` / `UI-APPROVE-*` / `D13` | Admin + approve UX |
| `ARCH-BACKLOG` / `ARCH-GANTT` | Planning both |
| Updated `D08`/`D12`/`ARCH-APPROVAL`/`ARCH-CYBER-GATE`/`G07`/`M07` | Line grain + profile hooks |
| `FIX-DENY-NOOP-SUCCESSOR` → `FIX-DENY-NOOP-CONTENT` + `FIX-SAMPLE-WF-*` | Fixtures |
| `ARCH-MINT-KIND` / `ARCH-SUSPECT` / `ARCH-SUSPECT-QUEUE` / `ARCH-GATE-SIGNOFF` | Cyber+QA locked |
| `FIX-DENY-SECOND-ACTIVE` / `FIX-ALLOW-STATUS-SUPERSEDE` / `FIX-ALLOW-SUCCEED` rewrite | ≤1 active + supersede |
| `FIX-PLANNING-BLOCKED-*` / `FIX-GRANDFATHER-SEED-APPROVED` | Approval-clear downstream |
| `FIX-*-SUSPECT-*` / `FIX-DENY-SHIP-WITH-OPEN-SUSPECT` | Suspect queue |
| `FIX-DENY-AUTHOR-PIN-APPLY` / `FIX-ALLOW-PIN-REQUEST` / `FIX-ALLOW-SECURITY-PIN-APPLY` | ConformsTo authority |
| `FIX-DENY-APPROVE-WITHOUT-SLOT` / `FIX-ALLOW-APPROVE-LINE` / `FIX-DENY-SHIP-UNSIGNED` | Approve + signoff |

StrictDoc unchanged (interchange only).

---

## Invariants (checklist)

1. Activate ≠ approve.
2. Approval grain = line; versions carry content + hash pin.
3. Composition: profile / gate / hook / binding — not one status megamachine.
4. Req vs cap are distinct SubjectKinds early.
5. Approver = RoleBinding, project/client configurable.
6. Workflow is app logic + seed; StrictDoc stays interchange.
7. Permission-tree RBAC remains authoritative for verbs; gates add contextual denies.
8. No orphan caps; Satisfies at create.
9. Approve vs Approve Tree semantics as locked.
10. Change sets retained forever; latest-only whole-set revert; abandon-suffix for older; field undo = want.
