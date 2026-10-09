# ReqALM seed YAML shape

Mirrors the relational ERD at `../c4/data-erd.puml` (workflow encode 2026-10-07; base locked 2026-10-06). Root document is one client’s dogfood bundle for project **ReqALM**.

## Top-level keys

| Key | Type | Notes |
|-----|------|--------|
| `schema_version` | string | Seed format version, e.g. `2026-10-06` |
| `client` | object | Single client |
| `projects` | array | Projects under the client |
| `identities` | array | People / service principals |
| `project_grants` | array | identity ↔ project role |
| `catalogs` | array | global \| client \| project scope |
| `catalog_imprints` | array | published library revisions for standard catalogs |
| `iterations` | array | optional sprint-like windows |
| `requirement_lines` | array | tree nodes (stable identity) |
| `requirement_versions` | array | mutable content + status |
| `capability_artifacts` | array | optional OpenAPI/wireframe/mock URIs |
| `edges` | array | version→version traces |
| `contracts` | array | overlays; not tree parents |
| `releases` | array | delivery snapshots; not tree parents |
| `clients` | array (optional) | Extra clients beyond primary `client` (cross-client fixtures) |
| `catalog_steward_grants` | array (optional) | identity ↔ catalog stewardship |
| `audit_events` | array (optional) | Sample allow/deny audit rows (Cyber+QA); may reference `change_set_id` |
| `change_sets` | array (optional) | Project-scoped leaf / SDLC-parent change sets (hybrid audit) |
| `work_item_links` | array (optional) | External tracker mappings (`requirement_version` ↔ devops id) |
| `subject_kinds` | array (optional) | Workflow SubjectKind registry (app + seed; not StrictDoc) |
| `workflow_profiles` | array (optional) | Named WorkflowProfile bundles (gates, hooks, planning actions) |
| `gates` | array (optional) | Named Gate preconditions (catalog referenced by profiles) |
| `action_hooks` | array (optional) | ActionHook rows: action_id → gates_before / effects_after |
| `role_bindings` | array (optional) | Fills Gate approver_slots from project/client config |
| `approval_records` | array (optional) | Line-grain approval SoT (RequirementLine / CapabilityLine) |
| `platform_grants` | array (optional) | Deployment-scoped role grants outside client/project tenancy (`id`, `identity_id`, `role` e.g. `Key custodian`, `scope: deployment`, `notes`) — ARCH-KEY-CUSTODIAN |

---

## client

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | Stable slug or UUID |
| `name` | string | yes | Display name |
| `created_at` | string (ISO-8601) | no | |

## project

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `client_id` | string | yes | → client.id |
| `name` | string | yes | Display name (**ReqALM**) |
| `status` | string | no | e.g. `active` |
| `notes` | string | no | e.g. intake repo alias |
| `workflow_profile_id` | string | no | → `workflow_profiles[].id` (ARCH-WORKFLOW) |

## identity

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `external_sub` | string | no | IdP subject |
| `email` | string | no | |
| `display_name` | string | no | |

## project_grant

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | no | |
| `project_id` | string | yes | → project.id |
| `identity_id` | string | yes | → identity.id |
| `role` | string | yes | e.g. `Author`, `Project admin`, `Auditor`, `Reader` |
| `status` | string | no | `active` (default) or `revoked` (tombstone) |
| `revoked_at` | string | no | ISO-8601 when status=revoked |
| `notes` | string | no | |

## catalog

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `scope` | enum | yes | `global` \| `client` \| `project` |
| `client_id` | string | if client/project | |
| `project_id` | string | if project | |
| `title` | string | yes | |
| `is_standard` | bool | no | default false; standards always require imprint publish |
| `entries` | array | no | lightweight `{id, title}` for **project** catalogs (`REQALM-SEC-*`); standards use `.sdoc` via imprint |
| `sdoc_path` | string | no | pointer to authoritative catalog `.sdoc` (NIST/STIG) |
| `current_imprint_id` | string | no | → `catalog_imprints[].id` for the active published imprint |
| `notes` | string | no | |

## catalog_imprint

