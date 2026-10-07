# Business analysis review — requirements product design

Review for backlog grooming. Items below are gaps, ambiguities, or contradictions that prevent writing testable user stories, acceptance criteria, or definition-of-ready checklists. No implementation assumptions.

---

## 1. Undefined or overloaded terms

| Term / phrase | Gap |
|---------------|-----|
| **StrictDoc depth** | No bound on which StrictDoc features are in scope (grammars, custom tags, relation types, export formats, traceability matrices). Grooming cannot slice MVP vs later without a feature inclusion list. |
| **Requirements app (standalone)** | Unclear boundary vs DevOps client, browser extension, and any existing file-based editor. What runs where, who owns which UI, and what is mandatory for a “project” to function. |
| **Project folder** | No definition of folder layout, naming, allowed document types per folder, or how a project is created, archived, or linked to Postgres rows. |
| **Global catalog** | No rule for who publishes catalogs, versioning, immutability after publish, or how projects **reference** vs **pin** a catalog revision. |
| **isCatalog / isStandard** | Flags are named but not defined: mutually exclusive or combinable? Set on document, folder, or node? Effect on edit permissions, import, and work-item generation. |
| **Reference not copy (NIST/STIG)** | No operational definition: live link to catalog UID, snapshot at import time, or read-through proxy. What happens when catalog updates, when a project edits “through” a reference, and how drift is detected. |
| **Tag tree** | “Section parent only” is stated; unclear whether requirements/controls/releases can nest under requirements, whether order is significant, and max depth. |
| **Title on tag** | Ambiguous: title as a field on every tag kind vs title inherited from StrictDoc `TITLE` — required for which kinds, uniqueness scope (project vs global). |
| **Outline mode** | No behavior spec: read-only vs editable, which node kinds appear, relation visibility, filter rules, or parity with full editor. |
| **Product vs app vs shared service vs infrastructure** | Taxonomy is listed without definitions, allowed relations between tiers, or mapping to folders, grammars, or work-item templates. |
| **Capability** | Used when generating work items and in relation text (e.g. release **delivers** capability) but **not** a tag kind. No canonical type: separate document, REQUIREMENT with grammar, external UID namespace, or inferred from relations only. |
| **Control** | **Contradiction / overload:** `control` is a **tag kind** while NIST/STIG content is already modeled as standards whose nodes are inherently “controls.” Unclear when to author a `CONTROL` tag vs a `REQUIREMENT` (or catalog leaf) that **conforms_to** a standard control id. |
| **DevOps (client)** | Unspecified API surface: which operations (read requirements, push work items, sync fields), rate limits, and failure modes. |
| **Extension passes DevOps token** | No threat model or contract: token type (PAT, OAuth), lifetime, storage, refresh, scope, and what the requirements app validates vs trusts from DevOps. |
| **Same identity** | SAML/OIDC in React UI vs DevOps identity: mapping rule (email, subject, tenant id), handling of mismatches, and service accounts. |
| **Two-way work-item fields** | Which fields sync, conflict resolution, source of truth per field, sync trigger (webhook, poll, manual), and idempotency keys. |
| **Work item sections by document then section** | No mapping algorithm when one requirement spans sections, when sections move, or when work items already exist in DevOps. |
| **No security document** | Stated as product choice but undefined impact: are security requirements only in catalogs/platform docs, is conforming_to NIST sufficient for audit narrative, and who signs off without a dedicated security doc type. |
| **Project RBAC — roles unnamed** | Permissions cannot be storied: no role catalog, no matrix (catalog edit, project edit, release ship, work-item push, admin), no default role for new project members. |

---

## 2. Relations that cannot be tested (missing rules)

| Edge | Gap |
|------|-----|
| **refines** | Allowed source/target tag kinds and document types not fixed. Example conflict: requirement refines capability vs capability refines system — both appear in sample data with different roles (`Refines` vs `Satisfies`). Design lists **refines** only; role name alignment with StrictDoc `Parent`/`Child` not specified. |
| **conforms_to** | Target must be catalog UID only, or any node? Multiple targets allowed? Required for every requirement or optional? No validation story for broken or cross-catalog links. |
| **delivers** | Design ties to **release** and capability; grammar samples use `Child` + `Delivers`. Unclear if **delivers** can point at non-capability nodes, multiple targets, or partial delivery per release status (`planned` vs `shipped`). |
| **uses** | Semantics vs **refines** / **conforms_to** not distinguished (dependency, implementation, allocation). Allowed endpoints undefined. |
| **Section parent only** | If only `SECTION` may be composite parent, relations that imply hierarchy (e.g. parent requirement) may be illegal or must be expressed only as edges — not stated. |
| **Catalog reference edges** | Whether `conforms_to` to NIST is stored as relation, as foreign key, or as UID string only affects test cases for delete/update catalog. |

