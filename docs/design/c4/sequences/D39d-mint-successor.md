# D39d — Mint successor `.N` with mint_kind

**ARCH-MINT-KIND** / **ARCH-SUCCESSION-HASH**. Distinct from draft in-place edit (D03 / MC02).

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `requirement:version:mint` |
| Hook | `hook-mint` → gate-noop-successor-block, gate-one-active → kind-aware effects |
| Seed | ARCH-MINT-KIND, FIX-DENY-NOOP-CONTENT, FIX-ALLOW-PIN-MIGRATE-MINT, FIX-PLANNING-BLOCKED-AFTER-CONTENT-N |
| Diagram | [D39d-mint-successor.puml](./D39d-mint-successor.puml) |

| Kind | No-op gate | Clears ApprovalRecord | Suspects inbound |
|------|------------|----------------------|------------------|
| content | yes (same hash deny) | yes (+ `planning_blocked`) | yes |
| pin | no | yes (+ locked migrate `gate_signoff` then re-approve) | no |
| status / security_meta | no | no (audit only) | no |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST SC-8, CM-3; STIG TBD | Mint API creates successor, not draft PATCH. |
| 2 | NIST AC-3, AC-6; STIG TBD | RBAC for mint verb. |
| 3 | NIST CM-3; STIG TBD | HookEval loads hook-mint. |
| 4 | NIST CM-3; STIG TBD | Content same-hash deny via gate-noop-successor-block. |
| 5 | NIST CM-3; STIG TBD | ≤1 active invariant. |
| 6 | NIST AC-3, CM-3; STIG TBD | Insert successor version SoT. |
| 7 | NIST CM-3, AU-2; STIG TBD | Kind-aware clear / planning_blocked / suspect. |
| 8 | NIST AU-2, AU-3, AU-12; STIG TBD | Audit mint with mint_kind. |
