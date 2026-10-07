# ReqALM — first-round product analysis

**Date:** 2026-10-07 · **Audience:** Dan · **Status:** analysis only (no seed edits, no commit)
**Basis:** `seed/dogfood.yaml` (schema_version 2026-10-07: 216 lines / 221 versions / 824 edges), `seed/schema.md`, `seed/README.md`, `seed/out/MANIFEST.md`, `seed/fixtures/*`, `roles/workflow-system.md`, `roles/open-questions.md`, `roles/permission-tree.html`, `roles/permission-matrix-flat.md`, `user-actions.md`, `diagrams.md`, `c4/*.puml`, mockup 01.
Everything below comes from those files. Where I count things, the counts come from parsing `dogfood.yaml` directly.

---

## 1. Executive take

**Conditional yes.** The *model* is good enough for a first round. Line/version split, `.N` immutability, contracts and releases as junctions, imprint-pinned ConformsTo, line-grain approval with a hash pin, and gate/hook composition are coherent. They also go further than most tools on DoD-style needs. The *requirement set as encoded* is not yet credible as a first-round spec, for three reasons:

- **It contradicts itself in places that sit on the critical path.** These are hash scope vs. obsolete/migrate successors, Author ConformsTo rights, the L02 golden UID set, and in-place obsolete vs. "status is a new version".
- **The locked workflow decisions are not scheduled.** ARCH-WORKFLOW, ARCH-HOOK-EVAL, ARCH-WF-ADMIN, D13, UI-APPROVE-*, all ARCH-CAT-* imprint/migrate items, M07, ARCH-BACKLOG and ARCH-GANTT are in **no release**. Meanwhile R1 delivers D08 and G05, and both depend on that engine.
- **The ERD can't store several locked decisions.** It has no imprint/catalog-item tables, the edge FK can't target a catalog item, audit_event has no payload to revert from, and there's no sign-off record for cyber ship.

Fix those (list in §7) and R1-core-ALM becomes a defensible first round. Two more things are needed for it to compete rather than just exist: change/impact handling ("suspect links") and a real document export story.

---

## 2. What the product is (from the reqs)

A multi-tenant (Client → Project) requirements + light ALM system. It replaces StrictDoc as the system of record; StrictDoc stays as interchange.

| Layer | What the reqs define |
|---|---|
| **Structure** | `requirement_line` (stable `base_uid`, parent is always a line) vs. `requirement_version` (`base_uid.N`, immutable once non-draft). Line kinds: section, requirement, control, capability, release_node. |
| **Overlays** | Contracts (`in_scope_of`) and releases (`delivers`, frozen on ship) reference **version UIDs**. Neither owns the tree. Contract document view walks parents for context (F07/F08). |
| **Traces** | `refines`, `uses`, `satisfies` (cap → req, required at cap create), `conforms_to` (pinned to `(catalog_imprint_id, item_uid)`). |
| **Compliance** | Standard catalogs (NIST 800-53 r5, ASD STIG V6R4) imported as imprints. Northline rule: no copied control text. Drift flag on new imprint, mandatory migrate preview, locked versions migrate only via `.N`. |
| **Workflow** | WorkflowProfile → Gates (predicate + approver slots) → ActionHooks (action → gates_before → effects_after) → RoleBindings. SubjectKinds separate RequirementLine from CapabilityLine. ApprovalRecord at line grain pins version + hash. Activate ≠ approve. |
| **Planning** | Priority (gated on approval), grooming_state (want → detailed → wi_ready), iterations, backlog (K01/G04) and Gantt (G07), all listed as full product requirements. |
| **Delivery / verification** | `verification_outcome` pass/fail/pending, set per version. Ship gates: cyber (Security + AO slots) and verification (configurable). |
| **Audit** | Change sets (leaf + SDLC parent), kept forever. Only the latest set on the stack can be reverted; older sets need abandon-suffix. OTEL export. Full audit read for all roles. |
| **Integration** | Azure DevOps work-item sync (push/pull/conflict). MCP "desk" channel for agents: same RBAC as UI, mutations over HTTPS only. |
| **Roles** | Reader, Author, Developer, Tester, Release mgr, Security, AO (approve-only), Catalog steward, Project admin, Client admin, Auditor. |

