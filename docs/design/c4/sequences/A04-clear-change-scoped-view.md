# A04 — Clear / change Scoped View

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `client:scope:clear` (proposed; replace path also uses `client:scope:select`) |
| Diagram | [A04-clear-change-scoped-view.puml](./A04-clear-change-scoped-view.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST AC-3; STIG TBD | Scope controls in guarded Layout. |
| 2 | NIST AC-3; STIG TBD | Route guard `client:scope:clear`. |
| 3a | NIST AC-12, AC-3; STIG TBD | Server clears bound client scope. |
| 3b | NIST AC-3, AC-6; STIG TBD | Changing client reuses select validation. |
| 4 | NIST SC-8; STIG TBD | Authenticated API mutation. |
| 5 | NIST AC-3; STIG TBD | Business layer owns scope state. |
| 6 | NIST AC-3, AC-6; STIG TBD | RBAC for clear/replace. |
| 7 | NIST AU-2, AU-12; STIG TBD | Audit scope clear or change. |
| 8 | NIST AC-3; STIG TBD | UI stops client-scoped queries until scope restored. |
