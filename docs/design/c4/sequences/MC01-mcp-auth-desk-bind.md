# MC01 — ReqALM MCP: authenticate session & desk bind

Adapted from [Operation Charity `oc-workflow-mcp`](https://github.com/Operation-Charity/oc-core/tree/main/apps/mcp/oc-workflow-mcp) (login/logout, `list_desks` / `attach_desk` / `detach_desk`, OAuth opaque tokens → platform session) and [ADR 0018 desk-session-sealing](https://github.com/Operation-Charity/oc-core/blob/main/docs/adr/0018-desk-session-sealing.md) (desk = routing handle; tenant/auth from session; HPKE-sealed WSS pushes; MCP stays HTTPS).

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC ops | `mcp:session:create`, `desk:list`, `desk:attach`, `desk:detach` (proposed) |
| Diagram | [MC01-mcp-auth-desk-bind.puml](./MC01-mcp-auth-desk-bind.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST SC-8, IA-2; STIG TBD | MCP transport protected (TLS remote / trusted local stdio). |
| 2 | NIST IA-2, IA-5; STIG TBD | Opaque OAuth token introspection maps to same session model as UI. |
| 3 | NIST IA-2; STIG TBD | Stdio login reuses SSO callback path (A01 alignment). |
| 4 | NIST AC-3, AC-2; STIG TBD | MCP session creation requires RBAC; no shadow admin. |
| 5 | NIST AC-6; STIG TBD | Sticky MCP context when host loses tool state (OC `McpSession` pattern). |
| 6 | NIST AU-2, AU-12; STIG TBD | Audit MCP session establishment. |
| 7 | NIST AC-3; STIG TBD | Human desk tab behind routes+guards + client scope. |
| 8 | NIST SC-8, SC-23; STIG TBD | Session-sealed desk WebSocket (ReqALM channel TBD). |
| 9 | NIST AC-3; STIG TBD | `desk:list` scoped to actor + client. |
| 10 | NIST AC-3; STIG TBD | `desk:attach` binds agent routing to browser tab. |
| 11 | NIST AU-2, AU-12; STIG TBD | Audit attach/detach (privilege/context change). |
| 12 | NIST SC-23; STIG TBD | Agent presence push only on sealed desk channel. |
