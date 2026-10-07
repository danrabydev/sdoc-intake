# AS03 — Federated enterprise SSO through the internal AS

How enterprise SSO (A01 / CAP-SSO / REQAML-SEC-SSO) federates *through* the internal AS. The upstream IdP authenticates the user; the AS validates the assertion, maps `external_sub` to a ReqAML identity, and mints the tokens the UI/API/MCP accept. Upstream tokens never reach the API.

| Field | Value |
|-------|--------|
| Status | draft |
| Requirements | ARCH-AUTH-FEDERATION, ARCH-AUTH-AS, A01, CAP-SSO, ARCH-AUTH-AUDIENCE |
| Fixtures | FIX-ALLOW-FEDERATED-SSO-VIA-AS, FIX-DENY-UPSTREAM-TOKEN-AT-API |
| RBAC ops | `auth:signin` |
| Macros | PkceAuthorize (via authorize), TokenIssue (via AS), TokenValidate, AuthAuditLog, KeyOp (sign) |
| Diagram | [AS03-federated-sso-via-as.puml](./AS03-federated-sso-via-as.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST IA-2, IA-8; STIG V-222400, V-222401, V-222522 | The browser talks to the AS. The IdP is an upstream federated IdP, not a second token issuer for ReqAML resources. |
| 2 | NIST IA-5, SC-23; STIG V-222403, V-222404 | The AS validates the IdP assertion (issuer, audience = AS client, signature, nonce). |
| 3 | NIST AC-2 | `external_sub` maps to a seed identity. Grants are loaded server-side (A06). |
| 4 | NIST SC-12(3), IA-5(6); STIG V-222570 | Access tokens are signed inside OpenBao Transit. Refresh tokens are hashed. |
| 5 | NIST IA-2, AC-3 | The API accepts only internal-AS tokens. An upstream IdP token gets 401. |
