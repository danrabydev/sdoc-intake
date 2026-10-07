# G61 — Ship release (freeze snapshot)

**ARCH-CYBER-GATE** / **ARCH-GATE-MODEL** / **ARCH-GATE-SIGNOFF**.

| Concept | Role |
|---------|------|
| `release.cyber_gate` | **Trigger** — when true and profile enables `gate-cyber-ship`, cyber ship Gate evaluates |
| `gate_signoff` rows (D39g) | **Pass condition** — `gate-signoff-complete` requires security_signoff + ao_approve |

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `release:ship` |
| Hook | `hook-ship` → gate-cyber-ship, gate-verification-ship, gate-signoff-complete, gate-no-open-suspect |
| Seed | ARCH-CYBER-GATE, FIX-DENY-SHIP-UNSIGNED, FIX-DENY-SHIP-WITH-OPEN-SUSPECT, G05 |
| Diagram | [G61-ship-release.puml](./G61-ship-release.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST SC-8, CM-3; STIG TBD | Ship API freezes snapshot. |
| 2 | NIST AC-3, AC-6; STIG TBD | RBAC for release:ship. |
| 3 | NIST CM-3; STIG TBD | HookEval hook-ship. |
| 4 | NIST AC-3, CM-3; STIG TBD | gate-cyber-ship when cyber_gate triggers. |
| 5 | NIST CM-3; STIG TBD | Optional verification→ship gate. |
| 6 | NIST AC-3, AU-2; STIG TBD | gate-signoff-complete checks D39g rows. |
| 7 | NIST CM-3; STIG TBD | Optional no-open-suspect. |
| 8 | NIST CM-3, AC-3; STIG TBD | Freeze delivers SoT. |
| 9 | NIST AU-2, AU-3, AU-12; STIG TBD | Auditable ship. |
