# E46a — Suspect queue review

**ARCH-SUSPECT** / **ARCH-SUSPECT-QUEUE**. Reactions: carry-forward, keep-pinned, drop — all audited.

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `trace:suspect:queue`, `trace:suspect:carry\|keep_pinned\|drop` |
| Seed | ARCH-SUSPECT, ARCH-SUSPECT-QUEUE, FIX-*-SUSPECT-*, FIX-DENY-SHIP-WITH-OPEN-SUSPECT |
| Diagram | [E46a-suspect-queue.puml](./E46a-suspect-queue.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST AC-3; STIG TBD | List open suspects in client scope. |
| 2 | NIST AC-3, AC-6; STIG TBD | Queue + reaction RBAC by kind. |
| 3 | NIST CM-3; STIG TBD | HookEval for react path. |
| 4 | NIST AC-3, CM-3; STIG TBD | Retarget / acknowledge / drop SoT. |
| 5 | NIST AU-2, AU-3, AU-12; STIG TBD | Auditable reaction. |
