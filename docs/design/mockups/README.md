# ReqALM UI mockups

Early product mockups used while locking Client→Project, contracts as overlays, `.N` versioning, and document views.

## Repo mockups (`docs/design/mockups/`)

| File | Screen |
|------|--------|
| `01-requirements-tree-detail.jpg` | Requirements tree + detail panel (contract scope, capabilities) |
| `02-contracts-list-detail.jpg` | Contracts list + overlap timeline + linked reqs |
| `03-document-view-from-contract.jpg` | Document view built from a contract (context parents) |
| `04-requirement-lineage-versions.jpg` | UID `.N` lineage (obsolete → active → draft) |

Working titles in early art (ReqFlow / ReqLens) predate the **ReqALM** name; treat them as visual drafts only. UI chrome may show **Acme Clinic** as the client-scoped view example.

## Grok Bot box — two-column trace set (`mockups/reqalm-two-column/shots/`)

These PNGs live outside the repo (Grok Bot box). Seed capabilities reference them by path only; files are not committed here.

| File | Screen | Seed capability |
|------|--------|-----------------|
| `01-two-column-overview-v2.png` | Requirements ↔ capabilities trace (overview) | `CAP-UI-VIEW-RTM` |
| `02-two-column-suspect-highlight-v2.png` | RTM trace with suspect highlight | `CAP-UI-VIEW-RTM` |
| `04-criteria-v2.png` | Requirement acceptance criteria / facets | `CAP-UI-VIEW-CRITERIA` |
| `05-criteria-suspect-why-v2.png` | Criteria with suspect / why panel | `CAP-UI-VIEW-CRITERIA` |
| `06c-catalog-BC-three-column-v2.png` | Catalog three-column browse | `CAP-UI-VIEW-CATALOG` |
| `06e-catalog-BC-three-column-AC3-v2.png` | Catalog browse (AC-3 column context) | `CAP-UI-VIEW-CATALOG` |
| `07a-catalog-caps-collapsed-v2.png` | Catalog ↔ capabilities trace (collapsed) | `CAP-UI-VIEW-CCM` |
| `07b-catalog-caps-AC3-expanded-v2.png` | Catalog ↔ capabilities trace (expanded) | `CAP-UI-VIEW-CCM` |
| `09-capability-detail.png` | Capability detail (traces, artifacts, releases) | `CAP-UI-VIEW-CAP-DETAIL` |
| `10a-focus-cap-rbac.png` | Capability / release focus (RBAC context) | `CAP-UI-VIEW-CAP-FOCUS` |
| `10d-focus-picker-search.png` | Focus picker with search | `CAP-UI-VIEW-CAP-FOCUS` |
| `11a-focus-release-r1-foundation-shipped.png` | Release focus (R1 foundation shipped) | `CAP-UI-VIEW-CAP-FOCUS` |

**Note:** In an earlier README draft, files **09** and **10** were swapped (focus vs detail). Detail is **`09-capability-detail.png`**; focus shots are **`10a-*`**, **`10d-*`**, and **`11a-*`**.
