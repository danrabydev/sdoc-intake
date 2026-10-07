# AS01 — MCP client authorization via internal OAuth 2.1 AS

Covers how an MCP host gets authorized against ReqAML's internal OAuth 2.1 authorization server: discovery, client identification, PKCE, an audience-bound token, an audience-checked MCP tool call that then runs the ActionHook pipeline, and refresh rotation and revocation. The same AS issues tokens for the UI, API, and MCP (ARCH-AUTH-AS). This aligns with the MCP authorization spec (OAuth 2.1, RFC 8414, RFC 9728, RFC 8707, RFC 9207).

| Field | Value |
|-------|--------|
| Status | draft |
| Requirements | ARCH-AUTH-AS, ARCH-AUTH-PKCE, ARCH-AUTH-METADATA, ARCH-AUTH-AUDIENCE, ARCH-AUTH-REFRESH, ARCH-AUTH-REVOKE, ARCH-AUTH-CLIENTREG, MC01.1, MC02 |
| Fixtures | FIX-ALLOW-MCP-OAUTH-PKCE, FIX-DENY-PKCE-PLAIN, FIX-DENY-MCP-WRONG-AUDIENCE, FIX-DENY-REFRESH-REUSE, FIX-DENY-REVOKED-TOKEN, FIX-DENY-DCR-DISABLED |
| RBAC ops | `auth:oauth:authorize`, `auth:oauth:token`, `auth:oauth:revoke`, `requirement:version:update_draft` |
| Macros | ProtectedResourceDiscovery, PkceAuthorize, TokenIssue, TokenValidate, RefreshRotate, AuthAuditLog, RbacCheck, HookEval, GateCheck, HookEffectsAfter, AuditLog |
| Diagram | [AS01-mcp-oauth-authorize.puml](./AS01-mcp-oauth-authorize.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST IA-2, SC-23; STIG V-222522 | A 401 response carries resource_metadata (RFC 9728), which leads to AS metadata (RFC 8414). The client checks that the issuer matches the one the PRM advertised. |
| 2 | NIST CM-7, AU-2 | Pre-registered clients are the baseline. CIMD is policy-gated. DCR is off by default: the AS advertises no `registration_endpoint` and `/register` returns 403. |
| 3 | NIST IA-2(8); STIG V-222530, V-222531 | Only S256 is accepted. `plain` or a missing challenge returns 400 `invalid_request`. |
| 4 | NIST IA-2 | The user signs in through AS02 (local) or AS03 (federated). The AS is the only issuer. |
| 5 | NIST SC-23, IA-5(6), SC-12(3); STIG V-222542 | The access token's `aud` is the MCP resource (RFC 8707). The refresh token is stored as a hash. Signing happens in OpenBao Transit (KS02). |
| 6 | NIST AC-3, SC-23 | The MCP server validates `iss`, `aud`, `exp`, and `kid`. A token with the wrong audience gets 401 and `WWW-Authenticate`. |
| 7 | NIST AC-3, IA-2 | No token passthrough: the MCP token is never forwarded to the API. The downstream mechanism is an open question (token exchange vs internal service call). |
| 8 | NIST AC-3, AU-2, AU-12 | The mutation runs RbacCheck → HookEval → GateCheck → mutate → HookEffectsAfter → AuditLog. |
| 9 | NIST SC-23, IA-5 | Refresh tokens rotate on each use. Reusing an old one revokes the whole family. |
| 10 | NIST AC-12; STIG V-222578 | RFC 7009 revocation. A revoked token is rejected everywhere it is presented. |
