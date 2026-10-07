# User action sequence index

Inventory of **104** user actions from [`user-actions-inventory.md`](../user-actions-inventory.md). Add one sequence diagram per action over time; do not create empty stub `.puml` files for every row.

| Global | ID | Action | Status | RBAC op | Primary control families | Diagram / companion |
|--------|-----|--------|--------|---------|--------------------------|---------------------|
| 1 | A01 | Sign in via SSO (OIDC/SAML) | draft | `auth:signin` (TBD with Dan) | IA, AU, AC | [A01-sign-in-sso.puml](./A01-sign-in-sso.puml), [A01-sign-in-sso.md](./A01-sign-in-sso.md) |
| 2 | A02 | Sign out | draft | `auth:signout` (proposed) | AC, AU, IA | [A02-sign-out.puml](./A02-sign-out.puml), [A02-sign-out.md](./A02-sign-out.md) |
| 3 | A03 | Select Client Scoped View | draft | `client:scope:select` (proposed) | AC, AU | [A03-select-client-scoped-view.puml](./A03-select-client-scoped-view.puml), [A03-select-client-scoped-view.md](./A03-select-client-scoped-view.md) |
| 4 | A04 | Clear / change Scoped View | draft | `client:scope:clear` (proposed) | AC, AU | [A04-clear-change-scoped-view.puml](./A04-clear-change-scoped-view.puml), [A04-clear-change-scoped-view.md](./A04-clear-change-scoped-view.md) |
| 5 | A05 | View own profile / grants | draft | `identity:read_self` (proposed) | AC, AU, IA | [A05-view-own-profile-grants.puml](./A05-view-own-profile-grants.puml), [A05-view-own-profile-grants.md](./A05-view-own-profile-grants.md) |
| 6 | A06 | Invite / link identity to client or project (admin) | draft | `identity:link` (proposed) | AC, AU, IA | [A06-invite-link-identity.puml](./A06-invite-link-identity.puml), [A06-invite-link-identity.md](./A06-invite-link-identity.md) |
| 7 | A07 | Grant project role | draft | `project:grant:create` (proposed) | AC, AU | [A07-grant-project-role.puml](./A07-grant-project-role.puml), [A07-grant-project-role.md](./A07-grant-project-role.md) |
| 8 | A08 | Revoke project role | draft | `project:grant:revoke` (proposed) | AC, AU | [A08-revoke-project-role.puml](./A08-revoke-project-role.puml), [A08-revoke-project-role.md](./A08-revoke-project-role.md) |
| 9 | A09 | Grant catalog-steward at global / client / project | stub | TBD |  | — |
| 10 | A10 | Revoke catalog-steward | stub | TBD |  | — |
| 11 | A11 | List who has access to a project | stub | TBD |  | — |
| 12 | A12 | Impersonate / break-glass (if ever; flag as later) | stub | TBD |  | — |
| 13 | B01 | Create client | stub | TBD |  | — |
| 14 | B02 | Update client metadata | stub | TBD |  | — |
| 15 | B03 | Archive / deactivate client | stub | TBD |  | — |
| 16 | B04 | Create project under client | stub | TBD |  | — |
| 17 | B05 | Update project | stub | TBD |  | — |
| 18 | B06 | Archive project | stub | TBD |  | — |
| 19 | B07 | List clients (permission-filtered) | stub | TBD |  | — |
| 20 | B08 | List projects in scoped client | stub | TBD |  | — |
| 21 | C01 | Create section / requirement / control / capability line | stub | TBD |  | — |
| 22 | C02 | Rename / retitle line | stub | TBD |  | — |
| 23 | C03 | Move line (change parent) | stub | TBD |  | — |
| 24 | C04 | Reorder siblings | stub | TBD |  | — |
| 25 | C05 | Soft-delete / tombstone line (via obsolete version flow) | stub | TBD |  | — |
| 26 | C06 | View tree (mind map / outline) | stub | TBD |  | — |
| 27 | C07 | Expand / collapse / filter tree | stub | TBD |  | — |
| 28 | C08 | Search requirements in client/project | stub | TBD |  | — |
| 29 | D01 | Create first version of a line | stub | TBD |  | — |
| 30 | D02 | Create successor version (.N+1) | stub | TBD |  | — |
| 31 | D03 | Edit draft version fields (statement, metadata) | stub | TBD |  | — |
| 32 | D04 | Mark version active | stub | TBD |  | — |
| 33 | D05 | Mark version obsolete / withdrawn | stub | TBD |  | — |
| 34 | D06 | View lineage / succession for a UID | stub | TBD |  | — |
| 35 | D07 | Compare two versions | stub | TBD |  | — |
| 36 | D08 | Set / clear priority on a version | stub | TBD |  | — |
| 37 | D09 | Attach / change iteration on a version | stub | TBD |  | — |
| 38 | D10 | Add verification note (tester) | stub | TBD |  | — |
| 39 | D11 | Tag security metadata (catalog ref, verification) | stub | TBD |  | — |
| 40 | E01 | Add edge refines | stub | TBD |  | — |
| 41 | E02 | Add edge conforms_to | stub | TBD |  | — |
| 42 | E03 | Add edge uses | stub | TBD |  | — |
| 43 | E04 | Add edge satisfies (capability → requirement) | stub | TBD |  | — |
| 44 | E05 | Remove edge | stub | TBD |  | — |
| 45 | E06 | View traceability graph / matrix | stub | TBD |  | — |
| 46 | E07 | Navigate from requirement to linked control / capability | stub | TBD |  | — |
| 47 | F01 | Create contract | stub | TBD |  | — |
| 48 | F02 | Update contract (dates, name, status) | stub | TBD |  | — |
| 49 | F03 | Close contract | stub | TBD |  | — |
| 50 | F04 | Link requirement version to contract (in_scope_of) | stub | TBD |  | — |
| 51 | F05 | Unlink requirement version from contract | stub | TBD |  | — |
| 52 | F06 | Bulk-link set of versions to contract | stub | TBD |  | — |
| 53 | F07 | Open document view built from contract (filter + parent walk) | stub | TBD |  | — |
| 54 | F08 | Toggle include context parents | stub | TBD |  | — |
| 55 | F09 | View contract overlap timeline | stub | TBD |  | — |
| 56 | F10 | List contracts for client/project | stub | TBD |  | — |
| 57 | G01 | Create planned release | stub | TBD |  | — |
| 58 | G02 | Update planned release | stub | TBD |  | — |
| 59 | G03 | Add/remove requirement versions to planned release | stub | TBD |  | — |
| 60 | G04 | Prioritize / order release backlog from priorities | stub | TBD |  | — |
| 61 | G05 | Ship release (freeze snapshot of delivered versions) | stub | TBD |  | — |
| 62 | G06 | View snapshot vs prior release (diff) | stub | TBD |  | — |
| 63 | G07 | Open Gantt / schedule view from releases + priorities | stub | TBD |  | — |
| 64 | G08 | List releases for project | stub | TBD |  | — |
| 65 | H01 | Create catalog (global / client / project) | stub | TBD |  | — |
| 66 | H02 | Update catalog metadata | stub | TBD |  | — |
| 67 | H03 | Publish catalog version / imprint (if versioned) | stub | TBD |  | — |
| 68 | H04 | Add catalog item (template) | stub | TBD |  | — |
| 69 | H05 | Update catalog item (non-standard mutable catalogs only) | stub | TBD |  | — |
| 70 | H06 | Reference standard catalog item from a requirement (no copy) | stub | TBD |  | — |
| 71 | H07 | Copy non-standard catalog template into a project line | stub | TBD |  | — |
| 72 | H08 | Deprecate catalog item | stub | TBD |  | — |
| 73 | H09 | Browse catalogs available at current scope | stub | TBD |  | — |
| 74 | I01 | Create capability (or capability-kind line) | stub | TBD |  | — |
| 75 | I02 | Link capability satisfies requirement | stub | TBD |  | — |
| 76 | I03 | Attach artifact (OpenAPI, wireframe, mock, other) | stub | TBD |  | — |
| 77 | I04 | Update / replace artifact URI | stub | TBD |  | — |
| 78 | I05 | Remove artifact | stub | TBD |  | — |
| 79 | I06 | View capability pack / regression bed grouping (later) | stub | TBD |  | — |
| 80 | J01 | Mark requirement ready for work item | stub | TBD |  | — |
| 81 | J02 | Create work item from requirement version | stub | TBD |  | — |
| 82 | J03 | Update work item link mapping | stub | TBD |  | — |
| 83 | J04 | Push field changes req → work item | stub | TBD |  | — |
| 84 | J05 | Pull field changes work item → req (backfeed) | stub | TBD |  | — |
| 85 | J06 | Resolve sync conflict | stub | TBD |  | — |
| 86 | J07 | View sync status / last sync | stub | TBD |  | — |
| 87 | J08 | Disconnect work item link | stub | TBD |  | — |
| 88 | K01 | Open priority queue (“what to groom next”) | stub | TBD |  | — |
| 89 | K02 | Walk parent detail-debt from a priority leaf | stub | TBD |  | — |
| 90 | K03 | Advance grooming state (want → detailed → WI-ready) | stub | TBD |  | — |
| 91 | K04 | Assign iteration / sprint | stub | TBD |  | — |
| 92 | K05 | View work track by iteration | stub | TBD |  | — |
| 93 | K06 | View release path vs work track | stub | TBD |  | — |
| 94 | L01 | Import StrictDoc / notation file | stub | TBD |  | — |
| 95 | L02 | Export project or contract view to StrictDoc | stub | TBD |  | — |
| 96 | L03 | Export document view (PDF/Markdown) — later | stub | TBD |  | — |
| 97 | L04 | Export snapshot bill of requirements | stub | TBD |  | — |
| 98 | M01 | View audit log for an entity | stub | TBD |  | — |
| 99 | M02 | View audit log for a client (auditor) | stub | TBD |  | — |
| 100 | M03 | Configure OTEL / log sinks (ops) | stub | TBD |  | — |
| 101 | M04 | Health check / read API version | stub | TBD |  | — |
| 102 | N01 | Toggle mind-map vs tree vs document view | stub | TBD |  | — |
| 103 | N02 | Pin favorite contract / project | stub | TBD |  | — |
| 104 | N03 | Use global search | stub | TBD |  | — |

