# AS03 — Federated enterprise SSO through the internal AS

How enterprise SSO (A01 / CAP-SSO / REQAML-SEC-SSO) federates *through* the internal AS:
1. The AS picks the client tenant's upstream connector, and the upstream IdP authenticates the user.
2. The AS validates the assertion and maps issuer + subject to a ReqAML identity within that tenant, enforcing step-up MFA through the IdP when needed.
3. The AS mints the tokens the UI, API and MCP accept.

Upstream tokens never reach the API. An upstream back-channel logout ends ReqAML sessions and token families. With the production default profile (`local_accounts=disabled`), no local sign-in form exists.

Options for reaching the provider's *own* APIs are in [`../../auth/mcp-upstream-identity.md`](../../auth/mcp-upstream-identity.md) (see AS04).

| Field | Value |
|-------|--------|
| Status | draft |
| Requirements | ARCH-AUTH-FEDERATION, ARCH-AUTH-AS, ARCH-AUTH-PROFILE, ARCH-AUTH-UPSTREAM-CONNECTOR, ARCH-AUTH-CLAIM-MAP, ARCH-AUTH-UPSTREAM-REVOKE, ARCH-CRED-MFA, ARCH-CRED-REAUTH, A01, CAP-SSO, ARCH-AUTH-AUDIENCE |
| Fixtures | FIX-ALLOW-FEDERATED-SSO-VIA-AS, FIX-DENY-UPSTREAM-TOKEN-AT-API, FIX-DENY-CROSS-TENANT-CONNECTOR, FIX-DENY-UPSTREAM-LOGOUT-PROPAGATED, FIX-DENY-LOCAL-LOGIN-PROFILE-OFF |
| RBAC ops | `auth:signin`, `auth:oauth:revoke` |
| Macros | TokenValidate, AuthAuditLog (signing via KeyProvider as in KS02) |
| Diagram | [AS03-federated-sso-via-as.puml](./AS03-federated-sso-via-as.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST IA-2, IA-8; STIG V-222400, V-222401, V-222522 | The browser talks to the AS. The IdP is an upstream federated IdP, not a second token issuer. |
| 2 | NIST CM-6, CM-7 | The auth profile decides which sign-in options exist. The production default is federated only, with no local form. |
| 3 | NIST IA-8, AC-3; STIG V-222559, V-222560 | Each connector is bound to one client tenant. Home-realm discovery is an open question. |
| 4 | NIST IA-5, SC-23; STIG V-222403, V-222404 | The AS validates the IdP assertion: issuer, audience = AS client, signature, nonce. |
| 5 | NIST AC-2, AC-6 | Issuer + subject maps to an identity inside the tenant. Grants come from ReqAML records, never inferred across tenants. |
| 6 | NIST IA-2(1), IA-11; STIG V-222523, V-222520 | Privileged or step-up actions require fresh MFA evidence from the IdP (`max_age`, `acr_values`). |
| 7 | NIST SC-12(3), IA-5(6); STIG V-222570 | The AS mints tokens signed in OpenBao. Refresh lifetime is at most the connector's maximum authentication age. |
| 8 | NIST IA-2, AC-3 | The API accepts only internal-AS tokens. An upstream token gets 401. |
| 9 | NIST AC-12, AC-2(3); STIG V-222549, V-222391 | Upstream back-channel logout or SLO revokes ReqAML sessions and the UI and MCP token families. |