Positioning implied by the materials: a **DoD-contractor-grade requirements system** (see `dod-contractor-sdlc-roles.puml`) that is also usable commercially, with the differences expressed as WorkflowProfile data.

---

## 3. Strengths

1. **Line/version identity is right.** Parent = line `base_uid` (no cascade fork), immutable non-draft versions, status changes as successors, and junctions on version UIDs. Most tools mix up "item" and "revision". This model makes baselines, contract scope and release snapshots precise by construction.
2. **The imprint model is a real differentiator.** It pins `(imprint, item_uid)`, never auto-retargets, flags `catalog_drift` with a change class, requires a migration preview, and migrates locked versions only via `.N`. The materials say this outright: it treats NIST/STIG as versioned external libraries instead of copied text. That's the hard part of DoD compliance traceability.
3. **Approval is modeled correctly in principle.** Approval is separate from lifecycle, sits at line grain, and is hash-pinned. A no-op successor can't be used to clear an approval, and a restored hash still needs re-approval. This survives an auditor's questions.
4. **Workflow by composition, not a mega state machine.** The profile/gate/hook/binding split with a thin lifecycle is the right architecture for "same product, commercial vs DoD". It keeps StrictDoc interchange clean.
5. **Security is designed in from the start, with negative tests.** Server-bound Client Scoped View, RBAC on every mutation, MCP mirrors UI RBAC, and about 27 FIX-* beds, most of them deny cases (cross-client, revoked grant, steward-on-standard, MCP escalation, shipped delivers, closed contract, non-latest revert, no-op successor). Few v1 products ship with that.
6. **Real dogfood.** The product's own requirements live in its own schema, with real catalog pins (713 `conforms_to` edges), real contracts and releases, succession fixtures, and a StrictDoc round-trip converter with `--validate` and a golden export. That makes the spec testable.
7. **The role model fits the target buyer.** Author / Developer / Tester separation, AO as approve-only, Steward ≠ Security, read-only Auditor, and COR/PM mapped to admin roles. The permission tree states row-level conditions ("status=draft", "status≠shipped", "imprint+item"), not just ticks.
8. **Decisions are disciplined.** `open-questions.md` reduces to one true unknown (field-level undo). Locked answers are recorded with UIDs and fixtures, so implementers aren't left guessing at policy, except where §4 shows contradictions.

---

## 4. Gaps and risks for a first shippable round (prioritized)

### P0 — fix before calling the first-round spec credible

**P0-1. The release plan doesn't contain the locked design.**
R1-core-ALM (71 delivers, planned 2026-11-30, `cyber_gate: true`) includes D08 (priority gated on approval), D12 (Approve), G05 (ship with gates) and ARCH-CYBER-GATE. It does **not** include anything that implements them: ARCH-WORKFLOW, ARCH-HOOK-EVAL, ARCH-GATE-MODEL, ARCH-SUBJECT-KIND, ARCH-APPROVAL-LINE, ARCH-SUCCESSION-HASH, ARCH-APPROVER-SLOTS, ARCH-WF-ADMIN, D13, UI-APPROVE-LINE/TREE, or ARCH-APPROVAL-VIEW. Also missing from every release: all of ARCH-CAT-IMPRINT/PIN/IMPORT/DRIFT/REACT/MIGRATE, H01–H05, H10, M07, ARCH-CHANGESET-RETAIN/CONFLICT/RBAC, ARCH-BACKLOG, ARCH-GANTT, G04, G07, C07, D07, D10, D11, F03, ARCH-API-RBAC, and ARCH-CP-SCOPE. In total **87 of the 172 non-fixture, non-section active/draft versions are in no release.** "No artificial v1 cuts" is a fine product stance, but a first round still needs a delivery boundary. Right now the boundary leaves out the engine its own D08/G05 rely on.

**P0-2. Statement-hash scope conflicts with three locked flows.** `gate-noop-successor-block` denies a `.N` whose `statement_hash` equals the head's. The hash is "canonical statement (+ agreed metadata)", and "agreed metadata" is never defined. Three flows mint a `.N` that can leave the statement unchanged:
- D05 obsolete/withdraw ("new version with that status")
- ARCH-CAT-MIGRATE locked migrate (a `.N` that only changes the ConformsTo pin)
- the Security "mint successor .N — catalog migrate / security metadata only" right in the permission tree

