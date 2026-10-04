# Stakeholder review: requirements product design

**Audience:** Buyer and operator (compliance, security leadership, delivery leadership) evaluating adoption of a standalone cloud requirements application aligned with StrictDoc-style depth (not MBSE).

**Scope:** Gaps, blocking decisions, risks, missing outcomes, and claims that cannot be relied on yet. This review does not restate the design as approved fact.

---

## Decisions that block adoption

| # | Gap | Why it blocks |
|---|-----|---------------|
| D1 | **RBAC model is incomplete** — roles are unnamed; only identity, role, and project are named dimensions. | Procurement and security review require a role catalog (viewer, author, approver, admin, auditor, integration service account) mapped to actions on tags, documents, edges, catalogs, and DevOps sync. Cannot sign off on access control or SoD without it. |
| D2 | **Global catalogs are explicitly not behind project RBAC.** | Compliance programs assume catalog content (controls, standards references) is governed: who can publish, deprecate, or attach verification evidence. Unscoped global catalogs with no grant model is a policy exception that must be decided, not an implicit default. |
| D3 | **Bidirectional Azure DevOps work-item field sync with no conflict policy.** | Delivery leadership cannot commit teams to a tool that may overwrite DevOps fields (or be overwritten) without rules for precedence, merge, audit, and rollback. |
| D4 | **DevOps extension passes the user’s DevOps token to the API; API and DevOps identity are asserted to be the same person.** | Enterprise SSO often does not equate IdP subject, app session, and Azure DevOps PAT/OAuth identity. Without a binding proof model and break-glass for mismatches, integration cannot pass security review. |
| D5 | **Extension-owned documents are documented as unused.** | Unclear whether work items, attachments, or wiki content in DevOps participate in requirements traceability. If unused, traceability to delivery artifacts may stop at field sync only — a scope decision buyers must make explicit. |
| D6 | **No security document in the suite document model** while security tags require catalog id and verification on “complete” records. | Security leadership cannot place ownership of control baselines, assessment cycles, and verification workflows in the same governance structure as apps and infrastructure without a defined home or substitute artifact. |
| D7 | **Migration from current sdoc-intake editor to Postgres-backed tables is unmapped.** | Existing StrictDoc folder workflows, validation, and team habits do not have a data model mapping, cutover plan, or coexistence story — blocks migration budgeting and pilot selection. |
| D8 | **Outline mode leaves kind fields empty** while complete tags require kind-specific completeness (including security fields). | Product must decide whether outline rows are first-class placeholders, draft state, or invalid for export/generation. Ambiguity blocks template design and audit-ready baselines. |
| D9 | **NIST/STIG “referenced never copied” vs other catalogs “may be copied as templates.”** | Legal and compliance need rules for derivative works, attribution, update propagation when authoritative catalogs change, and what “reference” means in exports and DevOps work items. |
| D10 | **Product “constrains the suite”** without defined enforcement (validation gates, release blocking, exception workflow). | Buyers cannot tell if this is aspirational metadata or a hard compliance gate for shipping. |

---

## Risks

### Compliance and audit

- **Traceability completeness:** Edges (`refines`, `conforms_to`, `delivers`, `uses`) are named but there is no requirement for acyclic graphs, coverage metrics, or evidence links on `conforms_to` / verification fields beyond “complete tag” shape.
- **Authoritative source of truth:** Postgres + Rust API as sole writer helps integrity, but DevOps bidirectional sync introduces a second mutable surface with no stated single source of truth per field or per work item type.
- **Catalog drift:** Global catalogs without RBAC increase risk of unauthorized or cross-tenant-visible edits if deployment is multi-tenant; design does not state tenancy isolation for catalog rows.
- **Standards-by-reference:** Assessors may expect STIG/NIST control text in-repo; reference-only model must be backed by stable URIs, version pins, and offline/export behavior — none specified.

### Security and identity

- **Token handling:** User DevOps tokens forwarded to the API expand blast radius (token theft, logging, retention). No stated vaulting, rotation, scope minimization, or prohibition on server-side storage.
- **SAML/OIDC for UI only:** Unclear whether machine-to-machine DevOps sync uses the same token model or separate service principals — affects least privilege and audit attribution.
- **Catalog access without project grant:** Anonymous or over-broad read of control libraries may expose export-controlled or licensed content depending on catalog source.

### Delivery and operations

