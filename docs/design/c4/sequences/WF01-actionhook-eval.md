# WF01 — ActionHook evaluator (shared pattern)

Canonical **ARCH-HOOK-EVAL** / **ARCH-WORKFLOW** pipeline. Action sequences compose `HookEval` / `GateCheck` / `HookEffectsAfter` from `C4_Sequence_Macros.puml` — do not duplicate this flow.

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `{action_id}` (per ActionHook) |
| Seed | ARCH-HOOK-EVAL, ARCH-WORKFLOW, ARCH-GATE-MODEL |
| Diagram | [WF01-actionhook-eval.puml](./WF01-actionhook-eval.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST AC-3, CM-3; STIG TBD | Business evaluates ActionHooks under WorkflowProfile. |
| 2 | NIST AC-3, AC-6; STIG TBD | RBAC = can attempt; gates = contextual allow. |
| 3 | NIST CM-3, AC-3; STIG TBD | Load ordered `gates_before` + `effects_after` from profile. |
| 4 | NIST AC-3, AC-6; STIG TBD | GateCheck: skip optional if disabled; RoleBinding slots. |
| 5 | NIST AC-3, CM-3; STIG TBD | Mutate SoT under client scope + change_set. |
| 6 | NIST CM-3, AU-2; STIG TBD | effects_after (approval clear, suspect, mirrors, …). |
| 7 | NIST AU-2, AU-3, AU-12; STIG TBD | Audit allow/deny with gate outcomes. |
