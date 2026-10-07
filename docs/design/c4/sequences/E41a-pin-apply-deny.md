# E41a — Apply / deny ConformsTo pin

Applicator path (`catalog:pin:apply` / `catalog:pin:deny`) behind **gate-conforms-applicator**.

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `catalog:pin:apply` / `catalog:pin:deny` |
| Hook | `hook-pin-apply` → gate-conforms-applicator → apply_conformance_pin, audit |
| Seed | FIX-ALLOW-SECURITY-PIN-APPLY, FIX-DENY-AUTHOR-PIN-APPLY |
| Diagram | [E41a-pin-apply-deny.puml](./E41a-pin-apply-deny.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST SC-8, AC-3; STIG TBD | Client-scoped apply/deny API. |
| 2 | NIST AC-3, AC-6; STIG TBD | RBAC + applicator RoleBinding. |
| 3 | NIST CM-3; STIG TBD | HookEval hook-pin-apply. |
| 4 | NIST AC-3, AC-6; STIG TBD | gate-conforms-applicator deny without slot. |
| 5 | NIST AC-3, CM-3; STIG TBD | Apply writes ConformsTo pin or deny closes request. |
| 6 | NIST AU-2, AU-3, AU-12; STIG TBD | Auditable applicator decision. |
