# KS02 — Token signing via KeyProvider and JWKS rotation overlap

Covers how the internal AS signs tokens with non-exportable OpenBao Transit keys, how resource servers (MCP, API) verify against JWKS, and how a signing-key rotation keeps the old key valid through an overlap window before rejecting it.

| Field | Value |
|-------|--------|
| Status | draft |
| Requirements | ARCH-KEY-JWKS, ARCH-KEY-PROVIDER, ARCH-KEY-LIFECYCLE, ARCH-KEY-FIPS, ARCH-AUTH-AS, ARCH-AUTH-AUDIENCE |
| Fixtures | FIX-JWKS-ROTATION-OVERLAP |
| RBAC ops | `key:signing:rotate` (Key custodian or scheduled system principal) |
| Macros | KeyOp, TokenValidate |
| Diagram | [KS02-token-signing-keyprovider.puml](./KS02-token-signing-keyprovider.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST SC-12(3), SC-13; STIG V-222570 | Tokens are signed inside OpenBao Transit and the private key is never exported. In FIPS profiles, validated modules are used. |
| 2 | NIST SC-23 | Resource servers verify `kid` against the cached JWKS. |
| 3 | NIST SC-12, AU-2 | Rotation is scheduled or on demand, and each rotation is audited. |
| 4 | NIST SC-12 | The overlap window is at least the maximum access-token TTL plus clock skew. JWKS publishes the active key plus any keys still verify-only. |
| 5 | NIST SC-23, SC-12(3) | After the overlap window, tokens carrying the retired `kid` get 401. |