As written, the no-op gate blocks all three. You need a decision on what goes into the hash: does it include status, pins, or security metadata? Separately, does a pin-only or status-only `.N` clear approval?

**P0-3. Obsolete semantics contradict between the reqs and the seed.**
- ARCH-VER / D05 say obsolete is a *new version*.
- D04 says activation "may auto-obsolete a prior active version", which is an in-place status change on an existing row.
- The seed itself models in-place obsolescence: `ARCH-CONTRACT` (.0) is `obsolete` with `ARCH-CONTRACT.1` active, and `FIX-SUCC-2HOP` .0 and .1 are both obsolete.
- ARCH-VER-SUCC says one active version per line is only "preferred", and FIX-ALLOW-SUCCEED allows two active tips.

This is the core identity rule of the product. Pick one: superseded rows get a mutable `superseded` status, or obsolete only means a tombstone successor. Also decide whether "exactly one active per line" is an invariant.

**P0-4. The approve action isn't actually guarded by the encoded wiring.**
- `hook-line-approve` and `hook-line-approve-tree` have `gates_before: []`.
- RoleBinding `stakeholder` is attached to `gate-line-approved`, and that gate runs *before priority*, not before approve.
- The permission tree has **no approve row** for requirement or capability lines, even though invariant 7 says "permission tree authoritative for verbs".
- Client admin, the commercial approver, is ✗ on almost every requirement row.

So no encoded component checks who may approve. You need an explicit `requirement:line:approve` / `capability:line:approve` verb, plus a gate (or slot check) on the approve hook that reads the RoleBinding. Related: Approve writes records for "line + direct children", but the hook effect is the singular `write_approval_record`, and it's undefined whether approving a parent requires the children to have head versions or to be active.

**P0-5. The ERD can't store what's locked.** `c4/data-erd.puml` lacks:
- `catalog_imprint`, `catalog_item`, `catalog_steward_grant` and `client_grant` tables.
- An `edge.catalog_imprint_id`. Also `edge.to_version_id` is an FK to `requirement_version`, so it can't hold `AC-3`. That breaks all 713 pins.
- Line `title` and sibling order (C02/C04).
- Version `created_at/by`, `security`, `rbac_op`, `title`.
- `workflow_profile` enabled/disabled optional gates.
- On `audit_event`: subject reference, before/after payload, reason.
- Persistence for N02 pins, MCP desks/sessions, and sync conflict state.
- A uniqueness scope for `base_uid`. `approval_record` keys on text `base_uid` rather than `line_id`.

The YAML schema is ahead of the ERD. Since the README says YAML is "1:1 with future Postgres", the ERD has to catch up before anyone writes migrations.

**P0-6. Change-set revert can't be implemented as specified.** M07 reverts and re-applies whole sets, but:
- `audit_event` has no payload to compute an inverse from.
- Versions are immutable, so "reverting" a mint either deletes a row (breaking the history guarantee) or needs a compensating successor. That isn't specified.
- ARCH-CHANGESET-CONFLICT admits that external side effects (ship, closed contract, ADO push) "deny with FIX-DENY-* when defined", but none are defined beyond non-latest.
- Leaf-open includes Developer while the flat matrix grants Developer revert. The tree wins, but the flat matrix is still published.

Also a UX risk: the stack is **project-wide**. With several authors, anyone's later save makes your set non-latest. Your only remaining option is to abandon other people's work. In practice that means revert works for a single user only.

**P0-7. Fixtures disagree with each other.** FIX-EXPORT-L02-GOLDEN, L02, FIX-CONTRACT-DOC-NOCTX and FIX-CONTRACT-DOC-CTX expect `{A01, A02, AC-3}`. The contract `contract-fixture-doc-walk.in_scope_of` and the golden files (`uids.txt`, `expected.json`) say `{A01, A02}`, and `fixtures/README.md` says "exactly those three requirements" while listing two. `AC-3` is a catalog item and can't be a version UID in `in_scope_of` at all. Golden tests that contradict each other erode trust in the whole fixture suite.

