# Requirements product

Design locked in conversation on 2026-10-03. This is the product shape, not an implementation plan.

Repo today: danrabydev/sdoc-intake, a local StrictDoc editor (TypeScript, files on disk, no accounts, no database). This design is the next product. It is not a description of the current app.

## Product

A standalone requirements app for cloud application suites, not embedded or safety-case MBSE. StrictDoc is the depth bar: documents, sections, requirements, relations, catalogs, trace. No SysML, behavior models, or simulation.

Azure DevOps is a client. It is not the database.

## Runtime

- Postgres holds the data.
- A Rust API is the only writer.
- Standalone UI is React/TypeScript. Sign-in is SAML or OIDC.
- The DevOps extension UI is already signed into DevOps. It calls the DevOps REST API as that user, and it passes that DevOps token to the Rust API.
- A DevOps token and a SAML/OIDC token resolve to the same person.
- The Rust API reads and updates work-item fields both ways, using the caller's DevOps token when the call came from the extension.
- Extension Data Service documents are unused.
- If DevOps were the database, the API and UI would have to be DevOps too. That path is not the plan.

## Information model

A project contains a folder tree. Folders hold documents. Catalog documents are global: they are not in a project, and project roles do not own them.

A document has isCatalog and isStandard. A standard is a catalog (NIST, STIG). Its tags are referenced, never copied. A catalog that is not a standard may be copied into a document as an editable starting point.

A document is a tree of tags.

- A tag has id, document, parent, kind, and title.
- Parent must be a section, or null at the top.
- A section's children may be a section, requirement, control, or release.
- Kind-specific fields live in a metadata table for that kind, and may be empty.
- Outline mode, including a mind-map view, creates the tree with titles only. Statement and the rest are filled later.
- Required fields when a tag is complete: id, statement, parent or top, status. A security item also needs a catalog id and a verification note.

Traces are an edge table, not the document tree.

- refines: a more specific requirement of a higher one. Application requirements refine product requirements.
- conforms_to: a requirement references a standard tag. Not a copy.
- delivers: a release points at the requirements it ships.
- uses: an application requirement uses a shared service. It does not refine that service.

Product requirements are the suite constraints. Each application has its own document. Shared services (identity, session, messaging, payments) are their own documents. Infrastructure is DevOps and runtime, not something applications refine into. There is no separate security document. Standards are referenced from the requirement.

A tag may name the work-item section it should appear in. Generating a feature or user story from a capability groups lines by document name, then section. Example: NIST items under Acceptance criteria, infrastructure items under Implementation plan, product items under Description.

## Access

RBAC is scoped to a project. A grant is identity, role, and project. Catalogs are global and are not behind that grant.

## Worked example

Project PRJ-1 Clinic suite.

- Product / Suite: PRD-1 every app authenticates, PRD-2 every app expires sessions, PRD-3 a clinician sees only their charts.
- Applications / Portal: APP-PORT-1 user can sign in, APP-PORT-2 session expires. Records: APP-REC-1 read a patient chart. Billing: APP-BILL-1 take a payment.
- Shared services / Identity: SHR-ID-1 authenticate a user, SHR-ID-2 session store. Messaging: SHR-MSG-1 send a one-time code. Payments: SHR-PAY-1 charge a card.
- Infrastructure / Runtime: INF-1 token issuer, INF-2 chart database.
- Release 2026.10 delivers APP-PORT-1 and APP-PORT-2.
- APP-PORT-1 refines PRD-1, uses SHR-ID-1, conforms_to NIST IA-2 and STIG SRG-APP-000148.
- APP-PORT-2 refines PRD-2, uses SHR-ID-2, conforms_to NIST AC-12.
- APP-REC-1 refines PRD-3, uses INF-2, conforms_to NIST AC-3.
- APP-BILL-1 uses SHR-PAY-1, conforms_to NIST SC-8.
- SHR-ID-1 uses SHR-MSG-1.
- NIST and STIG are global standard documents. They are not in the project folders.

## Explicitly out

- Extension documents as a store.
- DevOps as the system of record.
- MBSE structure, behavior, or simulation.
- A copied security document that restates the standards.
- New bots or team agents.

## Open on purpose

Roles are unnamed. Work-item section names are examples, not a fixed list. Verification is a note, not a test-management model. Sync conflict behavior is not specified. The current sdoc-intake file editor is not mapped onto these tables.
