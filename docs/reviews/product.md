# Product design review — requirements suite (StrictDoc depth)

Review basis: stated product design only (standalone requirements app; Azure DevOps as client; Postgres + Rust API sole writer; React/TS + SAML/OIDC; global catalogs; project-owned document folders; tag tree; relation edges; ADO two-way work items; project RBAC; local StrictDoc editor not mapped to schema). No implementation implied.

---

## Missing users

| Gap | Why it blocks slicing and acceptance |
|-----|--------------------------------------|
| No primary persona for day-one use | Unclear whether the product is for authors, integrators, or compliance owners; MVP feature order and onboarding differ for each. |
| Catalog steward / standards owner | Global catalogs, `isCatalog`, `isStandard`, and “referenced not copied” imply a cross-project role with publish and breaking-change authority; no user, no workflow for proposing or approving catalog changes. |
| Project requirements engineer | Project-owned folders and StrictDoc-depth editing need a defined author who is not assumed to be a DevOps user; RBAC and UI entry points depend on this. |
| Azure DevOps practitioner | Extension passes DevOps token; two-way work-item sync assumes someone plans sprints/backlogs from generated items; no story for backlog owner vs requirements author. |
| Identity-bound “same person” operator | Design requires app OIDC/SAML identity and DevOps token to represent one human; no user for the failure modes (token for user A, session for user B, service accounts, PAT shared by team). |
| Project / org administrator | Project RBAC with unnamed roles still needs someone who assigns membership, connects IdP, and links ADO org/project; no admin persona or separation from author. |
| Auditor / assessor (read-only) | Compliance-oriented edges (`conforms_to`, standards references) usually need read-only export and trace reports; no reader-only user or export consumer. |
| Migrator from local StrictDoc | Explicit gap: current local editor is not mapped to tables; no user story for who runs migration, validates parity, or rolls back. |
| Extension-only vs web-only user | “Extension documents unused” vs full UI implies two surfaces; no definition of who uses which and what they cannot do on the other. |

---

## Missing jobs (jobs-to-be-done)

| Job | What the design leaves unspecified |
|-----|-----------------------------------|
| Stand up a new project requirements space | Folder ownership, default templates, catalog attachment, RBAC bootstrap, and ADO linkage order are undefined. |
| Author and maintain requirements at StrictDoc depth | Table mapping from local editor absent; no job steps for create section, move tag, edit statement, validate grammar. |
| Attach project work to global standards without copying | Reference resolution, version pinning, drift when catalog updates, and broken-link behavior are not described. |
| Navigate and edit via outline / mind-map | “Empty metadata” on outline nodes leaves create/rename/reorder/parent rules and validation timing unstated. |
| Maintain tag tree with section parents and title-on-tag | No job for bulk re-parent, merge tags, or conflict when title vs UID vs ADO title diverge. |
| Trace requirements through relation edges | Four edge types named but no jobs for traverse, impact analysis, gap detection, or reporting (`refines`, `conforms_to`, `delivers`, `uses`). |
| Generate Azure DevOps work items from documents | Grouping by document then section is stated; jobs missing for idempotency, update vs create, closure, deletion, and relinking after restructure. |
| Keep DevOps and requirements in sync (two-way) | API updates work items both ways with no job definition for conflict resolution, source of truth per field, or offline/async retry. |
| Sign in and act with unified identity | SAML/OIDC plus DevOps token pass-through needs a job for initial link, re-auth, and token expiry during long edits. |
| Govern catalogs and standards flags | `isCatalog` / `isStandard` without jobs for create catalog entry, deprecate, fork for project exception, or audit who changed global data. |
| Operate without a security document | For suites sold on compliance, absence of security/privacy requirements doc is a missing job for customer security review and internal threat modeling. |

---

## Scope that cannot be sliced (monolith risk)

| Area | Issue |
|------|--------|
| Rust API as sole writer + Postgres | Any UI or ADO path that reads stale cache or writes around the API breaks the model; cannot ship “read-only cloud viewer” without full write pipeline and auth. |
| SAML/OIDC + project RBAC + unnamed roles | Authorization is unspecified; incremental “open read-only” or “single shared project” still needs a decided permission model before first customer. |
| Azure DevOps two-way sync | One-way export might be sliceable; bidirectional sync binds identity mapping, field mapping, deletion semantics, and conflict policy—cannot defer all of these behind “phase 2” without accepting data corruption risk. |
| DevOps extension token + app session same person | Extension and web app are coupled at identity; partial delivery (extension without web SSO or reverse) violates the design constraint. |
| Global catalogs + project references | Catalogs are global while projects own folders; minimum viable catalog seed, reference integrity, and multi-tenant isolation must ship together or references fail across projects. |
| StrictDoc depth without editor-to-table mapping | Cannot claim StrictDoc parity until mapping exists; shipping cloud UI without migration/mapping strand existing local users. |
| Work-item generation grouped by document and section | Requires stable section identity in DB; restructuring sections without defined stable keys breaks ADO linkage—blocks incremental “generate once” without schema rules. |
| Relation graph + tag tree + outline | Three overlapping hierarchies (tree, graph edges, outline/mind-map) without a canonical model prevent slicing “tree first, graph later” without rework. |
| No security document in design | Sales and enterprise adoption often gate on security questionnaire; absence is not a technical slice—it is a release gate for a subset of buyers. |

