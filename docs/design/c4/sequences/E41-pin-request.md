# E41 — Request ConformsTo pin

Author **request-only** path (`catalog:pin:request`). Live pin apply/deny is **E41a**.

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `catalog:pin:request` |
| Hook | `hook-pin-request` → write_conformance_pin_request, audit |
| Seed | FIX-ALLOW-PIN-REQUEST, FIX-DENY-AUTHOR-PIN-APPLY |
| Diagram | [E41-pin-request.puml](./E41-pin-request.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST SC-8, AC-3; STIG TBD | Client-scoped request API. |
| 2 | NIST AC-3, CM-3; STIG TBD | Pin identity is (imprint_id, item_uid). |
| 3 | NIST AC-3, AC-6; STIG TBD | Author request; no apply without slot. |
| 4 | NIST CM-3; STIG TBD | HookEval hook-pin-request. |
| 5 | NIST AC-3, AU-2; STIG TBD | Persist pending conformance_pin_request. |
| 6 | NIST AU-2, AU-3, AU-12; STIG TBD | Auditable request. |
