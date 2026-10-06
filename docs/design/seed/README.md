# ReqAML — dogfood seed

Design-our-system-with-our-system: this folder holds a **YAML bootstrap** that mirrors the ReqAML product schema (locked 2026-10-06 ERD) and models *ReqAML itself* (the requirements/ALM product; StrictDoc is interchange only).

## Why YAML

- **Human-editable** — authors can draft trees, contracts, and edges without a UI yet.
- **Git-diffable** — line-oriented reviews; no binary store.
- **1:1 with future Postgres / OpenAPI** — same entities as [`../c4/data-erd.puml`](../c4/data-erd.puml).
- **StrictDoc is interchange only** — `.sdoc` export is for tools that still want StrictDoc; ReqAML’s store is not StrictDoc.

The seed includes identity actions **A01–A08** (aligned with [`../c4/sequences/`](../c4/sequences/INDEX.md)) and draft MCP desk actions **MC01–MC02**.

## Mental validation checklist

1. Every `requirement_version.uid` is either `base_uid` (first / `.0`) or `base_uid.N` with matching `version_n`.
2. Every `requirement_line.parent` is a **line** `base_uid` (or null), never a version UID — no cascade fork.
3. Status changes (`obsolete` / `withdrawn`) appear as **new versions**, not in-place edits of active rows.
4. `contract.in_scope_of` and `release.delivers` list **version UIDs** (junctions), not tree parents.
5. `edge.from` / `edge.to` are version UIDs; `kind` ∈ `refines|conforms_to|uses|satisfies`.

Optional JSON Schema check: [`reqseed.schema.json`](./reqseed.schema.json) (after YAML→JSON). Shape reference: [`schema.md`](./schema.md).

The converter’s `--validate` flag checks UID/parent rules without a JSON Schema engine.

## Converter (StrictDoc interchange)

From **repository root**:

```bash
pip install pyyaml   # or: pip install --user --break-system-packages pyyaml

python3 docs/design/seed/scripts/yaml_to_strictdoc.py \
  --in docs/design/seed/dogfood.yaml \
  --out docs/design/seed/out \
  --validate
```

Or from this directory:

```bash
cd docs/design/seed
python3 scripts/yaml_to_strictdoc.py --validate
```

Defaults: `--in` = `dogfood.yaml` here, `--out` = `out/`.

Output:

- `out/requirements.sdoc` — sections + requirements / controls / capabilities
- `out/contracts-releases.sdoc` — contracts & releases with COMMENT UID lists
- `out/MANIFEST.md` — file list and counts

## Edit loop

1. Edit `dogfood.yaml`.
2. Re-run the converter for `.sdoc` consumers.
3. **Future:** load the same YAML (or equivalent API payload) into ReqAML’s Postgres store.

Client: `Raby-Family` (`raby-family`). Project: **ReqAML** (`reqaml`).