## ReqAML MCP agent actions (extension)

IDs **`MC**`** avoid collision with inventory section **M** (audit ops M01–M04). Pattern adapted from Operation Charity workflow MCP + desk-session sealing (see MC01 companion).

| Global | ID | Action | Status | RBAC op | Primary control families | Diagram / companion |
|--------|-----|--------|--------|---------|--------------------------|---------------------|
| — | MC01 | MCP authenticate session & desk bind | draft | `mcp:session:create`, `desk:list`, `desk:attach`, `desk:detach` (proposed) | IA, AC, AU, SC | [MC01-mcp-auth-desk-bind.puml](./MC01-mcp-auth-desk-bind.puml), [MC01-mcp-auth-desk-bind.md](./MC01-mcp-auth-desk-bind.md) |
| — | MC02 | MCP mutating tool with desk attached (**draft** update_draft; not mint) | draft | `requirement:version:update_draft` (proposed) | AC, AU, CM, SC | [MC02-mcp-mutate-requirement-version.puml](./MC02-mcp-mutate-requirement-version.puml), [MC02-mcp-mutate-requirement-version.md](./MC02-mcp-mutate-requirement-version.md) |


## Auth foundation sequences (internal OAuth AS · credential store · key store)

The first build slice is **ARCH-BUILD-FOUNDATION**: platform shell plus authentication. IDs **`AS**`** (authorization server / credential store) and **`KS**`** (key store) are extensions; they do not collide with inventory letters. Each flow includes `C4_Sequence_Macros.puml` and uses the auth macros (`ProtectedResourceDiscovery`, `PkceAuthorize`, `TokenIssue`, `TokenValidate`, `RefreshRotate`, `LockoutCheck`, `MfaChallenge`, `AuthAuditLog`, `KeyOp`) ahead of the standard RbacCheck → HookEval → GateCheck → mutate → HookEffectsAfter → AuditLog pipeline.

