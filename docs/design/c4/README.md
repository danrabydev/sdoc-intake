# C4 architecture & action sequences

Design artifacts for the **collaborative requirements + ALM** product (StrictDoc as interchange only). Locked context: Client → Project hierarchy, contracts as first-class related objects, requirement versions with `.N` UIDs, TypeScript/Node OpenAPI API, Postgres SoT, React UI, SSO, Azure DevOps work-item client.

## Contents

| Path | Description |
|------|-------------|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Narrative + mermaid views (runtime, domain, UI ownership) |
| [`L1-system-context.puml`](./L1-system-context.puml) | C4 system context |
| [`L2-containers.puml`](./L2-containers.puml) | C4 containers |
| [`L3-api-components.puml`](./L3-api-components.puml) | API L3 components |
| [`L3-ui-components.puml`](./L3-ui-components.puml) | Web UI L3 — **Routes + guards wrap Layout** outlet |
| [`data-erd.puml`](./data-erd.puml) | Draft relational map |
| [`includes/`](./includes/) | PlantUML library for **user-action sequences** |
| [`sequences/`](./sequences/) | One diagram per action ([INDEX](./sequences/INDEX.md)) |
| [`SEQUENCES.md`](./SEQUENCES.md) | Workflow + compliance requirements |
| [`user-actions-inventory.md`](./user-actions-inventory.md) | Full action list by section |
| [`../seed/`](../seed/) | ReqAML **dogfood YAML** (A01–A08, MC01–MC02) → optional StrictDoc export |

## Sequences vs container diagrams

- **L1–L3 / ERD:** remote `!include` from [C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML).
- **Action sequences:** local [`includes/`](./includes/) only; each diagram documents RBAC and **control rationale** via `ControlNote`.

Start here for new action work: [`SEQUENCES.md`](./SEQUENCES.md).