Versioned publish of a **standard** catalog library. Do **not** rewrite published catalog item rows in place — a new import creates a new imprint.

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | e.g. `nist-800-53@rev5-dogfood-20261006`, `asd-stig@v6r4` |
| `catalog_id` | string | yes | → catalog.id |
| `library_revision` | string | yes | e.g. `rev5`, `v6r4` |
| `import_identity` | string | yes | distinguishes imports of the same library revision |
| `sdoc_path` | string | yes | authoritative `.sdoc` for this imprint |
| `published_at` | string (ISO-8601) | no | |
| `status` | enum | no | `published` \| `draft` \| `superseded` |
| `notes` | string | no | |

Item UIDs (`AC-3`, `V-222536`) are **stable within an imprint**. ConformsTo pins target `(imprint_id, item_uid)`.

## requirement_line

Stable tree identity. **Parent is always another line’s `base_uid` (or null), never a version.**

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `base_uid` | string | yes | e.g. `A01`, `SEC-IA`, `CAP-SSO` |
| `project_id` | string | yes | |
| `parent` | string \| null | yes | Parent **line** `base_uid`, or null for roots |
| `kind` | enum | yes | `section` \| `requirement` \| `control` \| `capability` \| `release_node` |
| `title` | string | yes | Human title for the line |

### Rules

- Children stay on the parent **line** (`parent = base_uid`). No cascade fork when a parent gets a new version.
- Creating an edit = new `requirement_version` successor `.N`; do not mutate the prior version’s statement in place for published history.

## requirement_version

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `uid` | string | yes | `base_uid` or `base_uid.N` |
| `base_uid` | string | yes | → requirement_line.base_uid |
| `version_n` | int | yes | `0` for first; then `1`, `2`, … |
| `statement` | string | yes | 1–3 sentences typical |
| `status` | enum | yes | `draft` \| `active` \| `superseded` \| `obsolete` \| `withdrawn` |
| `priority` | int \| null | no | |
| `iteration` | string \| null | no | → iteration id/name |
| `rbac_op` | string \| null | no | e.g. `auth:signin` |
| `security` | object \| null | no | see below |
| `catalog_drift` | object \| null | no | see below — set after imprint import diff |
| `title` | string \| null | no | Override; else line title |
| `grooming_state` | enum \| null | no | `want` \| `detailed` \| `wi_ready` (K03 / J01) |
| `stakeholder_approval` | object \| null | no | see below — separate from lifecycle `status` |
| `verification_outcome` | enum \| null | no | `pass` \| `fail` \| `pending` (first-class; ship via profile Gate — ARCH-VERIFICATION-GATE) |
| `statement_hash` | string \| null | no | Canonical **statement body only** hash (trim/newline canon); mint/clear/approval pin (ARCH-SUCCESSION-HASH / ARCH-MINT-KIND) |
| `mint_kind` | enum \| null | no | `content` \| `status` \| `pin` \| `security_meta` — drives noop gate + approval clear |
| `planning_blocked` | bool \| null | no | Set on content `.N` clear until re-approve (FIX-PLANNING-BLOCKED-AFTER-CONTENT-N) |

### security (on version)

| Field | Type | Notes |
|-------|------|--------|
| `catalog_ref` | string | catalog entry id or NIST/STIG item UID (browse mirror; pin is on the edge) |
| `verification_note` | string | tester / STIG note |

### catalog_drift (on version)

First-class flag for review UI after a new imprint import (no auto-retarget of live pins). Same `change_class` values drive the mandatory migrate-to-imprint preview (H10 / ARCH-CAT-MIGRATE).

| Field | Type | Notes |
|-------|------|--------|
| `status` | enum | `none` \| `flagged` \| `reviewed` |
| `change_class` | enum | `editorial` \| `normative` \| `withdrawn` \| `renumbered` |
| `imprint_from` | string | prior pin imprint id |
| `imprint_to` | string | newly imported imprint id (optional) |
| `item_uid` | string | stable item UID within imprint (`AC-3`, …) |
| `notes` | string | review queue hint |

### stakeholder_approval (on version) — denormalized mirror

Separate from lifecycle `status` (`draft`/`active`/`obsolete`/`withdrawn`). **Activate (D04) ≠ approve (D12/D13).**

**Source of truth** is `approval_records[]` on the **line** (ARCH-APPROVAL-LINE). `requirement_version.stakeholder_approval` may **dual-write** as a query mirror during migrate; clearing rules and gate evaluation always use the line `ApprovalRecord` + `approved_statement_hash`.