| Global | ID | Action | Status | RBAC op | Primary control families | Diagram / companion |
|--------|-----|--------|--------|---------|--------------------------|---------------------|
| — | AS01 | MCP client authorization via internal OAuth 2.1 AS (PKCE S256, PRM, audience, refresh rotation, revoke) | draft | `auth:oauth:authorize`, `auth:oauth:token`, `auth:oauth:revoke` | IA, AC, SC, AU, CM | [AS01-mcp-oauth-authorize.puml](./AS01-mcp-oauth-authorize.puml), [AS01-mcp-oauth-authorize.md](./AS01-mcp-oauth-authorize.md) |
| — | AS02 | Local account login with lockout and MFA (credential store) | draft | `auth:local:signin`, `auth:account:unlock` | IA, AC, AU, SC | [AS02-local-login-lockout-mfa.puml](./AS02-local-login-lockout-mfa.puml), [AS02-local-login-lockout-mfa.md](./AS02-local-login-lockout-mfa.md) |
| — | AS03 | Federated enterprise SSO through the internal AS | draft | `auth:signin` | IA, AC, SC, AU | [AS03-federated-sso-via-as.puml](./AS03-federated-sso-via-as.puml), [AS03-federated-sso-via-as.md](./AS03-federated-sso-via-as.md) |
| — | KS01 | KEK rotation with online DEK re-wrap (OpenBao Transit) | draft | `key:kek:rotate`, `key:dek:rewrap` | SC, AC, IA, AU | [KS01-kek-rotate-dek-rewrap.puml](./KS01-kek-rotate-dek-rewrap.puml), [KS01-kek-rotate-dek-rewrap.md](./KS01-kek-rotate-dek-rewrap.md) |
| — | KS02 | Token signing via KeyProvider + JWKS rotation overlap | draft | `key:signing:rotate` | SC, AU | [KS02-token-signing-keyprovider.puml](./KS02-token-signing-keyprovider.puml), [KS02-token-signing-keyprovider.md](./KS02-token-signing-keyprovider.md) |