**P0-8. ConformsTo authority contradicts across documents.**
- The permission tree says Author is ✗ on add/remove ConformsTo ("read + request").
- E02 says "An Author or Security reviewer adds a conforms_to edge… validates both UIDs exist in the project". That second clause also contradicts imprint pinning.
- H06 says an Author "stores a ConformsTo pin".
- H10 says "An Author or Security steward migrates".
- The flat matrix gives AO "A" and Catalog steward "W" on ConformsTo.

The "request" flow the tree implies (Author requests, Security applies) has no action, entity or queue.

### P1 — needed for a credible (not just functional) first round

**P1-1. No change-impact / suspect-link mechanism.** Edges, contract scope and release delivers all pin *version* UIDs. When a requirement mints `.N`:
- caps that `satisfies` the old version silently point at history
- contracts still scope the old version
- planned releases still deliver it

The only handling is a fixture (FIX-SUCC-2HOP: "detect edges that still point at obsolete UIDs") and a "warning" in FIX-REL-SNAP. There's no rule for carrying edges forward, no suspect flag (the analogue of `catalog_drift`, but for internal traces), and no review queue. DOORS, Jama and Polarion all treat suspect links as table stakes. `catalog_drift` already shows the pattern, so generalize it.

**P1-2. Approval clearing has no defined downstream effect.** When `.N` clears approval, what happens to the line's existing priority, grooming_state, iteration, release membership and work-item link? The gate only blocks *setting* priority. Does a cleared line drop out of K01/G04? Does `.N` inherit priority at all? The seed already breaks its own gate: **198 versions carry priority while their line has no approved ApprovalRecord** (only 4 lines are approved). Bootstrap and import (L01) need a grandfather or "imported-approved" policy, or the dogfood fails its own gate on load.

**P1-3. Verification is an enum, not ALM.** `verification_outcome` (pass/fail/pending) on the version has no test-case entity, run history, evidence attachment, environment, or verifier-on-record beyond `verification_note` text. ARCH-VERIFICATION says it doesn't want "a full evidence CMS". Fine. But the "ALM" positioning and mockup 01's **Test Coverage** nav item promise more than that, and `gate-verification-ship` evaluates a single mutable field. Also, by the hash rule a new `.N` presumably resets verification, but that isn't stated. In the seed, R1 has 0 of 71 delivers at `pass`. That's harmless while the gate is off commercially, but `wf-dod-cyber` would block it.

**P1-4. The cyber ship gate has no sign-off record.** `gate-cyber-ship`'s predicate is `release.cyber_gate == true`, which is the *trigger*, not a pass condition. Slots `security_signoff` and `ao_approve` exist, but nothing stores that Security signed or the AO approved for a release (ApprovalRecord is line-only). The same gap exists for "AO approve-only on locked migrate". You need a general `gate_signoff` record (subject, slot, identity, at, decision, note).

**P1-5. The gate predicate language is undefined.** "Closed vocabulary expression" appears with no grammar. Encoded predicates reference undeclared paths such as `subject.head_hash`, `project.change_set_stack.latest_non_abandoned` and `all delivers.verification_outcome`. Without a defined vocabulary and evaluator contract, "configurable gates" means code changes per gate. That undercuts ARCH-WF-ADMIN's "no code changes" claim.

**P1-6. Document output is deferred, which hurts with the target buyer.** L03 (PDF/Markdown document export) is a draft "later" item. Contract and DoD audiences consume requirements as documents (specs, contract attachments). For a first round, the only document-shaped outputs are StrictDoc export (L02) and a bill of requirements (L04). Expect this to be the first objection.

**P1-7. Coverage is thin even in the dogfood.** 27 of 164 non-fixture requirements have an incoming `satisfies`, from 9 capabilities. Since "no orphan caps" is a headline rule, the dogfood should show the reverse view too (uncovered requirements), and there's no coverage report requirement. Mockup 01 also shows "Reports" and a notifications bell with no backing requirements.

**P1-8. Collaboration primitives are missing.** The dogfood has no requirements for comments or review threads, notifications, @mentions, or a formal review round. It also says nothing about concurrent-edit control (optimistic locking/ETags) on drafts. Approval exists, but you can't capture *why* a stakeholder pushed back. MCP agents plus humans editing the same draft makes concurrency control a P1 correctness issue, not polish.

