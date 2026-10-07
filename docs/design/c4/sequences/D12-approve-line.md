# D12 — Stakeholder Approve line (+ direct children)

Line-grain approval SoT (**ARCH-APPROVAL-LINE**). UI-APPROVE-LINE = selected line + direct children (Approve Tree = D13 / `requirement:line:approve_tree`).

**D39f folded in:** `effects_after` includes `clear_planning_blocked` — re-approve after content `.N` resolves `planning_blocked` (FIX-PLANNING-BLOCKED-AFTER-CONTENT-N).

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `requirement:line:approve` |
| Hook | `hook-line-approve` → `gate-approver-slot` → write_approval_record, clear_planning_blocked, mirror, audit |
| Seed | ARCH-APPROVAL-LINE, ARCH-APPROVAL, D12, FIX-ALLOW-APPROVE-LINE |
| Diagram | [D12-approve-line.puml](./D12-approve-line.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST AC-3; STIG TBD | Approval UI behind route guards. |
| 2 | NIST SC-8, AC-3; STIG TBD | Client-scoped approve API. |
| 3 | NIST AC-3, CM-3; STIG TBD | Approve ≠ activate; line ApprovalRecord SoT. |
| 4 | NIST AC-3, AC-6; STIG TBD | RBAC verb + GateCheck RoleBinding slot. |
| 5 | NIST CM-3; STIG TBD | HookEval loads hook-line-approve. |
| 6 | NIST AC-3, AC-6; STIG TBD | gate-approver-slot deny without binding. |
| 7 | NIST AC-3, AU-2; STIG TBD | Pin version UID + statement_hash on line records. |
| 8 | NIST CM-3, AC-3; STIG TBD | clear_planning_blocked (D39f) after content clear. |
| 9 | NIST AU-2, AU-3, AU-12; STIG TBD | Auditable approval decision. |