| Field | Type | Notes |
|-------|------|--------|
| `status` | enum | `unapproved` \| `approved` |
| `by` | string \| null | → identity.id (approver) |
| `at` | string \| null | ISO-8601 |
| `notes` | string | e.g. mirror of ApprovalRecord id |

**Approver roles** come from `role_bindings` on the project's `WorkflowProfile` (not hard-coded Client admin vs AO).


### grooming_state (on version)

| Value | Notes |
|-------|--------|
| `want` | Prioritized or candidate; not yet detailed |
| `detailed` | Statement groomed; not WI-ready |
| `wi_ready` | Ready for work-item create (J01 / K03 terminal) |

### verification_outcome (on version)

First-class pass/fail/pending alongside `security.verification_note` (D10 / ARCH-VERIFICATION). Whether it blocks G05 ship is determined by WorkflowProfile Gate `gate-verification-ship` (ARCH-VERIFICATION-GATE) — configurable, not permanently soft.

### Derived “locked” (migrate) — no first-class flag

A requirement version is **locked** for catalog migrate when:

`status ≠ draft` **AND** (`uid` ∈ any `contract.in_scope_of` **OR** `uid` ∈ any `release.delivers`).

Locked → migrate only via successor `.N` (ARCH-CAT-MIGRATE / H10 / ARCH-LOCKED). Draft/unlocked may retarget in place after preview accept.

### UID rules

| Form | Meaning |
|------|---------|
| `SYS-001` or `A01` | First published / `.0` content (`version_n: 0`); uid may omit `.0` |
| `SYS-001.1` | Successor (`version_n: 1`) |
| `SYS-001.2` | Next successor (`version_n: 2`) |

Prior active on tip activate → **in-place `superseded`** (same txn; ≤1 active). Terminal obsolete/withdraw without replacement = in-place status or status-only `.N` (mint_kind=status). Content edits still require a successor `.N`.

## edge

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `from` | string | yes | from version UID |
| `to` | string | yes | to version UID **or** catalog item UID (`AC-3`, `V-222536`) when `kind=conforms_to` |
| `kind` | enum | yes | `refines` \| `conforms_to` \| `uses` \| `satisfies` |
| `catalog_imprint_id` | string | if `conforms_to` → catalog item | → `catalog_imprints[].id`; pin is `(catalog_imprint_id, to)` |
| `trace_suspect` | bool \| null | no | Set when target line content-minted `.N` and edge still points at prior UID (ARCH-SUSPECT) |
| `inheritable` | bool \| null | no | Capability `conforms_to` only: control may inherit one hop over capability→capability `uses` (ARCH-TRACE-INHERIT-USES) |
| `suspect_reason` | string \| null | no | Review-queue hint |

Typical: capability → requirement via `satisfies`; product version → catalog item via `conforms_to` **through an imprint** (not a floating global UID alone).

## contract

Junction overlay — **not** a tree parent.

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `client_id` | string | yes | |
| `project_id` | string \| null | no | |
| `name` | string | yes | |
| `starts_on` | date | no | |
| `ends_on` | date \| null | no | |
| `status` | enum | yes | `planned` \| `active` \| `closed` |
| `in_scope_of` | string[] | yes | requirement **version** UIDs |

## release

Snapshot junction — **not** a tree parent.

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `project_id` | string | yes | |
| `name` | string | yes | |
| `planned_on` | date \| null | no | |
| `shipped_on` | date \| null | no | |
| `status` | enum | yes | `planned` \| `shipped` |
| `delivers` | string[] | yes | requirement **version** UIDs |
| `cyber_gate` | bool | no | when true AND profile enables `gate-cyber-ship`, G05 needs Security+AO slots (ARCH-CYBER-GATE / ARCH-GATE-MODEL) |
| `notes` | string | no | |

## capability_artifact

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `requirement_version_uid` | string | yes | |
| `kind` | enum | yes | `openapi` \| `wireframe` \| `mock` \| `other` |
| `uri` | string | yes | |

## iteration

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `project_id` | string | yes | |
| `name` | string | yes | |
| `starts_on` | date | no | |
| `ends_on` | date | no | |

## change_set

