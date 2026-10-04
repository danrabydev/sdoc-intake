# Developer review: requirements product design (implementation gaps)

Review scope: Postgres schema and API shape described in the product design, plus the stated runtime split (Rust API as sole writer, React/TypeScript with SAML/OIDC, Azure DevOps extension forwarding a user token, two-way work-item sync). This repository today is **sdoc-intake**: StrictDoc `.sdoc` / `.sgra` on disk, folder tree as project layout, relations expressed as StrictDoc `Parent` edges with **roles** (`Refines`, `ConformsTo`, `Delivers`, `Uses`, `Satisfies`), validation in TypeScript, no accounts, no database. **Mapping from that editor onto the proposed tables is not specified in the design**; gaps below assume the design stands as written.

---

## Standalone UI and DevOps credentials

The DevOps extension is described as passing the **user token** into the stack so identity stays aligned. The **standalone** React UI has **no DevOps host session** (no embedded extension context, no automatic AAD/OAuth handoff from Azure DevOps).

Any first slice that lets users **create or update Azure DevOps work items from the standalone UI** therefore needs an explicit **DevOps credential** (PAT, OAuth refresh token, or on-behalf-of exchange from the IdP). The design does **not** name:

- where that credential is stored (browser, server-side vault, per-user encrypted column),
- how it is obtained (user paste, admin-provisioned, OIDC federated credential),
- how it relates to “same identity” (OIDC `sub` vs DevOps `descriptor` vs `uniqueName`),
- rotation, expiry, or revocation,
- or whether the Rust API ever calls DevOps **without** an extension-provided token.

Until this is specified, standalone work-item sync is not implementable; extension-only sync is the implicit default.

---

## Schema holes

### Project layout vs StrictDoc corpus

- **Project folder tree** in the design vs **directory + relative file paths** in sdoc-intake (`TreeResponse.files`, `IndexNode.file`). No column or rule ties a row to a path, basename, or StrictDoc `ROOT` / document `UID`.
- **One `.sdoc` file** can hold many nodes and an embedded `[GRAMMAR]`; the design’s **kinds** (`section`, `requirement`, `control`, `release`) do not say whether grammar lives per project, per file, or in global catalogs only.
- **DOCUMENT**-level metadata in StrictDoc (`TITLE`, `UID`, `VERSION`, `DATE`, `CLASSIFICATION`, `PREFIX`, `ROOT`) has no obvious single home if “tags” are the universal node type.

### Tags, kinds, and hierarchy

- **`tag parent must be section`**: no described mechanism for composite containment vs free-form parent FK (sections are composite in `.sgra`; requirements nest under sections in practice via tree position, not only via relations).
- **`title on tag`**: StrictDoc also uses `STATEMENT` as primary body; requirements often leave `TITLE` empty and derive display text from statement (see index logic in the current editor). Unclear which column is authoritative for search, work-item title sync, and exports.
- **`isCatalog` / `isStandard`**: no rules for promoting a project node into a global catalog, deduplicating NIST/STIG identifiers across tenants, or preventing mutable catalog rows from breaking `ConformsTo` targets in customer projects.
- **Control** kind vs catalog files under `data/catalog/` and control sections in `data/10-controls/`: no mapping from CONTROL tag / STIG id to catalog membership.

### Edges vs StrictDoc relations

Design edges: `refines`, `conforms_to`, `delivers`, `uses`.

Current corpus also uses **`Satisfies`** and structural **`Parent` / `Child` / `File`** without roles. Missing design decisions:

| StrictDoc pattern | Design edge |
|-------------------|-------------|
| `Parent` + role `Refines` | `refines` (direction?) |
| `Parent` + role `ConformsTo` | `conforms_to` |
| `Child` + role `Delivers` (releases) | `delivers` |
| `Parent` + role `Uses` | `uses` |
| `Parent` + role `Satisfies` | **unspecified** |
| `Parent` / `Child` (no role) | **unspecified** (tree vs edge) |
| `File` | **unspecified** (cross-doc inclusion) |

- Edge table likely needs **from/to node ids**, **type**, optional **role**, and **provenance** (manual vs import vs sync). Not described.
- **Multiplicity**: one requirement may `Refines` one capability and `ConformsTo` many catalog controls; uniqueness constraints not defined.

### Metadata tables “may be empty”

- No lifecycle: which kinds **require** which metadata rows before publish/sync.
- No versioning: shipped releases in the current model stay immutable; new change = new release. DB design does not describe **immutable release snapshots** vs editable drafts.

### Work-item sync (data model)

Two-way sync is a product goal but the schema does not define:

- link table (requirement/tag id ↔ DevOps work item id, project/organization URL),
- sync direction flags per field,
- last synced revision / content hash,
- deleted-on-one-side tombstones,
- item type mapping (User Story vs Task vs custom process).

### RBAC

“Project RBAC” is named without:

- role catalog (viewer, editor, admin, catalog curator?),
- binding to IdP groups vs local assignments,
- scope (project vs global catalog vs org),
- whether the Rust API enforces RBAC on every mutation or only the UI does,
- service account for background sync jobs (bypasses user token?).

### Global catalogs

- How catalog **projects** relate to tenant **projects** (copy-on-import vs live reference).
- Whether `isStandard` rows are **read-only** for non-platform admins.
- STIG/NIST **UID stability** when catalog updates ship.

---

## Identity mapping