Without a **relation matrix** (source kind × target kind × cardinality × storage shape), QA cannot write pass/fail cases.

---

## 3. Missing acceptance examples (grooming blockers)

Stories need at least one concrete example each; the design provides none for:

1. **Onboard project** — Create project folder, bind identity, connect DevOps; expected initial documents and catalogs visible.
2. **Import / attach NIST catalog** — User adds global catalog; project requirement **conforms_to** `AC-2`; edit attempt on catalog text fails or forks per “reference not copy.”
3. **Author control vs requirement** — Same NIST control id: one path using tag kind `CONTROL`, one using catalog reference only; expected UI and exports (which is canonical).
4. **Release delivers capability** — Create `RELEASE`, link **delivers** to capability UID; generate work items; verify section grouping **document → section**.
5. **Two-way field sync** — Change title in requirements app → DevOps field updates; change assignee in DevOps → requirements app shows update; conflict when both change in one interval.
6. **Extension + token** — User opens DevOps, extension passes token; requirements app session matches without second login; token revoked mid-session behavior.
7. **isStandard project doc** — Mark document `isStandard`; which roles can edit; whether work items include standard controls automatically.
8. **Outline mode** — Open outline on a mixed tree (sections, requirements, releases); expand/collapse; relation badges; no illegal drag-drop if editing allowed.
9. **RBAC deny paths** — Unnamed role “viewer” equivalent: can read catalog, cannot push work items — needs named roles first.
10. **Product vs app allocation** — One product, two apps, one shared service: where each lives in folder tree and how **refines** chains to DevOps area paths.

---

## 4. Contradictory or conflicting rules

| Issue | Description |
|-------|-------------|
| **Control as tag kind vs standard controls** | Tag kinds include **control**; NIST/STIG are standards made of controls. Authors could duplicate control text as tags or only link — design does not mandate one model. Duplication undermines “reference not copy.” |
| **Capability in work items but not in tag tree** | Generators must resolve “capability” without a tag kind — either hidden type, grammar-only `REQUIREMENT`, or document-level convention. Tag tree kinds **section / requirement / control / release** do not cover everything work-item generation needs. |
| **Section-only parenthood vs StrictDoc composites** | StrictDoc uses composite sections broadly; design restricts parenthood to section — any other composite pattern (if grammar allows) is undefined. |
| **Shipped release immutable vs two-way sync** | “Shipped release stays as written” (from release train narrative) may conflict with two-way work-item field updates if work items are tied to release sections. |
| **No security document vs conforming_to NIST** | Compliance workflows often expect a security plan document type; excluding it while requiring NIST conformance leaves no home for scope, inheritance, and common control ownership. |
| **Global catalog vs project RBAC** | Global catalogs imply central maintenance; project RBAC without named roles cannot express catalog curators vs project authors. |
| **DevOps as client vs two-way fields** | Client usually implies DevOps calls requirements API; two-way sync implies requirements app also drives DevOps — master/slave per entity not defined. |

---

## 5. Cross-cutting decisions required before grooming

1. **Canonical model for controls** — Catalog-only controls vs project `CONTROL` tags vs both (with explicit non-duplication rule).
2. **Canonical model for capabilities** — Add tag kind, document type, or reserved UID prefix; align **delivers** and **refines** targets.
3. **Relation catalog** — Normalize edge names to StrictDoc roles/types; publish allowed tuples and cardinality.
4. **Identity and token contract** — Single document for SAML/OIDC claims, DevOps token exchange, and session binding.
5. **Sync contract** — Field list, ownership, conflicts, and linkage keys between requirement UID and work item id.
6. **RBAC role list** — Minimum viable roles and permission matrix tied to catalogs, projects, releases, and DevOps push.
7. **MVP StrictDoc subset** — Explicit in/out list so stories do not imply full StrictDoc parity on day one.

---

## 6. Suggested grooming sequence (dependency order)

1. Entity taxonomy (product, app, shared service, infrastructure, capability, control).
2. Catalog reference semantics and `isCatalog` / `isStandard`.
3. Tag kinds, tree rules, and relation matrix.
4. Identity + DevOps token + API boundaries.
5. Work-item generation and two-way sync (including section mapping).
6. RBAC role names and permission matrix.
7. Outline mode and editor parity scope.

Until items in sections 1–4 are resolved, user stories should remain spikes or “definition ready: blocked.”
