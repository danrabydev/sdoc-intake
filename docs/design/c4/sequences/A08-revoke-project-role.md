# A08 — Revoke project role

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `project:grant:revoke` (proposed) |
| Diagram | [A08-revoke-project-role.puml](./A08-revoke-project-role.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST AC-3; STIG TBD | Revoke UI behind guards. |
| 2 | NIST AC-3; STIG TBD | Route guard `project:grant:revoke`. |
| 3 | NIST AC-6; STIG TBD | Client-scoped DELETE. |
| 4 | NIST SC-8, AC-3; STIG TBD | Secure revoke API. |
| 5 | NIST AC-2, AC-6; STIG TBD | Business removes grant. |
| 6 | NIST AC-2, AC-3; STIG TBD | RBAC on revoke operation. |
| 7 | NIST AC-2, AC-3; STIG TBD | Delete grant row in Postgres. |
| 8 | NIST AU-2, AU-3, AU-12; STIG TBD | Audit revocation. |
| 9 | NIST AC-12; STIG TBD | Refresh session grants if subject affected. |
