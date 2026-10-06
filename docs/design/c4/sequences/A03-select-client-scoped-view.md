# A03 — Select Client Scoped View

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `client:scope:select` (proposed) |
| Diagram | [A03-select-client-scoped-view.puml](./A03-select-client-scoped-view.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST AC-3; STIG TBD | Scope UI only after auth via Layout behind guards. |
| 2 | NIST AC-3; STIG TBD | Route guard `client:scope:select`. |
| 3 | NIST AC-6; STIG TBD | Single active client minimizes exposure. |
| 4 | NIST SC-8, AC-3; STIG TBD | Server persists scope; not client-only filter. |
| 5 | NIST AC-3, AC-6; STIG TBD | Business binds actor to clientId. |
| 6 | NIST AC-3, AC-2; STIG TBD | RBAC + membership check before scope set. |
| 7 | NIST AC-3; STIG TBD | Postgres validates grants at SoT. |
| 8 | NIST AU-2, AU-12; STIG TBD | Audit scope selection (visibility change). |
| 9 | NIST AC-3; STIG TBD | UI aligns with server scope for downstream queries. |
