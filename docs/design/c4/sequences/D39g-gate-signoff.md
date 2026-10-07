# D39g — Gate sign-off (Security / AO slots)

**ARCH-GATE-SIGNOFF.** Writes `gate_signoff` rows used as **pass conditions** for cyber ship and locked migrate. `release.cyber_gate` is the **trigger** (see **G61**); these rows are what `gate-signoff-complete` checks.

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `gate:signoff` |
| Seed | ARCH-GATE-SIGNOFF, ARCH-CYBER-GATE, FIX-DENY-SHIP-UNSIGNED |
| Diagram | [D39g-gate-signoff.puml](./D39g-gate-signoff.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST SC-8, AC-3; STIG TBD | Client-scoped signoff API. |
| 2 | NIST AC-3, CM-3; STIG TBD | Slot decision beyond line ApprovalRecord. |
| 3 | NIST AC-3, AC-6; STIG TBD | Security/AO RoleBinding — not Author free edit. |
| 4 | NIST AC-3, AU-2; STIG TBD | Persist gate_signoff SoT. |
| 5 | NIST AU-2, AU-3, AU-12; STIG TBD | Auditable approve/deny per slot. |
