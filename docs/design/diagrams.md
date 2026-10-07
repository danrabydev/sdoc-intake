# Requirements product — architecture, context, data flow

Locked 2026-10-06: Client→Project hierarchy, contracts as related objects, `.N` requirement versions, TS/Node schema-first, Scoped View by client.

## 1. System context

```mermaid
flowchart LR
  subgraph Actors
    Author[Author]
    RelMgr[Release manager]
    Dev[Developer]
    Admin[Catalog steward]
  end
  subgraph Product["Requirements product"]
    UI[React UI]
    API[Node API OpenAPI]
    DB[(Postgres)]
  end
  subgraph External
    IdP[Enterprise IdP SSO]
    ADO[Azure DevOps]
    OTEL[OTEL collector]
  end
  Author --> UI
  RelMgr --> UI
  Dev --> UI
  Admin --> UI
  UI -->|HTTPS RBAC| API
  API --> DB
  API -.->|OIDC/SAML| IdP
  API -.->|work item sync| ADO
  UI -.->|telemetry| OTEL
  API -.->|audit logs| OTEL
```

## 2. Runtime architecture

```mermaid
flowchart LR
  subgraph client ["Client"]
    Browser[Browser React app]
  end
  subgraph gateway ["Gateway"]
    Edge[HTTPS reverse proxy]
  end
  subgraph service ["Services"]
    ApiSvc[API HTTP business data]
    SyncWorker[DevOps sync worker]
  end
  subgraph datastore ["Datastores"]
    Pg[(Postgres)]
  end
  subgraph external ["External"]
    IdP2[SSO IdP]
    Ado2[Azure DevOps]
    Otel2[OTEL]
  end
  Browser --> Edge
  Edge --> ApiSvc
  ApiSvc --> Pg
  ApiSvc -.->|SSO| IdP2
  ApiSvc -.->|REST sync| Ado2
  SyncWorker --> Pg
  SyncWorker -.->|REST| Ado2
  ApiSvc -.->|logs metrics| Otel2
  Browser -.->|client telemetry| Otel2
```

## 3. Domain object graph

```mermaid
flowchart TB
  Client --> Project
  Client --> ClientCatalog[Catalog client scope]
  GlobalCatalog[Catalog global]
  Project --> ProjCatalog[Catalog project scope]
  Project --> ReqLine[Requirement line]
  ReqLine --> ReqVer["Requirement version UID.N"]
  Contract -->|in_scope_of| ReqVer
  Release -->|delivers snapshot| ReqVer
  ReqVer -->|refines| ReqVer
  ReqVer -->|conforms_to| Control
  Cap[Capability] -->|satisfies at create| ReqVer
  ReqVer -.->|work_item_link| WI[Work item]
  Project --> ChangeSet
  ChangeSet -->|parent optional| ChangeSet
  ChangeSet --> AuditEvent
  Project --> WfProfile[WorkflowProfile]
  WfProfile --> Gate
  WfProfile --> ActionHook
  WfProfile --> RoleBinding
  ReqLine -->|ApprovalRecord SoT| Approval[Line approval]
  ReqVer -.->|stakeholder_approval mirror| Approval
```

## 4. UI data ownership

```mermaid
flowchart TB
  App[App Auth ClientScope] --> Layout
  Layout --> Page
  Page -->|RBAC gate| View
  View -->|fetch rare| Store[Store or context reducer]
  View --> Comp[Pure components]
  Store -->|clientId scoped queries| API2[API]
```

## 5. Request data flow — contract document view

```mermaid
sequenceDiagram
  participant U as User
  participant UI as React View
  participant API as API HTTP
  participant Biz as Business
  participant Data as Repo
  participant DB as Postgres
  U->>UI: Select client Scoped View
  U->>UI: Open contract document
  UI->>API: GET /clients/{id}/contracts/{cid}/requirements
  API->>Biz: listForContract actor clientId
  Biz->>Biz: rbac.require requirement:read
  Biz->>Data: listForContract
  Data->>DB: query filtered by clientId
  DB-->>Data: requirement versions
  Data-->>Biz: rows
  Biz->>Biz: audit log
  Biz-->>API: DTO
  API-->>UI: JSON
  UI->>UI: Walk parents for context tree
  UI-->>U: Document view dimmed context
```

## 6. Priority to work item flow

```mermaid
flowchart LR
  Pri[Mark priority on req] --> Parents[Surface parent detail debt]
  Parents --> Groom[Groom statement]
  Groom --> Ready[Ready for work item]
  Ready --> CreateWI[Create or update WI]
  CreateWI --> Iteration[Attach iteration]
  CreateWI --> RelPlan[Attach planned release]
  RelPlan --> Ship[Release snapshot delivered versions]
```

## 7. C4 sequence diagrams

PlantUML sources under [`c4/sequences/`](./c4/sequences/). Canonical tracked copies live in **sdoc-intake** `docs/design/c4/sequences/` (INDEX + companions).

Workflow / Cyber+QA (ActionHook pipeline via `HookEval` / `GateCheck` / `HookEffectsAfter`):

| ID | Diagram |
|----|---------|
| WF01 | ActionHook evaluator (shared) |
| MC02 | MCP draft mutate (not mint) |
| D12 | Approve line (+ clears planning_blocked / D39f) |
| D39d | Mint successor with mint_kind |
| D39g | Gate sign-off |
| E41 / E41a | ConformsTo pin request / apply-deny |
| E46a | Suspect queue |
| G61 | Ship release (`cyber_gate` trigger; `gate_signoff` pass) |
