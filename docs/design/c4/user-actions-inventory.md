# User actions inventory (draft)

Roles in play (draft): Reader, Author, Developer, Tester, Release manager, Security, Catalog steward (global/client/project), Project admin, Client admin, Auditor.

Scope: Client Scoped View is assumed for most project work.

## A. Identity & access
1. Sign in via SSO (OIDC/SAML)
2. Sign out
3. Select Client Scoped View
4. Clear / change Scoped View
5. View own profile / grants
6. Invite / link identity to client or project (admin)
7. Grant project role
8. Revoke project role
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
32. Mark version active
33. Mark version obsolete / withdrawn
34. View lineage / succession for a UID
35. Compare two versions
36. Set / clear priority on a version
37. Attach / change iteration on a version
38. Add verification note (tester)
39. Tag security metadata (catalog ref, verification)

## E. Traces / edges
40. Add edge `refines`
41. Add edge `conforms_to`
42. Add edge `uses`
43. Add edge `satisfies` (capability → requirement)
44. Remove edge
45. View traceability graph / matrix
46. Navigate from requirement to linked control / capability

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
61. Ship release (freeze snapshot of delivered versions)
62. View snapshot vs prior release (diff)
63. Open Gantt / schedule view from releases + priorities
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

## I. Capabilities & artifacts
74. Create capability (or capability-kind line)
75. Link capability satisfies requirement
76. Attach artifact (OpenAPI, wireframe, mock, other)
77. Update / replace artifact URI
78. Remove artifact
79. View capability pack / regression bed grouping (later)

## J. Work items & sync
80. Mark requirement ready for work item
81. Create work item from requirement version
82. Update work item link mapping
83. Push field changes req → work item
84. Pull field changes work item → req (backfeed)
85. Resolve sync conflict
86. View sync status / last sync
87. Disconnect work item link

## K. Grooming / agile flow
88. Open priority queue (“what to groom next”)
89. Walk parent detail-debt from a priority leaf
90. Advance grooming state (want → detailed → WI-ready)
91. Assign iteration / sprint
92. View work track by iteration
93. View release path vs work track

## L. Import / export / interchange
94. Import StrictDoc / notation file
95. Export project or contract view to StrictDoc
96. Export document view (PDF/Markdown) — later
97. Export snapshot bill of requirements

## M. Audit & admin ops
98. View audit log for an entity
99. View audit log for a client (auditor)
100. Configure OTEL / log sinks (ops)
101. Health check / read API version

## N. UI chrome (no domain write)
102. Toggle mind-map vs tree vs document view
103. Pin favorite contract / project
104. Use global search

Sequence index: [`sequences/INDEX.md`](./sequences/INDEX.md).
