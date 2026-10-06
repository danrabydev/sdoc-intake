# ReqAML StrictDoc export manifest

Generated from dogfood YAML. StrictDoc is **interchange only**.

## Source

- Client: `Raby-Family` (`raby-family`)
- Project: `ReqAML` (`reqaml`)
- schema_version: `2026-10-06`

## Emitted files

| File | Description |
|------|-------------|
| `requirements.sdoc` | Sections + requirements / controls / capabilities |
| `contracts-releases.sdoc` | Contracts & releases as REQUIREMENTs with COMMENT UID lists |

## Counts (YAML)

| Entity | Count |
|--------|------:|
| requirement_lines | 31 |
| requirement_versions | 31 |
| edges | 18 |
| contracts | 1 |
| releases | 1 |
| catalogs | 2 |
| identities | 1 |
| project_grants | 2 |

## Counts (exported .sdoc structure)

| Kind | Count |
|------|------:|
| section lines | 9 |
| non-section lines → REQUIREMENT | 22 |
| contracts | 1 |
| releases | 1 |

## Grammar compromises

- `kind` stored in COMMENT (StrictDoc core grammar has no KIND field here).
- Edges, rbac_op, NIST/STIG notes, contract/release membership in COMMENT.
- Nested `[SECTION]…[/SECTION]` preserves tree; children of non-section lines use a synthetic `{base}-CHILDREN` section.
- Contracts/releases are a second document, not tree parents.