- **SAML/OIDC** subjects must map to an internal `user_id` used in RBAC and audit. Design does not specify claim choice (`sub`, `email`, `oid`, `preferred_username`) or merge rules when IdP changes issuers.
- **“Same identity”** between IdP and DevOps: Azure DevOps identities are not OIDC `sub` strings. Need a stored **DevOps identity descriptor** or consistent email match; email match fails for guests, service accounts, and renamed users.
- **Extension “passes user token”**: ambiguous token type (AAD access token for DevOps resource, MSAL session, OAuth for Azure DevOps Services). Rust API must validate audience/scope; design silent on validation and on **token caching** per user.
- **Extension documentation unused**: no contract for message shape, origin, or token lifetime between extension host and web app—teams will invent a `postMessage` or query-param bridge without security review unless specified.

---

## Auth handoff

- **React** SAML/OIDC: session cookie vs SPA bearer token; CSRF; refresh; logout and IdP SLO—not specified.
- **Rust API only writer**: browser must not write Postgres directly (good), but design does not state whether React calls Rust for **reads** as well or uses RLS/read replicas.
- **Handoff extension → web**: if the web app opens standalone in a new tab, how does the OIDC session and DevOps token arrive? Separate logins break “same identity” unless explicitly linked.
- **Machine-to-machine**: sync workers need credentials distinct from interactive users; not in RBAC section.

---

## Sync conflicts

- **Dual writers**: user edits requirement in UI while DevOps work item title/description/state changes (or another user edits). No strategy: LWW, field-level merge, operational transform, or “sync paused until resolved.”
- **Source of truth**: Postgres vs exported `.sdoc` vs DevOps. Current editor treats **files** as truth with validate-before-write; moving to DB requires import/export story or abandoning file workflow.
- **Relation integrity during sync**: changing a work item must not create orphan edges if requirement UID changes.
- **Release immutability**: product data model says shipped releases stay written; sync must not rewrite historical release nodes or edges.
- **Catalog updates**: global catalog change may invalidate `conforms_to` targets in customer projects; no propagation or “broken link” workflow described.
- **Idempotency**: DevOps webhooks and UI saves retry; API needs idempotency keys—not mentioned.

---

## Constraints the database cannot enforce (need app/API layer)

- **Tag parent is section**: must enforce kind/composite rules and tree shape (including depth limits if any).
- **Grammar / field validation**: StrictDoc choice fields, required fields, and relation roles come from `.sgra`; Postgres CHECK constraints cannot replicate grammar without duplicating grammar in SQL.
- **Cross-project edge targets**: `conforms_to` may point at global catalog nodes; FK to same `project_id` would be wrong.
- **UID uniqueness**: currently **project-wide** across files (`siblingUids` on write); design must say global per project vs per file vs globally unique for catalog UIDs.
- **Acyclic refinement chains** (if required): not a simple FK constraint.
- **DevOps permissions**: user may be authorized in app RBAC but lack DevOps write; DB cannot know.
- **Immutability of shipped releases**: requires triggers or application guards, not passive schema.

---

## First slice: what a team must invent (unspecified in design)

1. **Import pipeline**: scan folder tree → projects/files → tags + edges + metadata; preserve file paths for round-trip export.
2. **UID and file allocation**: creating a requirement in UI must decide target `.sdoc` path or abandon files entirely for v1.
3. **Grammar strategy**: embed grammar in DB, reference global `.sgra`, or hard-code kinds for v1—design lists kinds but not grammar storage.
4. **API surface**: CRUD for tags/edges/metadata, batch validate, index/search, graph queries (current editor exposes index + graph APIs locally).
5. **Validation parity**: port or call existing StrictDoc validation rules so behavior matches sdoc-intake validate-before-write semantics.
6. **DevOps integration module**: REST client, field mapping config, webhook subscription, rate limits, 401 handling when token dies.
7. **Standalone credential UX**: PAT entry, OAuth device flow, or “sync disabled outside extension” product flag.
8. **Conflict UI** and **audit log** (who changed requirement vs work item).
9. **Migration/versioning** for schema and for catalog semver (NIST rev5 vs rev6).
10. **Observability**: sync job metrics, dead-letter queue for failed DevOps updates.
11. **Extension MVP** despite “extension documents unused”: minimal manifest + secure token injection or defer all DevOps writes to server-stored PAT (weakens “user token” story).

---

## Mapping sdoc-intake onto proposed tables (explicitly open)

| Current concept | Design element | Gap |
|-----------------|----------------|-----|
| Directory under `SDOC_ROOT` | Project folder tree | No path ↔ project/file entity |
| `.sdoc` file + embedded grammar | Tags + kinds | Grammar ownership undefined |
| Tree nesting of nodes | Section parent rule | Tree vs `parent_id` vs Child relations |
| `IndexNode.parent` (section UID) | Tag parent FK | Derived today from walk, not stored relation |
| Relation roles on `Parent`/`Child` | Typed edges | Satisfies, bare Parent/Child, File unmapped |
| `strictdoc_config.py` aliases | Global catalogs | Alias registry not in design |
| Validate on write, no partial save | API transactions | Error model per field vs document |
| Browser/local server modes | Hosted React + Rust | No offline or “files only” mode |
| P2P multiplayer (optional lib) | — | Out of scope or conflict with single writer |

---

## Summary for implementers

The design outlines **entities and flags** but leaves **identity-to-DevOps binding**, **standalone DevOps credentials**, **sync state and conflict policy**, **StrictDoc ↔ relational mapping**, and **grammar/catalog lifecycle** undefined. The Rust-only-writer rule is clear; everything that touches Azure DevOps from **outside** the extension needs a named credential and validation path. Until import/export or a frozen kind-specific grammar is chosen, the existing StrictDoc editor cannot be treated as a specification for the Postgres model—teams will fill gaps ad hoc in the first slice unless the design is extended.