### P2 — should be on the radar

- **Import breadth.** Only StrictDoc/"notation" import (L01). There's no ReqIF, Word or Excel import, and no requirement for any of them. Migrating off DOORS/Jama needs ReqIF at minimum. That's competitive context, not something the materials state.
- **Custom attributes / item types.** The schema has fixed fields only. Fine for a first round, but buyers will ask.
- **Flat matrix vs tree drift.** The flat matrix gives Developer revert and SDLC-parent open, and has no approve row. Either regenerate it from the tree or delete it.
- **Doc count drift.** README says 176 lines / 663 edges; MANIFEST and YAML say 216 / 824. The README section table omits SEC-WF. The generator doesn't emit the Cyber+QA fixtures or the workflow additions.
- **Mockup drift.** Mockup 01 renders `SYS-001.1 Session timeout` as a *child* of the portal sign-in line, which reads as a different requirement rather than a successor of SYS-001. That's exactly the line/version confusion the model exists to prevent. The mockups predate the approval and workflow model, so there's no approval-tree, gate-denial or drift-queue UI art.
- **C4 lags the design.** L2/L3 have no workflow/gate evaluator component, no MCP server container or desk WSS, and no catalog import pipeline. Sequences exist only for A01–A08 and MC01–MC02. There are none for approve, mint/clear, ship-with-gates, migrate, or revert, which are the hard flows.
- **`gate-noop-successor-block` subject kinds** include CapabilityLine while the mint hook targets RequirementVersion. That's minor, but caps mint too: confirm a single hook covers both.
- **Over-pinning.** 713 ConformsTo edges onto only 28 distinct catalog items, with up to 7 per requirement (A01, A02, A06–A08). When an imprint drifts, each normative item change will flag many versions. Think about whether pins belong on capabilities/controls rather than on every requirement.

---

## 5. Competitive / category fit

Market positioning below is general category knowledge, offered as context. The ReqALM claims are grounded in the materials.

| Dimension | ReqALM (per reqs) | DOORS (Next) | Jama Connect | Polarion | StrictDoc + ALM glue |
|---|---|---|---|---|---|
| Item vs revision identity | **Strong.** Explicit line / `.N`, junctions on versions | Baselines and module history | Item versions plus baselines | Revisions plus baselines | Git history, UIDs |
| Contract-scoped views | **Distinct.** Overlapping contracts as overlays with document walk | Modules/views | Filters/sets | Documents/queries | Manual |
| Standards catalogs | **Distinct.** Versioned imprints, pins, drift, migrate preview | Usually imported modules | Usually imported/copied | Usually imported | Catalog .sdoc files, no drift |
| Approval / e-review | Line-grain, hash-pinned. **No review threads or comments** | Reviews | Review Center (core strength) | Approvals/e-sign | None |
| Workflow configurability | Profile/gate/hook (designed, not scheduled) | Limited | Configurable | Highly configurable | None |
| Suspect / impact | **Missing** (drift only for catalogs) | Core | Core | Core | None |
| Test management | Enum per version | Via ETM | Built in | Built in | None |
| Document output | StrictDoc export; PDF deferred | Core | Core | Core (LiveDocs) | Core (HTML/PDF) |
| Interchange | StrictDoc in/out | ReqIF | ReqIF/Word/Excel | ReqIF/Word | sdoc/ReqIF |
| Agent access | **MCP desk with same RBAC** | — | — | — | — |
| Tenancy | Client → Project with server-bound scope | — | — | — | — |

**Read:** ReqALM wins on the *data model for DoD compliance traceability*: imprints, contract overlays, hash-pinned approval, and agents with matching RBAC. It loses on *ergonomics the incumbents built a decade ago*: suspect links, review threads, document output, test management, and ReqIF. For a first round aimed at a narrow wedge (DoD contractors already on StrictDoc or spreadsheets who need NIST/STIG traceability plus contract scoping), the strengths are enough and the losses can wait. **Except suspect links:** without them the version-pinned model *creates* stale traces faster than the incumbents do. That's a self-inflicted gap, not a parity gap.