Project-scoped hybrid audit container. Leaf = user save / mutation batch; optional SDLC parent nests leaves.

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `project_id` | string | yes | → project.id |
| `kind` | enum | yes | `leaf` \| `sdlc_parent` |
| `parent_id` | string \| null | no | → change_set.id when nested under SDLC parent |
| `scope` | string | no | default `project`; any hierarchy scope allowed for SDLC parent |
| `status` | enum | yes | `open` \| `closed` \| `reverted` \| `abandoned` |
| `opened_by` | string | yes | → identity.id |
| `opened_at` | string | yes | ISO-8601 |
| `closed_at` | string \| null | no | |
| `summary` | string | no | |
| `notes` | string | no | |

**Retention:** retain forever (ARCH-CHANGESET-RETAIN). Stack revert: only latest non-abandoned set (ARCH-CHANGESET-CONFLICT / M07); non-latest deny FIX-DENY-REVERT-NON-LATEST; older whole sets only via abandon-suffix; field-level history undo = WANT-CHANGESET-FIELD-UNDO.

**RBAC (prefer `roles/permission-tree.html` over flat matrix):** SDLC parent open/close = Author / Security (security sessions) / Project admin / Client admin (client scope). Leaf open = broader (includes Developer, Tester, Release manager, Catalog steward). Developer is **leaf-only** (no SDLC parent, no revert). Revert/re-apply = Author (own+rights) / Security / admins.

## work_item_link

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `requirement_version_uid` | string | yes | → requirement_version.uid |
| `devops_id` | string | yes | external id |
| `system` | string | no | e.g. `azure_devops` |
| `synced_fields` | object | no | which fields sync |
| `last_sync_at` | string | no | ISO-8601 |
| `status` | string | no | e.g. `linked` |
| `notes` | string | no | |

## audit_event (extension)

Optional `change_set_id` → `change_sets[].id` nests the event under a change set.

---


## subject_kind

Registry entry (seed + app). Not StrictDoc.

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | e.g. `RequirementLine`, `CapabilityLine`, `EdgeSatisfies` |
| `backing` | string | yes | entity table/collection name |
| `kind_filter` | string[] | no | e.g. line kinds or edge kinds |
| `notes` | string | no | |

## workflow_profile

Named configuration bundle. Attached to a **Project** (`project.workflow_profile_id`); optional Client default.

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | e.g. `wf-commercial-default` |
| `scope` | enum | yes | `client` \| `project` |
| `client_id` | string | if scoped | |
| `project_id` | string \| null | if project | |
| `title` | string | yes | |
| `gate_ids` | string[] | yes | active gate catalog ids |
| `enabled_optional_gates` | string[] | no | optional gates turned on |
| `disabled_optional_gates` | string[] | no | optional gates turned off |
| `planning_gate_actions` | string[] | no | which planning action_ids require `gate-line-approved` (ARCH-PLANNING-GATES) |
| `action_hook_ids` | string[] | no | hooks in this profile |
| `notes` | string | no | |

## gate

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | e.g. `gate-line-approved`, `gate-cyber-ship` |
| `subject_kinds` | string[] | yes | SubjectKind ids |
| `mode` | enum | yes | `required` \| `optional` |
| `predicate` | string | yes | closed vocabulary expression |
| `approver_slots` | string[] | no | filled by RoleBinding |
| `on_fail` | enum | yes | `deny` (v1) |
| `deny_fixture` | string | no | FIX-DENY-* uid |
| `notes` | string | no | |

## action_hook

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `action_id` | string | yes | stable rbac_op / user-actions id |
| `subject_kind` | string | yes | |
| `gates_before` | string[] | yes | ordered gate ids |
| `effects_after` | string[] | yes | e.g. `write_approval_record`, `clear_line_approval`, `audit` |
| `notes` | string | no | |

## role_binding

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `profile_id` | string | yes | → workflow_profile.id |
| `gate_id` | string | yes | |
| `slot` | string | yes | e.g. `stakeholder`, `solution_approver`, `ao_approve` |
| `roles` | string[] | yes | project/client role names — **configurable** |
| `identities` | string[] | no | optional named people override |
| `notes` | string | no | |

## approval_record

Line-grain approval **source of truth** (ARCH-APPROVAL-LINE).

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `subject_kind` | enum | yes | `RequirementLine` \| `CapabilityLine` |
| `base_uid` | string | yes | → requirement_line.base_uid |
| `status` | enum | yes | `unapproved` \| `approved` \| `imported_approved` (bootstrap/grandfather) |
| `by` | string \| null | no | → identity.id |
| `at` | string \| null | no | ISO-8601 |
| `notes` | string | no | |
| `approved_version_uid` | string \| null | no | version content signed |
| `approved_statement_hash` | string \| null | no | hash at approve time |

