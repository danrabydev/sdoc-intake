# A02 — Sign out

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `auth:signout` (proposed — lock with Dan) |
| Diagram | [A02-sign-out.puml](./A02-sign-out.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST AC-12; STIG TBD | User explicitly ends application session. |
| 2 | NIST AC-3; STIG TBD | Route guard limits logout to authenticated context. |
| 3 | NIST SC-8; STIG TBD | Logout API over TLS. |
| 4 | NIST AC-12, IA-11; STIG TBD | Server invalidates session; no stale bearer reuse. |
| 5 | NIST AC-3; STIG TBD | RBAC `auth:signout` for active subject. |
| 6 | NIST AU-2, AU-3, AU-12; STIG TBD | Audit successful logout. |
| 7 | NIST AU-6; STIG TBD | OTEL export for review. |
| 8 | NIST IA-5; STIG TBD | Clear browser session storage/cookies. |
| 9 | NIST IA-2; STIG TBD | Optional IdP single logout when configured. |
