# Seed fixtures (golden beds)

Small on-disk goldens used by Cyber+QA dogfood fixtures (e.g. `FIX-EXPORT-L02-GOLDEN`, `FIX-CONTRACT-DOC-NOCTX`).

## L02 — `contract-fixture-doc-walk` (context parents off)

Bed for exporting / document-walking contract `contract-fixture-doc-walk` with **include-context-parents = false**.

| File | Role |
|------|------|
| `L02-contract-fixture-doc-walk.uids.txt` | Sorted UID set equality: `{A01, A02}` (= `in_scope_of`) |
| `L02-contract-fixture-doc-walk.sdoc` | Minimal StrictDoc 0.30 golden document containing exactly those two requirements (titles/statements from dogfood) |
| `L02-contract-fixture-doc-walk.expected.json` | Machine-readable expect: `contract_id`, `context: false`, sorted `uids`, `schema_version`, path refs |

Do not include ancestor section UIDs (`SEC-IA`, `SEC-SEC`) in this bed — that belongs to the context-parents-on case (`FIX-CONTRACT-DOC-CTX`).
