# A06 — Invite / link identity to client or project (admin)

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `identity:link` (proposed — client or project admin) |
| Diagram | [A06-invite-link-identity.puml](./A06-invite-link-identity.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST AC-3; STIG TBD | Admin UI in authenticated guarded shell. |
| 2 | NIST AC-3; STIG TBD | Route guard `identity:link`. |
| 3 | NIST AC-6; STIG TBD | Client-scoped admin API call. |
| 4 | NIST AC-2, AC-3; STIG TBD | Business performs account association. |
| 5 | NIST AC-2, AC-6; STIG TBD | RBAC limits link to admins. |
| 6 | NIST AC-2; STIG TBD | Persist linkage in Postgres. |
| 7 | NIST IA-2, AC-2; STIG TBD | Optional IdP provisioning. |
| 8 | NIST AU-2, AU-3, AU-12; STIG TBD | Audit identity link events. |