---

## Outcomes with no success test

| Stated outcome | Missing success test |
|----------------|---------------------|
| StrictDoc depth (not MBSE) | No checklist of StrictDoc constructs in/out of scope; no acceptance test comparing parsed `.sdoc` round-trip to API-stored form. |
| Azure DevOps is client, not database | No test that ADO outage or deletion does not destroy requirements truth; no RPO/RTO for requirements data in Postgres only. |
| Standards referenced, not copied | No test for catalog version bump: project still resolves, warnings appear, or links break predictably. |
| Two-way work-item updates | No scenarios: edit title in ADO vs in app; close work item; delete; move across area path; duplicate generation run. |
| Same person for both tokens | No test matrix for mismatched identities, expired DevOps token mid-save, or federated IdP with non-email principal. |
| Project RBAC | No given roles ⇒ no tests for “user X cannot read catalog edit” or “cannot sync to ADO.” |
| Work items grouped by document then section | No expected ADO hierarchy (epic/feature/task), field mapping, or count stability after edit. |
| Tags tree with section parents; title on tag | No validation rules test (duplicate titles, orphan tags, circular parents). |
| Outline/mind-map with empty metadata | No definition of done for “empty” vs invalid; no UX success metric (create 50 nodes, persist, reload). |
| Edge semantics (`refines`, `conforms_to`, `delivers`, `uses`) | No cardinality, direction, or forbidden cycle tests; no trace report acceptance. |
| Extension documents unused | No success criterion for what the extension must ship anyway (auth only? sync trigger?) vs explicit non-goals. |
| Local StrictDoc editor unmigrated | No milestone test for feature parity or deprecation of local tool. |

---

## Decisions a product owner cannot defer

| Decision | Consequence if deferred |
|----------|-------------------------|
| Named roles and permission matrix (project RBAC) | Engineering invents defaults; customers cannot plan segregation of duties or SOX-style controls. |
| Tenant model: org, project, catalog namespace | Ambiguous global catalogs vs customer isolation; wrong choice is costly to migrate. |
| Canonical identity key linking OIDC subject to DevOps user | Two-way sync and audit trail attach to the wrong human or fail silently. |
| Source of truth per field (requirements vs ADO) for two-way sync | Guaranteed duplicate or overwritten data without written precedence rules. |
| Stable identifiers for sections/tags across restructure | Work-item generation and edges break; regeneration duplicates ADO items. |
| `isCatalog` vs `isStandard` definitions and mutability | Authors misuse flags; compliance reports become meaningless. |
| Global catalog change governance (who publishes, semver, deprecation) | “Referenced not copied” fails in production when NIST/STIG updates. |
| Grammar / StrictDoc feature subset for v1 | Scope creep or failed parity claims; migration mapping cannot start. |
| Editor-to-relational schema mapping (local StrictDoc → tables) | Dual truth (files vs cloud) until decided; blocks migration comms and support. |
| ADO work item type mapping and hierarchy (document → section → WI) | DevOps admins reject the integration; regen scripts unsafe. |
| Behavior when extension is not installed (web-only ADO linking) | Enterprise buyers with extension policies blocked. |
| Security, privacy, and compliance artifact set (explicit “no security document”) | PO must decide to add security doc, customer-shared responsibility model, or accept enterprise blockers. |
| Relation edge rules (allowed pairs, multiplicities, required `conforms_to` targets) | Validation either too loose for compliance or too tight for authoring. |
| Outline/mind-map vs tag tree: which is authoritative for ordering | Split UI state and inconsistent exports. |
| Authentication flows: IdP per org vs per deployment; SCIM or manual provisioning | Onboarding cost and RBAC drift. |
| Deletion and retention (project, document, tag, work item) | Legal hold and ADO orphan cleanup undefined. |
| Observability and support: what admins see when sync fails | Operations cannot meet SLAs. |

---

## Cross-cutting gaps (short)

- **Integrations:** Only Azure DevOps is named; “cloud suites” plural has no second client or abstraction test—risk of ADO-specific schema in “generic” API.
- **Validation:** StrictDoc validation timing (on save, on sync, on generate WI) not tied to user-visible errors.
- **Multiplayer / real-time:** Not in design summary; if out of scope, state explicitly to avoid expectation from file-based local editor habits.
- **Licensing and data residency:** Postgres hosting and customer data location unstated for global catalogs containing standards text snippets vs references only.
