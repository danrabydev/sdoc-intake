# A07 — Grant project role

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `project:grant:create` (proposed) |
| Diagram | [A07-grant-project-role.puml](./A07-grant-project-role.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST AC-3; STIG TBD | Admin UI behind guards. |
| 2 | NIST AC-3; STIG TBD | Route guard `project:grant:create`. |
| 3 | NIST AC-6; STIG TBD | Client-scoped POST to project grants. |
| 4 | NIST SC-8, AC-3; STIG TBD | TLS + scope validation at HTTP. |
| 5 | NIST AC-2, AC-6; STIG TBD | Business assigns role with least privilege. |
| 6 | NIST AC-2, AC-3; STIG TBD | RBAC on grant creation. |
| 7 | NIST AC-2, AC-3; STIG TBD | Persist `project_grant` in Postgres. |
| 8 | NIST AU-2, AU-3, AU-12; STIG TBD | Audit new grant. |
