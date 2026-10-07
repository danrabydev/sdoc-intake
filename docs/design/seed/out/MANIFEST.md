# ReqAML StrictDoc export manifest

Generated from dogfood YAML. StrictDoc is **interchange only**.
Target grammar: **StrictDoc 0.30**.

## Source

- Client: `Raby-Family` (`raby-family`)
- Project: `ReqAML` (`reqaml`)
- schema_version: `2026-10-07`

## Emitted files

| File | Description |
|------|-------------|
| `requirements.sdoc` | Sections + requirements / controls / capabilities |
| `contracts-releases.sdoc` | Contracts & releases as REQUIREMENTs; membership via Parent InScopeOf/Delivers RELATIONS |

## Counts (YAML)

| Entity | Count |
|--------|------:|
| requirement_lines | 343 |
| requirement_versions | 355 |
| edges | 1478 |
| contracts | 5 |
| releases | 8 |
| catalogs | 3 |
| catalog_imprints | 2 |
| identities | 13 |
| project_grants | 11 |

## Counts (exported .sdoc structure)

| Kind | Count |
|------|------:|
| section lines | 20 |
| non-section lines → REQUIREMENT | 323 |
| contracts | 5 |
| releases | 8 |

## Edge kinds (YAML)

| Kind | Count |
|------|------:|
| conforms_to | 1053 |
| uses | 223 |
| satisfies | 106 |
| refines | 96 |

`conforms_to` pins are `(catalog_imprint_id, item_uid)` — `to` is the stable item UID in `catalog/*.sdoc` (`AC-3`, `V-222536`, …) and `catalog_imprint_id` names the published imprint (`nist-800-53@rev5-…`, `asd-stig@v6r4`). YAML `catalog_imprints[]` points at those `.sdoc` files. Project `REQAML-SEC-*` entries remain steward-mutable without imprint until publish; standards always require imprint publish. New imprint import does **not** auto-retarget live pins (see ARCH-CAT-IMPORT / ARCH-CAT-DRIFT).

## Catalog reverse Child ConformsTo

After export, run `scripts/patch_catalog_reverse_conforms.py` to mirror product Parent ConformsTo as Child ConformsTo on catalog nodes (idempotent; preserves STATEMENT). Re-run after re-copying catalogs from sdoc-intake. Dual Parent+Child needs the idempotent StrictDoc `create_link` patch (or omit reverse). Use `--no-reverse` for Parent-only.

## Grammar compromises (StrictDoc 0.30)

- DOCUMENT uses `TITLE`/`UID`/`VERSION` + `METADATA:` key/value (no free DOCUMENT `COMMENT:`).
- SECTION emitted as composite `[[SECTION]]`/`[[/SECTION]]` (StrictDoc 0.30 rejects legacy `[SECTION]`); fields only `UID`/`TITLE` (+ nested children + `[/SECTION]`); section intro text → `[TEXT]` node.
- STATUS mapped: active→Active, draft→Draft, obsolete/withdrawn→Deleted (only these three allowed).
- StrictDoc is a **dense interchange view** of ReqAML — prefer structured `RELATIONS` even when that diverges slightly from the product model.
- Outgoing `edges` → `RELATIONS` `TYPE: Parent` + `ROLE: <PascalCase>` when acyclic; if a Parent ROLE edge would cycle, emit `TYPE: Child` + same ROLE (not COMMENT-only). Roles: Satisfies|ConformsTo|Uses|Refines|InScopeOf|Delivers (+ bare Parent/Child + File).
- Contract `in_scope_of` / release `delivers` → first-class `RELATIONS` (`Parent` + `InScopeOf` / `Delivers`) on `contracts-releases.sdoc`. Requirements mirror as `Child` + same ROLEs (default dense interchange). Unpatched StrictDoc 0.30 asserts on same-ROLE dual-declare — use `--no-child-membership`, or keep the local idempotent `create_link` patch. COMMENT keeps a truncated summary.
- Tree: nested `[[SECTION]]…[[/SECTION]]`; `RELATIONS` Parent VALUE = parent section or requirement UID.
- Children of non-section lines (if any) use synthetic `{base}-CHILDREN` section.
- Contracts/releases are a second document, not tree parents.
- **Security catalogs** live under `seed/catalog/` (`nist-800-53.sdoc`, `asd-stig-v6r4.sdoc`) and are copied beside requirements into StrictDoc `input/catalog/`. Product/capability versions `ConformsTo` catalog UIDs (e.g. `AC-3`, `V-222536`) **through a catalog imprint**; control text is **not** copied into `requirements.sdoc` (Northline pattern). YAML pin metadata `catalog_imprint_id` is emitted in REQUIREMENT COMMENT. Catalog files may carry reverse `Child` + `ConformsTo` via `scripts/patch_catalog_reverse_conforms.py`.
