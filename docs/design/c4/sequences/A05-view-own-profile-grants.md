# A05 — View own profile / grants

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `identity:read_self` (proposed) |
| Diagram | [A05-view-own-profile-grants.puml](./A05-view-own-profile-grants.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST AC-3; STIG TBD | Self-service UI behind guards. |
| 2 | NIST AC-3; STIG TBD | Route guard `identity:read_self`. |
| 3 | NIST SC-8; STIG TBD | Authenticated GET for self. |
| 4 | NIST AC-3, IA-5; STIG TBD | Business returns actor-bound data only. |
| 5 | NIST AC-3; STIG TBD | RBAC check on read_self. |
| 6 | NIST AC-3, AC-6; STIG TBD | SQL limited to actor identity. |
| 7 | NIST AU-2, AU-3; STIG TBD | Audit self-read if policy requires. |
| 8 | NIST IA-5; STIG TBD | Minimize PII display in UI. |