Against **StrictDoc + ALM glue**, the materials' implicit incumbent (StrictDoc is what ReqALM replaces): ReqALM is clearly better on RBAC, tenancy, approval, imprints, contracts and audit. It's worse on document rendering (L03 deferred) and on "it's just text in git". The StrictDoc export keeps an exit path, which helps adoption.

---

## 6. Implementability notes

- **Stack.** TS/Node, Zod + OpenAPI schema-first, Postgres, React; HTTP → business → data. Conventional and well-layered, and MCP reusing the same service layer is cheap if ARCH-API-LAYERS holds.
- **Build the evaluator first, and make it boring.** RBAC → hooks → gates → mutate → effects → audit (ARCH-HOOK-EVAL) is a small engine if the predicate vocabulary is closed and typed (P1-5). Implement the gates as **typed TS functions registered by id**, with the profile choosing which ids run and the binding filling slots. Don't build an expression language. That satisfies "data not branches" for commercial vs DoD without a DSL. All seven encoded gates are expressible this way today.
- **One transaction per leaf change set.** Mutate + effects (approval clear, mirror dual-write) + audit should commit atomically under one leaf `change_set`. Dual-writing `stakeholder_approval` is a consistency risk. Drop the mirror in the first round and compute it in read models; the docs already call it "migrate only".
- **Locked is derived.** `status≠draft ∧ (in_scope ∨ delivers)` is a two-junction EXISTS. That's cheap, but every migrate and edit path must call the same function. Put it in one place (a view or an SQL function).
- **Revert needs inverse-able events.** Whichever route you pick (store before/after per object in `audit_event`, or define revert as compensating actions per action_id), it's a schema decision that must land before the first migration. Compensating actions fit immutable versions better.
- **Imprint storage.** Catalog items must be rows (`catalog_item(imprint_id, item_uid, text, …)`) with the edge pointing at `(imprint_id, item_uid)`, either through a polymorphic target or a separate `conformance_pin` table. A separate table is cleaner and matches `EdgeConformsTo` as its own SubjectKind. Importing NIST/STIG `.sdoc` into rows is a bounded parser job, and the converter already reads that grammar.
- **Tenancy.** "Server-bound Client Scoped View" plus "never cross clients" across search, audit and catalogs should be enforced in the data layer, not only in services. That means a mandatory `client_id` predicate in repositories or Postgres RLS. The materials mention least privilege but don't choose a mechanism. Choose it early; a cross-client bug is existential for this buyer.
- **Seed as a test oracle.** The FIX-* beds map cleanly to API integration tests (actor, action, expected status, expected audit row). Make loading `dogfood.yaml` plus running the FIX suite the CI gate. That only works once the P0-7 contradictions are fixed and the P1-2 grandfather rule exists.
- **Sizing (judgment).** R1 as currently scoped (71 items) plus the unscheduled engine items is a lot for a 2026-11-30 date. The ADO sync worker (J04–J06, bidirectional with conflict resolution) and Gantt (G07) are the two largest independent chunks, and both can trail the core without hurting its credibility.

---

## 7. Recommended next design/encode moves (to harden the first round)

In order. Items 1–4 are decisions only you can make; the rest is mechanical encoding once those are made.

1. **Decide hash scope and the status model** (P0-2, P0-3). Pick between:
   - (a) `statement_hash` covers the statement only, and status-only or pin-only successors are a distinct mint kind exempt from the no-op gate (with a defined effect on approval), or
   - (b) hash covers statement + status + pins.

   Separately: do superseded rows get an in-place `superseded`/`obsolete` status (as the seed already does), or are tombstone successors the only way? Is one-active-per-line an invariant? Encode a FIX bed for each answer.
2. **Define the downstream effect of an approval clear** (P1-2). Answer:
   - whether `.N` inherits priority, grooming and iteration
   - what happens to release and contract membership of the old version
   - the import/bootstrap approval policy, so the 198 prioritized-but-unapproved seed versions are valid.