**Notes:** A01 and MC01 remain as drawn. AS03 shows how A01's IdP federates *through* the AS, and AS01 is the OAuth path MC01.1 relies on (see open questions on minting A01.1 / MC01.2).

## Workflow / Cyber+QA sequences (ActionHook pipeline)

IDs align with [`../../user-actions.md`](../../user-actions.md) / locked seed (ARCH-WORKFLOW, ARCH-MINT-KIND, ARCH-APPROVAL-LINE, ARCH-SUSPECT*, ARCH-GATE-SIGNOFF). All diagrams compose **`HookEval` / `GateCheck` / `HookEffectsAfter`** — see [WF01](./WF01-actionhook-eval.puml).

| Global | ID | Action | Status | RBAC op | Primary control families | Diagram / companion |
|--------|-----|--------|--------|---------|--------------------------|---------------------|
| — | WF01 | ActionHook evaluator (shared pattern) | draft | `{action_id}` | AC, AU, CM | [WF01-actionhook-eval.puml](./WF01-actionhook-eval.puml), [WF01-actionhook-eval.md](./WF01-actionhook-eval.md) |
| 39a | D12 | Stakeholder Approve line (+ children); clears planning_blocked (D39f) | draft | `requirement:line:approve` | AC, AU, CM | [D12-approve-line.puml](./D12-approve-line.puml), [D12-approve-line.md](./D12-approve-line.md) |
| 39d | D39d | Mint successor `.N` with mint_kind | draft | `requirement:version:mint` | AC, AU, CM | [D39d-mint-successor.puml](./D39d-mint-successor.puml), [D39d-mint-successor.md](./D39d-mint-successor.md) |
| 39g | D39g | Gate sign-off (Security/AO slots) | draft | `gate:signoff` | AC, AU, CM | [D39g-gate-signoff.puml](./D39g-gate-signoff.puml), [D39g-gate-signoff.md](./D39g-gate-signoff.md) |
| 41 | E41 | Request ConformsTo pin | draft | `catalog:pin:request` | AC, AU, CM | [E41-pin-request.puml](./E41-pin-request.puml), [E41-pin-request.md](./E41-pin-request.md) |
| 41a | E41a | Apply / deny ConformsTo pin | draft | `catalog:pin:apply\|deny` | AC, AU, CM | [E41a-pin-apply-deny.puml](./E41a-pin-apply-deny.puml), [E41a-pin-apply-deny.md](./E41a-pin-apply-deny.md) |
| 46a | E46a | Suspect queue (carry-forward / keep-pinned / drop) | draft | `trace:suspect:*` | AC, AU, CM | [E46a-suspect-queue.puml](./E46a-suspect-queue.puml), [E46a-suspect-queue.md](./E46a-suspect-queue.md) |
| 61 | G61 | Ship release (cyber_gate trigger; gate_signoff pass) | draft | `release:ship` | AC, AU, CM | [G61-ship-release.puml](./G61-ship-release.puml), [G61-ship-release.md](./G61-ship-release.md) |

**Notes**

- **D39f** (resolve `planning_blocked`) is folded into **D12** via `effects_after: clear_planning_blocked`.
- Soft: **`cyber_gate`** = ship Gate **trigger**; **`gate_signoff`** rows = **pass condition** (see G61 + D39g).