- **Generation grouping** (document → section via tag naming work-item section) is brittle if naming conventions slip; no fallback or validation against DevOps process templates.
- **StrictDoc depth without MBSE:** Teams expecting SysML/ARAS-style parametrics will scope-creep or duplicate model data elsewhere; boundary not operationalized in outcomes.
- **Rust API as only writer:** Good for consistency, but no stated HA, backup/RPO, migration versioning, or read replicas for reporting — operational assumptions missing.

### Product and data model

- **Tag parent must be a section** constrains restructuring (moving requirements between sections) and may complicate bulk import from flat StrictDoc files.
- **`isCatalog` / `isStandard` flags** without lifecycle (draft, approved, retired) or linkage rules risk duplicate “standard” documents in a project tree.
- **Folder tree owned by project** vs **global catalogs** — unclear how project documents import or pin catalog versions at baseline time.

---

## Missing outcomes (what buyers need to see specified)

1. **Adoption outcomes:** Time-to-first-traceability-matrix, DevOps work item coverage %, and definition of “complete” for a release tag.
2. **Compliance outcomes:** Support for common frameworks (e.g. POA&M-style gaps, control inheritance, inherited vs allocated controls) — not inferable from tag kinds alone.
3. **Security outcomes:** Verification workflow (who signs verification, re-verification on change, linkage to test/evidence artifacts).
4. **Delivery outcomes:** What “delivers” edge means in DevOps (feature, epic, release pipeline stage) and whether sync creates vs updates vs links items.
5. **Governance outcomes:** Baseline/approval of document trees; who can change `status` on requirements and controls after baseline.
6. **Operational outcomes:** SLOs, audit log fields (who/when/old value/new value), export formats for assessors (PDF, OSCAL, SAR templates).
7. **Migration outcomes:** Parity checklist vs sdoc-intake (grammar, relations, StrictDoc export round-trip).
8. **Multi-project / portfolio:** Whether catalogs and tags support reuse across projects with explicit version pins.

---

## Claims stakeholders cannot rely on yet

| Claim (as summarized) | Reliance gap |
|------------------------|--------------|
| Azure DevOps is a client, not the database | Bidirectional field sync can make DevOps effectively a co-database for synced fields unless conflict and ownership rules exist. |
| API is the only writer | DevOps users can still edit synced fields in Azure DevOps; “only writer” is not true end-to-end without DevOps-side locks or one-way sync options. |
| Same person for DevOps token and API session | Not guaranteed across PAT renewal, guest users, service accounts, or federated IdP vs Microsoft identity mapping. |
| StrictDoc depth | Unmapped from sdoc-intake; no stated `.sdoc` import/export or StrictDoc CLI compatibility in the cloud product. |
| Security tags with catalog id and verification | No security document, no verification artifact type, no workflow — fields may exist without operational meaning. |
| NIST/STIG referenced, never copied | No mechanism described for assessors to validate mapping without leaving the app; reference stability not defined. |
| Product constrains the suite | No enforcement story; reads as metadata until gates are specified. |
| Tags can name work-item sections for generation | No validation that DevOps area/iteration paths match; silent mis-generation risk. |
| SAML/OIDC | No SCIM/provisioning, group-to-role mapping, or session vs API token policy — enterprise IdP rollout checklist incomplete. |
| Global catalogs | No change control, versioning, or tenant isolation story — cannot rely on catalog integrity in regulated environments. |

---

## Open questions for design closure (minimum set)

1. Define named roles and a permission matrix (including catalogs, global admin, project admin, read-only auditor, integration account).
2. Specify sync conflict resolution (last-write-wins with audit, field-level ownership, or manual reconcile queue) and default for greenfield vs brownfield DevOps projects.
3. Document identity binding between OIDC subject and Azure DevOps user for the extension token pass-through.
4. Place security governance (document type, catalog RBAC, verification lifecycle) or explicitly defer with a documented gap accepted by security leadership.
5. Publish sdoc-intake → relational schema mapping and migration/coexistence strategy.
6. Define “complete” vs outline semantics for export, DevOps generation, and baseline lock.
7. State tenancy model for global catalogs and reference-only NIST/STIG (URLs, versions, caching policy).
8. Clarify extension document strategy (in scope later vs permanently out of scope for traceability).

---

## Review status

**Not ready for adoption commitment** until D1–D3 and identity/sync items have closed decisions with testable acceptance criteria. Pilot may proceed only with written exceptions for catalog RBAC, conflict handling, and migration mapping.