**UI:** Approve = selected line + direct children; Approve Tree = full descendants (UI-APPROVE-LINE / UI-APPROVE-TREE). Content / pin `.N` clears the line record (+ planning_blocked on content); status/security_meta do not. Same-hash **content** mint denied (ARCH-SUCCESSION-HASH / ARCH-MINT-KIND).


## Design invariants (encode in reviews)

1. **Line vs version** — tree structure = lines; content/status = versions.
2. **No cascade fork** — parent pointer is `base_uid`, not a version UID.
3. **Contracts / releases are junctions** — they reference version UIDs; they do not own the tree.
4. **StrictDoc** — interchange only; this YAML is the dogfood source of truth for bootstrap.
5. **Catalog imprints** — standard catalogs version as imprints; no in-place rewrite of published item rows.
6. **ConformsTo pin** — `(catalog_imprint_id, item_uid)`; new imprint import does **not** auto-retarget live pins; mark `catalog_drift` for review (successor / grandfather / withdraw).
7. **Migrate to imprint (H10 / ARCH-CAT-MIGRATE)** — at any hierarchy scope (version / section / document / project / client), always preview UID/item diff (`editorial|normative|withdrawn|renumbered`) before apply; locked/frozen pins migrate only via successor `.N` ConformsTo the new imprint; draft/unlocked may retarget in place after accept; Steward/Security gate + audit.
8. **Northline** — control text lives in catalog `.sdoc`; product does not copy statements.
9. **Approval ≠ activate** — line `ApprovalRecord` is SoT (version mirror optional); D08 and other profile-gated planning actions require line approved; approver = RoleBinding.
10. **Change sets** — mutating audit nests under project-scoped `change_set` (leaf and optional SDLC parent).
11. **Locked is derived** — non-draft ∧ (in_scope ∨ delivers); no first-class lock flag in v1.
12. **Gates under WorkflowProfile** — cyber ship, verification→ship, line-approved→planning, noop-successor-block, satisfies-at-create compose as Gates; `release.cyber_gate` triggers `gate-cyber-ship` when enabled (not full ATO).
13. **Approval grain = line** — `ApprovalRecord` + version/hash pin; tree UI batches.
14. **No orphan caps** — CapabilityLine create requires Satisfies in the same mutation; CapabilityLine approval accepts solution (Satisfies edge not separately approved by default).
15. **Workflow composition** — profile / gate / hook / binding / thin transition; StrictDoc unchanged.


## gate_signoff

Sign-off record for Gates that need slot decisions beyond line ApprovalRecord (cyber ship, locked migrate).

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `subject_kind` | string | yes | e.g. `Release` |
| `subject_id` | string | yes | |
| `gate_id` | string | yes | e.g. `gate-cyber-ship` |
| `slot` | string | yes | e.g. `security_signoff`, `ao_approve` |
| `identity_id` | string | yes | → identity |
| `decision` | enum | yes | `approve` \| `deny` |
| `at` | string | yes | ISO-8601 |
| `note` | string | no | |

## conformance_pin_request

Author **request** for a ConformsTo pin; Security/Steward (profile `conforms_to_applicator`) **apply** or **deny**.

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `project_id` | string | yes | |
| `requirement_version_uid` | string | yes | |
| `catalog_imprint_id` | string | yes | |
| `item_uid` | string | yes | e.g. `AC-3` |
| `requested_by` | string | yes | → identity |
| `requested_at` | string | yes | |
| `status` | enum | yes | `pending` \| `applied` \| `denied` |
| `notes` | string | no | |

Ops: `catalog:pin:request` \| `catalog:pin:apply` \| `catalog:pin:deny`.

## Mint kinds (ARCH-MINT-KIND)

| Kind | No-op gate | Clears ApprovalRecord | Suspects inbound traces |
|------|------------|----------------------|-------------------------|
| `content` | yes (same hash deny) | yes (+ `planning_blocked`) | yes |
| `pin` | no | yes (+ locked migrate `gate_signoff` then re-approve) | no (pin updates in place) |
| `status` | no | no (audit only) | no |
| `security_meta` | no | no (audit only) | no |

After content clear: retain priority/grooming/iteration values; deny D08 mutate while `planning_blocked`; do **not** auto-drop contract/release membership — mark **suspect**.
