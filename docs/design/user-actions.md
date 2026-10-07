# User actions inventory (draft)

Roles in play (draft): Reader, Author, Developer, Tester, Release manager, Security, AO (approve-only), Catalog steward (global/client/project), Project admin, Client admin, Auditor; **Key custodian** (deployment-scoped, key-store ops only — ARCH-KEY-CUSTODIAN).

Note: approver roles are **WorkflowProfile RoleBinding** (project/client configurable) — commercial dogfood binds stakeholder → Client admin; AO remains cyber/migrate slot. Approval grain = **line** (D12/D13). See `roles/workflow-system.md`.

Scope: Client Scoped View is assumed for most project work.

## A. Identity & access
1. Sign in via SSO (OIDC/SAML)
1a. Sign in with local account at internal AS (only if auth profile enables local accounts; lockout / MFA / step-up) — AS02
1b. Federated SSO through the internal AS (AS mints tokens) — AS03
1c. Authorize MCP client (OAuth 2.1 + PKCE S256, audience-bound token; refresh / revoke) — AS01
2. Sign out
3. Select Client Scoped View
4. Clear / change Scoped View
5. View own profile / grants
6. Invite / link identity to client or project (admin)
7. Grant project role
8. Revoke project role
8a. Unlock locked local account (`auth:account:unlock`)
8b. Register / approve OAuth client (pre-registered baseline; CIMD / DCR policy-gated)
8c. Configure upstream IdP connector + claim mapping for a client tenant (Client admin; step-up)
8d. Break-glass local recovery sign-in (profile-enabled; MFA; alerted)
9. Grant catalog-steward at global / client / project
10. Revoke catalog-steward
11. List who has access to a project
12. Impersonate / break-glass (if ever; flag as later)

## B. Client & project structure
13. Create client
14. Update client metadata
15. Archive / deactivate client
16. Create project under client
17. Update project
18. Archive project
19. List clients (permission-filtered)
20. List projects in scoped client

## C. Requirement tree (lines)
21. Create section / requirement / control / capability line
22. Rename / retitle line
23. Move line (change parent)
24. Reorder siblings
25. Soft-delete / tombstone line (via obsolete version flow)
26. View tree (mind map / outline)
27. Expand / collapse / filter tree
28. Search requirements in client/project

## D. Requirement versions (`.N`)
29. Create first version of a line
30. Create successor version (`.N+1`)
31. Edit draft version fields (statement, metadata)
32. Mark version active (lifecycle only — not stakeholder approve)
33. Mark version obsolete / withdrawn
34. View lineage / succession for a UID
35. Compare two versions
36. Set / clear priority on a version (requires stakeholder approval)
37. Attach / change iteration on a version
38. Add verification note (tester)
39. Tag security metadata (catalog ref, verification)
39a. Stakeholder Approve a requirement/capability **line** (+ direct children) (D12 / UI-APPROVE-LINE)
39b. Stakeholder Approve Tree (line + full descendants) (D13 / UI-APPROVE-TREE)
39c. Set verification_outcome pass/fail/pending (tester; first-class; ship via profile Gate)
39d. Mint successor `.N` with mint_kind (content|status|pin|security_meta) — content same-hash blocked; content/pin clear approval (+ planning_blocked on content); status/security_meta audit-only
39e. Activate version (D04) — prior active → superseded in-place same txn (≤1 active)
39f. Resolve planning_blocked via re-approve after content `.N`
39g. Gate sign-off (Security/AO slots) for cyber ship or locked migrate

## E. Traces / edges
40. Add edge `refines`
41. Request ConformsTo pin (`catalog:pin:request`) — Author; apply/deny via applicator slot
41a. Apply / deny ConformsTo pin (`catalog:pin:apply|deny`) — Security/Steward (or commercial-bound Author)
42. Add edge `uses`
43. Add edge `satisfies` (capability → requirement)
44. Remove edge
45. View traceability graph / matrix
46. Navigate from requirement to linked control / capability
46a. Review suspect queue (carry-forward / keep-pinned / drop) — audited
46b. View / filter `trace_suspect` edges and contract/release junctions

## F. Contracts
47. Create contract
48. Update contract (dates, name, status)
49. Close contract
50. Link requirement version to contract (`in_scope_of`)
51. Unlink requirement version from contract
52. Bulk-link set of versions to contract
53. Open document view built from contract (filter + parent walk)
54. Toggle include context parents
55. View contract overlap timeline
56. List contracts for client/project

## G. Releases & snapshots
57. Create planned release
58. Update planned release
59. Add/remove requirement versions to planned release
60. Prioritize / order release backlog from priorities
61. Ship release (freeze snapshot; profile Gates: cyber_gate / verification_ship when enabled)
62. View snapshot vs prior release (diff)
63. Open Gantt / schedule view from releases + priorities + iterations (product req — ARCH-GANTT)
64. List releases for project

## H. Catalogs
65. Create catalog (global / client / project)
66. Update catalog metadata
67. Publish catalog version / imprint (if versioned)
68. Add catalog item (template)
69. Update catalog item (non-standard mutable catalogs only)
70. Reference standard catalog item from a requirement (no copy)
71. Copy non-standard catalog template into a project line
72. Deprecate catalog item
73. Browse catalogs available at current scope
74. Migrate to new catalog imprint (or item) at any hierarchy scope — mandatory preview, then apply

## I. Capabilities & artifacts
75. Create capability line **with** Satisfies edge(s) in same mutation (no orphans)
76. Link additional capability Satisfies requirement
76a. Approve CapabilityLine as solution (RoleBinding solution_approver slot)
77. Attach artifact (OpenAPI, wireframe, mock, other)
78. Update / replace artifact URI
79. Remove artifact
80. View capability pack / regression bed grouping (later)

## J. Work items & sync
81. Mark requirement ready for work item
82. Create work item from requirement version
83. Update work item link mapping
84. Push field changes req → work item
85. Pull field changes work item → req (backfeed)
86. Resolve sync conflict
87. View sync status / last sync
88. Disconnect work item link

## K. Grooming / agile flow
89. Open priority queue / backlog planning view (“what to groom next”) — ARCH-BACKLOG
90. Walk parent detail-debt from a priority leaf
91. Advance grooming state (want → detailed → WI-ready)
92. Assign iteration / sprint
93. View work track by iteration
94. View release path vs work track

## L. Import / export / interchange
95. Import StrictDoc / notation file
96. Export project or contract view to StrictDoc
97. Export document view (PDF/Markdown) — later
98. Export snapshot bill of requirements

## M. Audit & admin ops
99. View audit log for an entity
100. View audit log for a client (auditor)
101. Configure OTEL / log sinks (ops)
102. Health check / read API version
102a. Open / close leaf change set
102b. Open / close SDLC parent change-set session
102c. Revert / re-apply latest change set on stack (retain forever; non-latest deny unless abandon-suffix; field undo = future want)
102d. View approval queue tree (unapproved primary; approved dimmed/collapsed) — line grain
102e. Configure WorkflowProfile (gates, slots, hooks, planning_gate_actions) — Client/Project admin
102f. Select project WorkflowProfile / override RoleBindings
102g. Rotate KEK + online DEK re-wrap (Key custodian; step-up) — KS01
102h. Rotate token signing key (scheduled or on demand; JWKS overlap) — KS02
102i. Revoke / destroy key; break-glass key recovery (Key custodian, dual control)

## N. UI chrome (no domain write)
103. Toggle mind-map vs tree vs document view
104. Pin favorite contract / project
105. Use global search
