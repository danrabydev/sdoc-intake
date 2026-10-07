# MC02 — ReqALM MCP: mutating tool with desk attached

Companion to **MC01**. Mutations follow **HTTP → ActionHook pipeline → data → Postgres** (same as UI). Live preview uses **session-sealed desk WebSocket** (Operation Charity ADR 0018 pattern), not MCP tool transport.

**Draft vs mint:** this diagram is **in-place draft** edit (`requirement:version:update_draft`). Successor `.N` with `mint_kind` is **D39d** (clears approval / planning_blocked / suspect per ARCH-MINT-KIND).

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `requirement:version:update_draft` (proposed; plus MC01 desk bind ops) |
| Pipeline | `RbacCheck` → `HookEval` → mutate → `HookEffectsAfter` → `AuditLog` |
| Diagram | [MC02-mcp-mutate-requirement-version.puml](./MC02-mcp-mutate-requirement-version.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST AC-3; STIG TBD | Tool runs only with valid MCP session + desk attach. |
| 2 | NIST SC-8; STIG TBD | PATCH over TLS with client scope. |
| 3 | NIST AC-3, CM-3; STIG TBD | Draft-only business rules; not a mint. |
| 4 | NIST AC-3, AC-6; STIG TBD | RBAC mirrors Author role; scoped by client. |
| 5 | NIST CM-3; STIG TBD | HookEval loads profile ActionHooks (may be empty gates). |
| 6 | NIST AC-3; STIG TBD | Postgres enforces client boundary on write. |
| 7 | NIST AU-2, AU-3, AU-12; STIG TBD | Audit agent-originated mutation (`source=mcp`). |
| 8 | NIST SC-23, SC-8; STIG TBD | Desk push sealed to session; MCP/RPC remain HTTPS. |
| 9 | NIST AC-3; STIG TBD | Human desk reflects change without bypassing guards. |
