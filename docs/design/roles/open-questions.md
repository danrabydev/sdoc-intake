# Open questions (need Dan’s input)

Do **not** invent product policy for these. Encode only after an explicit answer.

**Workflow lock (2026-10-07):** See `roles/workflow-system.md` (**status: encoding**). The following are **locked and encoded** in `seed/dogfood.yaml` — do not treat as still open:

| Former § | Locked answer |
|----------|----------------|
| §1 Approver role | Project/client **RoleBinding** on WorkflowProfile (not hard-coded Client admin vs AO). Commercial dogfood binds `stakeholder` → Client admin; DoD example may bind AO / Project admin. |
| §2 Approval grain | **Line** (`ApprovalRecord`); pin `approved_version_uid` + `approved_statement_hash`. Version `stakeholder_approval` = dual-write mirror. |
| §3 Revoke on `.N` | **Mint-kind aware** (ARCH-MINT-KIND): `content` clears + `planning_blocked`; `pin` clears (+ locked migrate `gate_signoff` then re-approve); `status`/`security_meta` do **not** clear. `statement_hash` = statement body only. Content same-hash blocked (`FIX-DENY-NOOP-CONTENT`; aligns `FIX-DENY-NOOP-SUCCESSOR`). |
| §4 Verification → ship | `verification_outcome` first-class; ship via configurable Gate `gate-verification-ship` (not soft-only dismiss). Commercial default leaves gate disabled. |
| §5 Change-set retention + revert | **Retain forever**. Stack policy: **only the latest** non-abandoned change set may be reverted (`gate-revert-latest-only` / `FIX-DENY-REVERT-NON-LATEST`). Never revert an entire older set unless that set **and everything after it** are abandoned. Field-level history undo = future want (`WANT-CHANGESET-FIELD-UNDO`) — not current behavior. |
| §6 Planning gate breadth | **Profile-configurable** (`planning_gate_actions`) — not priority-only forever. Commercial default: D08 only; DoD example broader. |
| §7 Gantt vs backlog | **Both** are full product requirements (ARCH-GANTT / G07 + ARCH-BACKLOG / G04 / K01). Do not mark defer or v1-only cut. |

Also locked from **Cyber+QA design room** (encoded 2026-10-07) — see `roles/product-analysis-first-round.md` P0/P1 decisions:

| Topic | Locked answer |
|-------|----------------|
| Hash + status | `statement_hash` = body only; mint kinds `content\|status\|pin\|security_meta`; noop gate = content only; ≤1 active; D04 prior→in-place `superseded`; terminal obsolete/withdraw in-place or status-only `.N`. |
| Approval-clear downstream | Retain priority/grooming/iteration; `planning_blocked` until re-approve; D08 denied while blocked; do **not** auto-drop contract/release — mark **suspect**; bootstrap `imported_approved`. |
| Suspect links (R1) | `trace_suspect` on edges + in_scope_of/delivers on **content** `.N`; queue carry/keep-pinned/drop; role defaults Author / Security / Author+Release mgr. |
| ConformsTo authority | Tree wins: Author **request**; Security (standards) / Steward (non-standard) **apply**; `conformance_pin_request` + `conforms_to_applicator` slot; AO approve-only on locked migrate. |
| Approve wiring | `gates_before` includes `gate-approver-slot`; verbs `requirement:line:approve` / `capability:line:approve`. |
| gate_signoff | Cyber ship + locked migrate slot records (`ARCH-GATE-SIGNOFF` / `FIX-DENY-SHIP-UNSIGNED`). |
| L02 golden | `{A01, A02}` only — catalog UIDs never in `in_scope_of`. |

Also locked from workflow design (encoded):

- **Approve** = line + direct children; **Approve Tree** = full descendants.
- Caps **Satisfies-at-create** (no orphans); CapabilityLine approval enough for solution; Satisfies edge not separate approve subject by default.
- Approver slots profile-configurable (many / one / contract-specific).
- Cyber / verification / ship = Gates under WorkflowProfile (`cyber_gate` = example instance trigger).

Each remaining item: question, options if clear, why it blocks encoding.

---

## 1. Field-level history undo (future want — details TBD)

**Status:** Encoded as **want** only (`WANT-CHANGESET-FIELD-UNDO`, `grooming_state=want`). Stack whole-set policy is locked; this does **not** reopen mid-stack whole-set revert.

**Question (when prioritized):** Which fields/subjects are undoable from history, what UX confirms the undo, and how does it interact with ApprovalRecord pins / shipped delivers / closed contracts?

**Why it blocks (later):** Engine + FIX beds for field undo — not needed for current M07 latest-only / abandon-suffix path.

---

## Encoded assumptions (not open — for contrast)

These were encoded with documented locked policy:

- Approver = **RoleBinding** (commercial seed: Client admin on stakeholder / solution_approver slots).
- Approval SoT = **ApprovalRecord on line**; version mirror dual-write; activate (D04) ≠ approve (D12/D13).
- Priority (D08) requires line approval (or `imported_approved`) and not `planning_blocked`; other planning gates = profile `planning_gate_actions`.
- `verification_outcome` first-class; ship gate configurable under WorkflowProfile.
- Change sets retained forever; **latest-only** whole-set revert; abandon-suffix for older whole sets; field undo = want (`WANT-CHANGESET-FIELD-UNDO`).
- `cyber_gate` on release triggers `gate-cyber-ship` when profile enables it; Security + AO slots via `gate_signoff`.
- Locked for migrate is **derived** (non-draft ∧ (in_scope ∨ delivers)); locked migrate = `mint_kind=pin` + signoff + re-approve.
- No orphan capabilities; Satisfies at create; CapabilityLine approve accepts solution.
- ≤1 active per line; prior active → `superseded` in-place on D04.
- Mint kinds + suspect queue + ConformsTo request/apply as locked above.