3. **Decide the suspect-link policy** (P1-1). Generalize `catalog_drift` into a `trace_drift`/suspect flag on edges and junctions when the target line mints `.N`. Add a review queue with "carry forward / keep pinned / drop" actions, mirroring ARCH-CAT-REACT. Add `ARCH-SUSPECT` plus a FIX bed, and put it in R1.
4. **Settle ConformsTo authority** (P0-8). Either Authors add pins (and fix the tree) or Authors request and Security applies (and add a request entity/action). Fix E02's "both UIDs exist in the project" wording to the imprint pin.
5. **Wire approve authority** (P0-4). Add approve verbs to `permission-tree.html` and `user-actions.md`. Add a `gate-approver-slot` (or put the slot check on the approve hooks' `gates_before`). Make the Approve batch effect explicit. Regenerate or retire `permission-matrix-flat.md`.
6. **Add a gate sign-off record** (P1-4): `gate_signoff(subject_kind, subject_id, gate_id, slot, identity, decision, at, note)`. Use it for cyber ship and locked-migrate AO approval, and add a FIX bed for "ship denied until both slots signed".
7. **Specify revert mechanics** (P0-6). Choose compensating actions vs. a before/after payload, define per-action reversibility (mint, ship, ADO push, close contract), and decide whether the stack is per-project or per-actor/per-SDLC-parent. Add FIX beds for the irreversible cases.
8. **Bring the ERD up to the YAML** (P0-5): imprint, catalog_item, conformance pin, steward and client grants, line title and order, version provenance, audit payload, profile optional-gate columns, gate_signoff, suspect flag. Then regenerate the C4 L3 diagrams with a Workflow Evaluator and a Catalog Import component, and add sequences for approve, mint-clear, ship-with-gates, migrate and revert.
9. **Fix the fixtures and doc drift** (P0-7, P2). Make L02/NOCTX/CTX agree with the golden files (`{A01, A02}`; AC-3 only shows up as a pin), update the README counts and section table, and teach `gen_expanded_dogfood.py` the Cyber+QA and workflow additions, or retire it.
10. **Re-cut R1 around the engine** (P0-1). Proposed R1 boundary:
    - **Engine:** ARCH-WORKFLOW, ARCH-HOOK-EVAL, ARCH-GATE-MODEL, ARCH-SUBJECT-KIND, ARCH-APPROVAL-LINE, ARCH-SUCCESSION-HASH, ARCH-APPROVER-SLOTS, ARCH-CAP-LINK/APPROVE, D13, UI-APPROVE-*, ARCH-APPROVAL-VIEW.
    - **Imprints (minimum):** ARCH-CAT-IMPRINT, ARCH-CAT-PIN, H01, H03, ARCH-CAT-SCOPE.
    - **Security baseline:** ARCH-API-RBAC, ARCH-CP-SCOPE.
    - **Core change set:** M07 + ARCH-CHANGESET-*.
    - **Supporting:** C07, D07, D10, F03.
    - **Can move to R2 without hurting credibility:** imprint import/drift/migrate (ARCH-CAT-IMPORT/DRIFT/REACT/MIGRATE, H10), ADO bidirectional sync (J04–J06), and G07 Gantt. Gantt stays a full product requirement, just not in round one.

    This doesn't contradict "no artificial v1 cuts". It's sequencing, not de-scoping.
11. **Add first-round credibility reqs** (P1-6/7/8): document export (promote L03 or define a minimal HTML/Markdown export of the contract document view), a coverage report (uncovered requirements, caps per requirement, verification by release), draft concurrency control (ETag/version check, including for MCP), and a minimal comment-on-line or approval-rejection note.
12. **Write down the wedge** (§5). One paragraph in the README: who round one is for (DoD contractors needing NIST/STIG + contract-scoped traceability, coming from StrictDoc or spreadsheets) and what's explicitly not yet competitive (ReqIF, review center, test management). That stops the mockup nav (Test Coverage, Reports, notifications) from implying scope you haven't specified.

---

---

## Encode note (2026-10-07)

Dan locked P0-2/3/4/5/7/8 + P1-1/2/4 decisions in the Cyber+QA design room. They are now encoded in `seed/dogfood.yaml` (+ schema/ERD/workflow docs). See `roles/open-questions.md` Cyber+QA table and patch script `seed/scripts/patch_cyber_qa_locked_decisions.py`. This analysis text is retained as the pre-encode critique; treat the seed as SoT for the locked answers.

