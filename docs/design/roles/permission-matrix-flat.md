# ReqAML permission matrix (flat)

Ignores client/project/global scope.

## Authority

**Cyber+QA locked (2026-10-07):** ConformsTo = Author **request** only; Security/Steward **apply** (profile `conforms_to_applicator`; commercial may bind Author). AO = approve-only on locked migrate / cyber ship (`gate_signoff`), never free pin edit. Approve verbs exist on requirement/capability lines (RoleBinding `gate-approver-slot`). Prefer `permission-tree.html` over this flat matrix.

Where this flat matrix disagrees with `permission-tree.html`, **prefer the permission tree** (especially Change set: Developer is leaf-only — no SDLC parent open/close, no revert).

## Role changes vs prior draft

- **Add AO** — Authorizing Official / accept-risk authority (ATO-style). Approve-only, not an editor.
- **Keep Author / Developer / Tester split** — DoD-like separation of statement vs implementation vs evidence.
- **Map COR/PM → Client admin / Project admin** — not Author by default.
- **No separate Deployer in v1** — Release manager ships; ops deploy under that or out of band.
- **Key custodian (deployment-scoped, 2026-10-07)** — owns key-store operations (`key:*`: KEK/DEK rotate, revoke, destroy, recover) per ARCH-KEY-CUSTODIAN. It sits outside the project/client role columns below, grants no requirement-content access, and must be distinct from Client admin / Project admin (AC-5). Seed: `kim-key-custodian` via `platform_grants`.
- **Keep Catalog steward ≠ Security** — steward owns imprint/entry mutate; Security owns conformance & review.
- **Auditor** stays read-only on history.

| Capability | Reader | Author | Developer | Tester | Release mgr | Security | AO | Catalog steward | Project admin | Client admin | Auditor |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Browse reqs / catalogs / releases | R | R | R | R | R | R | R | R | R | R | R |
| Approve requirement/capability line (RoleBinding slot) | — | — | — | — | — | — | A | — | A | A (commercial stakeholder) | — |
| Suspect queue carry / keep-pinned / drop | — | W | — | — | W (contract/release) | W (ConformsTo) | — | — | W | — | — |
| Edit draft requirement versions | — | W | — | — | — | — | — | — | W | — | — |
| Mint successor .N / obsolete / withdraw | — | W | — | — | — | — | — | — | W | — | — |
| Edit verification notes / evidence | — | R | R | W | — | R | — | — | R | — | — |
| Create / update mapped work items | — | R | W | R | R | — | — | — | W | — | — |
| Add / change trace edges (non-security) | — | W | R | — | — | — | — | — | W | — | — |
| ConformsTo / security metadata / migrate | — | R (request) | — | — | — | W (apply) | A (locked migrate) | W (non-std apply) | R | — | — |
| Publish catalog imprint / steward entries | — | — | — | — | — | R | — | W | — | — | — |
| Contract in_scope link / unlink | — | W | — | — | R | R | — | — | W | — | — |
| Plan release / add delivers | — | R | — | — | W | R | — | — | W | — | — |
| Ship release (freeze snapshot) | — | — | — | — | W | R | A | — | R | — | — |
| Cyber review / accept risk (ATO-style) | — | — | — | — | — | W | A | R | — | — | R |
| Open / close SDLC change-set session | — | W | W | W | W | W | — | W | W | W | — |
| Revert / apply change set (within rights) | — | W | W | W | W | W | — | W | W | W | — |
| Project grants (members / roles) | — | — | — | — | — | — | — | — | W | W | — |
| Client grants / create projects | — | — | — | — | — | — | — | — | — | W | — |
| Read full audit / change-set history | — | R | R | R | R | R | R | R | R | R | R |
