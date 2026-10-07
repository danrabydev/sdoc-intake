# AS04 — PROPOSAL: MCP tool reaching a provider API on the user's behalf

**Not locked.** This diagram exists to compare options (b) token exchange and (c) stored upstream grant from [`../../auth/mcp-upstream-identity.md`](../../auth/mcp-upstream-identity.md). Option (d) passthrough is shown only as rejected. The inbound half is settled: the MCP credential is always the internal-AS token. The outbound half (how ReqAML obtains a provider-audience token) is open question §5.

| Field | Value |
|-------|--------|
| Status | proposal |
| Requirements | ARCH-AUTH-MCP-REQUIRED, ARCH-AUTH-AUDIENCE, ARCH-AUTH-AGENT-ATTRIBUTION, ARCH-KEY-SCOPE, J04/J05 (sync) |
| RBAC ops | `workitem:sync` (illustrative; final op name TBD with J-series) |
| Macros | TokenValidate, RbacCheck, HookEval, KeyOp, HookEffectsAfter, AuditLog |
| Diagram | [AS04-mcp-upstream-api-access.puml](./AS04-mcp-upstream-api-access.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST IA-2, SC-23; STIG V-222522 | The MCP request carries an internal-AS token with aud=MCP, which is validated. |
| 2 | NIST AC-3 | RBAC plus the ActionHook pipeline decide whether the human may sync. |
| 3b | NIST AC-6, SC-23 | (b) Token exchange gives a short-lived, narrowly scoped provider token. It needs a subject token the provider trusts. |
| 3c | NIST SC-28(1), SC-12; STIG V-222588 | (c) Stored refresh token, encrypted under a KeyProvider-wrapped DEK. This works offline and in background, at the cost of custody risk. |
| 3d | NIST AC-3, SC-23 | (d) Passthrough is rejected by the MCP spec (MUST NOT pass through or transit tokens). |
| 4 | NIST AU-3, AU-10; STIG V-222438 | Audit names the human `sub`, the OAuth client, `jti`, and the upstream mode. |
