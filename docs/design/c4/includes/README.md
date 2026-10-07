# C4 sequence diagram include library

Reusable PlantUML fragments for **user-action sequence diagrams** (RBAC + system flow + compliance rationale).

## Files

| File | Purpose |
|------|---------|
| `C4_Sequence_Styles.puml` | Skinparams aligned with C4-PlantUML colors |
| `C4_Sequence_Participants.puml` | Canonical participant aliases + `C4Seq_*` / bundle procedures (incl. `C4Seq_McpHost`, `C4Seq_ReqAmlMcp`, `C4Seq_DeskSocket`, `C4Seq_Bundle_McpDesk`) |
| `C4_Sequence_Controls.puml` | **`ControlNote`** / **`ComplianceNote`** — one place for control annotations |
| `C4_Sequence_Macros.puml` | Flow macros (`RbacCheck`, `AuditLog`, `HookEval`, `GateCheck`, `HookEffectsAfter`, …) — includes the files above |

Container/context diagrams (L1–L3) use remote C4-PlantUML from [plantuml-stdlib](https://github.com/plantuml-stdlib/C4-PlantUML); action sequences use **local** includes only.

## Author a new action diagram

1. Pick the action in [`../sequences/INDEX.md`](../sequences/INDEX.md).
2. Lock the RBAC operation name with product/security (column in INDEX).
3. Create `../sequences/{ID}-{slug}.puml` and optional `{ID}-{slug}.md` companion.
4. Start the `.puml` file:

```plantuml
@startuml A99-example
!include ../includes/C4_Sequence_Macros.puml

title A99 — Short action name

' Declare only needed participants:
C4Seq_User()
C4Seq_WebUI()
' …

' Steps + compliance (WHY each step exists):
seqUser -> seqWebUI : …
ControlNote(seqWebUI, "AC-3", "TBD (ASD V6R4)", "Enforce access decisions at the UI boundary")
```

5. In the companion markdown (recommended for every **locked** diagram), add the authoritative table:

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST IA-2; STIG TBD | Federated authentication via enterprise IdP |
| 2 | NIST AU-2, AU-3, AU-12 | Auditable sign-in success/failure |

Use **real NIST 800-53 Rev. 5** control IDs. Pin **ASD STIG V6R4** (or other STIG) rule IDs when mapped in `data/catalog`; until then use `TBD (ASD V6R4)` in diagrams and INDEX.

### Control annotations (required)

Every sequence diagram must document **why** steps exist:

- **In PlantUML:** call `ControlNote(alias, "NIST ids", "STIG ids", "brief why")` on the participant that owns the control point (right after the message or macro that implements the step).
- **Other drivers** (Marsy's Law, retention policy, contractual logging): `ComplianceNote(alias, "driver list", "why")`.
- **Do not** invent one-off `note` styling per diagram — use these macros only.

Duplicate the same mapping in the companion `.md` so reviewers can diff text without rendering PlantUML.

## Naming

- Diagram file: `{SectionLetter}{nn}-{kebab-slug}.puml` (e.g. `A01-sign-in-sso.puml`).
- `@startuml` id matches filename stem.
- Status in INDEX: `stub` → `draft` → `locked`.

## Render

Requires [PlantUML](https://plantuml.com/) (Java) and network access for **L1–L3** C4 includes only.

```bash
# One action sequence (local includes only)
plantuml -tpng docs/design/c4/sequences/A01-sign-in-sso.puml

# All architecture + sequences under docs/design/c4/
plantuml -tpng docs/design/c4/**/*.puml
```

From repo root (optional):

```bash
pnpm run diagrams:render
```

Output PNG/SVG next to sources unless you pass `-o outdir`.


## ActionHook pipeline macros

Use these instead of copy-pasting the gate/mutate/effects flow (ARCH-WORKFLOW / ARCH-HOOK-EVAL):

| Macro | Role |
|-------|------|
| `RbacCheck(op)` | Permission gate (can attempt) |
| `HookEval(action_id)` | Load profile ActionHooks → `gates_before[]`, `effects_after[]` |
| `GateCheck(gate_id)` | Evaluate one gate; skip optional if disabled on profile |
| `HookEffectsAfter(effects)` | Run post-mutate effects (clear approval, suspect, audit helpers, …) |
| `AuditLog(action, entity)` | Structured audit + OTEL export |

Canonical shared diagram: [`../sequences/WF01-actionhook-eval.puml`](../sequences/WF01-actionhook-eval.puml).
