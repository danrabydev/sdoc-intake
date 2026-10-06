# ReqAML seed YAML shape

Mirrors the relational ERD at `../c4/data-erd.puml` (locked 2026-10-06). Root document is one client’s dogfood bundle for project **ReqAML**.

## Top-level keys

| Key | Type | Notes |
|-----|------|--------|
| `schema_version` | string | Seed format version, e.g. `2026-10-06` |
| `client` | object | Single client |
| `projects` | array | Projects under the client |
| `identities` | array | People / service principals |
| `project_grants` | array | identity ↔ project role |
| `catalogs` | array | global \| client \| project scope |
| `iterations` | array | optional sprint-like windows |
| `requirement_lines` | array | tree nodes (stable identity) |
| `requirement_versions` | array | mutable content + status |
| `capability_artifacts` | array | optional OpenAPI/wireframe/mock URIs |
| `edges` | array | version→version traces |
| `contracts` | array | overlays; not tree parents |
| `releases` | array | delivery snapshots; not tree parents |

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
| `name` | string | yes | Display name (**ReqAML**) |
| `status` | string | no | e.g. `active` |
| `notes` | string | no | e.g. intake repo alias |

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
| `role` | string | yes | e.g. `Author`, `Project admin` |

## catalog

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `id` | string | yes | |
| `scope` | enum | yes | `global` \| `client` \| `project` |
| `client_id` | string | if client/project | |
| `project_id` | string | if project | |
| `title` | string | yes | |
| `is_standard` | bool | no | default false |
| `entries` | array | no | lightweight `{id, title}` for seed refs |

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
| `status` | enum | yes | `draft` \| `active` \| `obsolete` \| `withdrawn` |
| `priority` | int \| null | no | |
| `iteration` | string \| null | no | → iteration id/name |
| `rbac_op` | string \| null | no | e.g. `auth:signin` |
| `security` | object \| null | no | see below |
| `title` | string \| null | no | Override; else line title |

### security (on version)

| Field | Type | Notes |
|-------|------|--------|
| `catalog_ref` | string | catalog entry id or NIST family tag |
| `verification_note` | string | tester / STIG note |

### UID rules

| Form | Meaning |
|------|---------|
| `SYS-001` or `A01` | First published / `.0` content (`version_n: 0`); uid may omit `.0` |
| `SYS-001.1` | Successor (`version_n: 1`) |
| `SYS-001.2` | Next successor (`version_n: 2`) |

Obsolete / withdrawn = **new** version with that `status`, not an in-place overwrite of the active row.

## edge

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `from` | string | yes | from version UID |
| `to` | string | yes | to version UID |
| `kind` | enum | yes | `refines` \| `conforms_to` \| `uses` \| `satisfies` |

Typical: capability → requirement via `satisfies`; control → catalog-backed req via `conforms_to`.

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

---

## Design invariants (encode in reviews)

1. **Line vs version** — tree structure = lines; content/status = versions.
2. **No cascade fork** — parent pointer is `base_uid`, not a version UID.
3. **Contracts / releases are junctions** — they reference version UIDs; they do not own the tree.
4. **StrictDoc** — interchange only; this YAML is the dogfood source of truth for bootstrap.
