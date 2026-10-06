# User-action sequence workflow

Sequence diagrams document **who does what**, **RBAC operations**, and **why each step exists** for compliance (NIST 800-53, STIG / ASD V6R4, and other drivers).

## Loop (per action)

1. **Pick** an action in [`sequences/INDEX.md`](./sequences/INDEX.md).
2. **Lock RBAC** operation name with product/security (INDEX column `RBAC op`).
3. **Identify controls** — which NIST families and STIG rules does this action touch? Fill `Primary control families` in INDEX when known.
4. **Author** `sequences/{ID}-{slug}.puml`:
   - `!include ../includes/C4_Sequence_Macros.puml`
   - Declare participants via `C4Seq_*` (see [`includes/README.md`](./includes/README.md)).
   - After each security-relevant message, call **`ControlNote(alias, nist, stig, why)`**.
   - Use **`ComplianceNote`** for non-NIST drivers (retention, Marsy's Law, contractual clauses).
5. **Companion markdown** (required before **locked**):
   - `{ID}-{slug}.md` with table **Step | Control | Rationale** mirroring the diagram.
6. **Review** with security: pin STIG IDs from catalog; replace `TBD (ASD V6R4)` placeholders.
7. **Mark** INDEX status: `stub` → `draft` → `locked`.

## Compliance rules (non-negotiable)

| Artifact | Requirement |
|----------|-------------|
| `.puml` | Every security-relevant step has a `ControlNote` or `ComplianceNote` (no silent auth/audit/RBAC steps). |
| `.md` companion | Full **Step \| Control \| Rationale** table; same story as the diagram. |
| INDEX | RBAC op + primary control families filled when locking. |
| STIG | Real rule IDs when mapped; otherwise explicit `TBD (ASD V6R4)` until catalog mapping lands. |

## Example

[A01 Sign in via SSO](./sequences/A01-sign-in-sso.puml) + [companion table](./sequences/A01-sign-in-sso.md) — IA / AU / AC families, federated auth, audit export to OTEL.

## Render

See [`includes/README.md`](./includes/README.md). Prefer `pnpm run diagrams:render` from repo root after PlantUML is installed locally.
