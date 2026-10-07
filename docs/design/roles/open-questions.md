# Open questions (need Dan’s input)

Do **not** invent product policy for these. Encode only after an explicit answer.

**Workflow lock (2026-10-07):** See `roles/workflow-system.md` (**status: encoding**). The following are **locked and encoded** in `seed/dogfood.yaml` — do not treat as still open:

| Former § | Locked answer |
|----------|----------------|
| §1 Approver role | Project/client **RoleBinding** on WorkflowProfile (not hard-coded Client admin vs AO). Commercial dogfood binds `stakeholder` → Client admin; DoD example may bind AO / Project admin. |
| §2 Approval grain | **Line** (`ApprovalRecord`); pin `approved_version_uid` + `approved_statement_hash`. Version `stakeholder_approval` = dual-write mirror. |
| §3 Revoke on `.N` | **Mint-kind aware** (ARCH-MINT-KIND): `content` clears + `planning_blocked`; `pin` clears (+ locked migrate `gate_signoff` then re-approve); `status`/`security_meta` do **not** clear. `statement_hash` = statement body only. Content same-hash blocked (`FIX-DENY-NOOP-CONTENT`; aligns `FIX-DENY-NOOP-SUCCESSOR`). |
| §4 Verification → ship | `verification_outcome` first-class; ship via configurable Gate `gate-verification-ship` (not soft-only dismiss). Commercial default leaves gate disabled. |
| §5 Change-set retention + revert | **Retain forever**. Stack policy: **only the latest** non-abandoned change set may be reverted (`gate-revert-latest-only` / `FIX-DENY-REVERT-NON-LATEST`). Never revert an entire older set unless that set **and everything after it** are abandoned. Field-level history undo = future want (`WANT-CHANGESET-FIELD-UNDO`) — not current behavior. |
| §6 Planning gate breadth | **Profile-configurable** (`planning_gate_actions`) — not priority-only forever. Commercial default: D08 only; DoD example broader. |
| §7 Gantt vs backlog | **Both** are full product requirements (ARCH-GANTT / G07 + ARCH-BACKLOG / G04 / K01). Do not mark defer or v1-only cut. |

Also locked from **Cyber+QA design room** (encoded 2026-10-07) — see `roles/product-analysis-first-round.md` P0/P1 decisions:

| Topic | Locked answer |
|-------|----------------|
| Hash + status | `statement_hash` = body only; mint kinds `content\|status\|pin\|security_meta`; noop gate = content only; ≤1 active; D04 prior→in-place `superseded`; terminal obsolete/withdraw in-place or status-only `.N`. |
| Approval-clear downstream | Retain priority/grooming/iteration; `planning_blocked` until re-approve; D08 denied while blocked; do **not** auto-drop contract/release — mark **suspect**; bootstrap `imported_approved`. |
| Suspect links (R1) | `trace_suspect` on edges + in_scope_of/delivers on **content** `.N`; queue carry/keep-pinned/drop; role defaults Author / Security / Author+Release mgr. |
| ConformsTo authority | Tree wins: Author **request**; Security (standards) / Steward (non-standard) **apply**; `conformance_pin_request` + `conforms_to_applicator` slot; AO approve-only on locked migrate. |
| Approve wiring | `gates_before` includes `gate-approver-slot`; verbs `requirement:line:approve` / `capability:line:approve`. |
| gate_signoff | Cyber ship + locked migrate slot records (`ARCH-GATE-SIGNOFF` / `FIX-DENY-SHIP-UNSIGNED`). |
| L02 golden | `{A01, A02}` only — catalog UIDs never in `in_scope_of`. |

Also locked from **Dan, 2026-10-07 (auth foundation)**, encoded in `seed/patch_auth_foundation_encode.py`:

| Topic | Locked answer |
|-------|----------------|
| Dev identity (former §2) | **Internal OAuth.** ReqAML runs its own OAuth 2.1 AS (ARCH-AUTH-AS), which is also needed for MCP. Dev uses **seeded dev local accounts** on that AS (ARCH-DEVENV-IDENTITY.1). There is no third-party OIDC stub container. Production ships no dev accounts or default credentials. |
| Token issuer | One internal AS serves UI, API, and MCP. External SSO federates upstream through it (ARCH-AUTH-FEDERATION). PKCE is S256 only. RFC 8414 + 9728 + 8707 apply, and there is no token passthrough. DCR is off by default. |
| Build order | Platform shell + auth comes first (ARCH-BUILD-FOUNDATION / `rel-r1-foundation-shell-auth`). This is sequencing only, with no v1 scope cut. |
| Key store | **OpenBao (Transit)** is the default KeyProvider for dev and is suitable for prod. **SoftHSM2** is optional, for testing the PKCS#11 path only. HashiCorp Vault (BUSL) and LocalStack KMS are **not** defaults (ARCH-KEY-PROVIDER). |
| Containers | Run as few containers as possible: **one Dockerfile**; **one app container** (API+AS, Web UI, MCP, sync; roles via `REQAML_ROLES`); **one peripherals container** in dev (Postgres + OpenBao). Hybrid mode = peripherals container + native app. Production splits Postgres and OpenBao to isolate keys from data (ARCH-DEPLOY-MINIMAL / ARCH-DEPLOY-PERIPHERALS). |

Also locked from workflow design (encoded):

- **Approve** = line + direct children; **Approve Tree** = full descendants.
- Caps **Satisfies-at-create** (no orphans); CapabilityLine approval enough for solution; Satisfies edge not separate approve subject by default.
- Approver slots profile-configurable (many / one / contract-specific).
- Cyber / verification / ship = Gates under WorkflowProfile (`cyber_gate` = example instance trigger).

Each remaining item: question, options if clear, why it blocks encoding.

---

## 1. Field-level history undo (future want — details TBD)

**Status:** Encoded as **want** only (`WANT-CHANGESET-FIELD-UNDO`, `grooming_state=want`). Stack whole-set policy is locked; this does **not** reopen mid-stack whole-set revert.

**Question (when prioritized):** Which fields/subjects are undoable from history, what UX confirms the undo, and how does it interact with ApprovalRecord pins / shipped delivers / closed contracts?

**Why it blocks (later):** Engine + FIX beds for field undo — not needed for current M07 latest-only / abandon-suffix path.

---

## 2. Local OIDC stub for developer identity — **RESOLVED (2026-10-07)**

**Answer (Dan):** Use internal OAuth: "We will need that for mcp anyway." There is no third-party stub. Dev sign-in uses seeded dev local accounts on the internal AS. Encoded as `ARCH-DEVENV-IDENTITY.1`, `ARCH-AUTH-*`, and `FIX-DENY-DEVENV-PROD-LOGIN.1`; also moved to the locked table above.

---

## 3. StrictDoc export service in Compose?

**Status:** Open. The L2 logical containers are now Web UI, API (+AS), MCP server, Sync worker, Postgres, and OpenBao. StrictDoc export is an IO capability (`SEC-IO` / L02), not a C4 container. The minimal-container decision (ARCH-DEPLOY-MINIMAL) favors adding export as an app **role** rather than a new container.

**Question:** Should StrictDoc export be an in-process app role / on-demand API path (fits minimal containers), or a separate sidecar container?

**Why it blocks:** Adding a Compose service invents a container the L2 diagram does not show until Dan confirms.

---

## 4. Node package manager for hybrid mode

**Status:** Open. Hybrid mode runs the native Node app with hot reload against the peripherals container (`ARCH-DEVENV-MODES.1`).

**Question:** Which Node package manager is the supported hybrid-mode workflow (npm, pnpm, or yarn)?

**Why it blocks:** Clone-to-running docs and any `packageManager` / lockfile conventions in the repo should match one choice.

---

## 5. Local password accounts in production; A01 / REQAML-SEC-SSO wording

**Status:** Open. Local accounts plus the credential store are encoded (ARCH-AUTH-LOCAL, ARCH-CRED-*), and dev seeds them. A01 .0 still says "no local password store exists", and `REQAML-SEC-SSO` is titled "Enterprise SSO only (no local passwords)". I did **not** mint A01.1 / CAP-SSO.1 because content `.N` would clear `ar-a01` (approved) and suspect R0 delivers and contracts. Instead I added `refines` edges from ARCH-AUTH-AS / ARCH-AUTH-FEDERATION / ARCH-DEVENV-IDENTITY.1.

**Question:** Are local password accounts allowed in production (for example, for clients without an IdP, or as a break-glass admin), or are they dev/test only with production federation-only? If allowed, should A01.1 / CAP-SSO.1 be minted and REQAML-SEC-SSO retitled, accepting the approval-clear and suspect ripple?

**Why it blocks:** It decides whether ARCH-AUTH-LOCAL is enabled in production and whether the approved A01 line must be re-approved.

---

## 6. Commercial vs DoD security presets (password, lockout, timeouts, MFA, FIPS)

**Status:** Open. The requirements state configurable parameters with DoD presets from ASD STIG (for example, lockout 3 in 15 minutes, 15-character passwords, 15/10-minute idle timeouts, MFA for privileged roles, FIPS 140 mode).

**Question:** What are the **commercial default** values? Specifically: password length/complexity, lockout threshold and window, idle and absolute timeouts, whether MFA is required for **non-privileged** users, and whether FIPS mode is on by default.

**Why it blocks:** Seed config defaults, FIX thresholds beyond the DoD preset, and the `ARCH-KEY-FIPS` / `ARCH-CRED-HASH` algorithm default (Argon2id vs PBKDF2).

---

## 7. MFA factor types and the privileged-role list

**Status:** Open. ARCH-CRED-MFA requires MFA for privileged roles. Encoded examples: Project admin, Client admin, Security, AO, Key custodian, Catalog steward.

**Question:** Which factors are supported (TOTP, WebAuthn/passkeys, both)? Is the privileged-role list above correct, and should Release mgr be included?

**Why it blocks:** MFA enrollment UX and FIX coverage.

---

## 8. Production OpenBao hosting on Render; unseal method; HSM requirement

**Status:** Open. OpenBao Transit is the locked default KeyProvider. Production topology keeps it separate from Postgres (ARCH-DEPLOY-PERIPHERALS).

**Question:** How does production OpenBao run on Render (private service with a persistent disk? another host?), and how is it unsealed: auto-unseal via a cloud KMS, or Shamir shares held by Key custodians? Does any client require a hardware HSM (FIPS 140 Level 3), which would make the PKCS#11 provider mandatory for that deployment?

**Why it blocks:** Production deployment runbook, the ARCH-KEY-BREAKGLASS procedure, and whether the PKCS#11 path is v1-critical.

---

## 9. Access token format

**Status:** Open.

**Question:** JWT access tokens (RFC 9068, verified locally via JWKS, as drawn in KS02), or opaque tokens + introspection (as drawn in the original MC01)? Or JWT for API/MCP with opaque refresh tokens (the current encoding)?

**Why it blocks:** The revocation latency model (FIX-DENY-REVOKED-TOKEN) and the MC01 → MC01.2 diagram refresh.

---

## 10. MCP → API downstream credential

**Status:** Open. No token passthrough is locked. The MCP server calls business logic as the principal.

**Question:** Should the MCP role call the API with an RFC 8693 token exchange (aud=API, on behalf of the user), or by in-process service calls (possible because both roles share the app container)?

**Why it blocks:** It determines whether a split MCP container (later) needs token exchange from day one.

---

## 11. Client ID Metadata Documents (CIMD) default

**Status:** Open. Pre-registered clients are the baseline. DCR is off by default. CIMD is policy-gated (the MCP spec makes it a SHOULD).

**Question:** Should CIMD be **on** by default with a domain allowlist (easier onboarding for Cursor and other hosts), or off until an admin enables it?

**Why it blocks:** The AS metadata default and the onboarding docs for MCP hosts.

---

## 12. Production topology tradeoffs (minimal containers)

**Status:** Open (tradeoff). Dan's locked rule is "as few containers as possible ... where it makes sense." Encoded: dev = 2 containers (app + peripherals); prod reference = 3 units (app, Postgres, OpenBao), because the KEK store must not share a compromise domain or backup set with the database it protects.

**Question:** (a) Do you accept the separate Postgres and OpenBao units in production, or do you want a single peripherals container for small deployments as well (which weakens key/data separation)? (b) Should production use **Render managed Postgres** instead of a self-run container?

**Why it blocks:** The production Render blueprint and the FIX for the production unit count.

---

## 13. Single process vs supervisor in the app container

**Status:** Open (tradeoff). ARCH-DEPLOY-MINIMAL allows either one Node process hosting every role, or a lightweight supervisor (for example s6-overlay, tini plus a small manager) running per-role processes.

**Question:** Which do you prefer? One process is simplest but couples crash domains (a sync crash takes down the API). A supervisor isolates roles but adds a component.

**Why it blocks:** Dockerfile entrypoint and health/readiness wiring.

---

## 14. Foundation release dates and cyber gate

**Status:** Open. `rel-r1-foundation-shell-auth` is planned, with `planned_on: null` and `cyber_gate` unset.

**Question:** What is the target date, and should the foundation release be cyber-gated (Security sign-off + AO approve)? It is the auth/key slice, so the gate seems likely, but that is your call.

**Why it blocks:** G61 ship gating and Gantt placement.

---

## 15. Additional STIG / SRG catalogs (follow-up)

**Status:** Open (follow-up). sdoc-intake currently has only **ASD STIG V6R4** (`catalog/asd-stig-v6r4.sdoc`) plus NIST 800-53 Rev5. There is no XCCDF → .sdoc import tooling in the repo, so no other STIG IDs were pinned.

**Question:** Should these be imported (and an XCCDF importer built): **PostgreSQL STIG / Database SRG** (Postgres credential and audit settings), **Container Platform SRG / Docker Enterprise STIG** (one-Dockerfile images), **Web Server / Application Server SRG** (app container TLS and headers), and possibly an OpenBao/Vault-equivalent guide?

**Why it blocks:** ConformsTo pins on ARCH-DEPLOY-*, ARCH-KEY-PROVIDER, and ARCH-CRED-AUDIT database settings stay NIST + ASD only until the catalogs exist.

---

## Encoded assumptions (not open — for contrast)

These were encoded with documented locked policy:

- Approver = **RoleBinding** (commercial seed: Client admin on stakeholder / solution_approver slots).
- Approval SoT = **ApprovalRecord on line**; version mirror dual-write; activate (D04) ≠ approve (D12/D13).
- Priority (D08) requires line approval (or `imported_approved`) and not `planning_blocked`; other planning gates = profile `planning_gate_actions`.
- `verification_outcome` first-class; ship gate configurable under WorkflowProfile.
- Change sets retained forever; **latest-only** whole-set revert; abandon-suffix for older whole sets; field undo = want (`WANT-CHANGESET-FIELD-UNDO`).
- `cyber_gate` on release triggers `gate-cyber-ship` when profile enables it; Security + AO slots via `gate_signoff`.
- Locked for migrate is **derived** (non-draft ∧ (in_scope ∨ delivers)); locked migrate = `mint_kind=pin` + signoff + re-approve.
- No orphan capabilities; Satisfies at create; CapabilityLine approve accepts solution.
- ≤1 active per line; prior active → `superseded` in-place on D04.
- Mint kinds + suspect queue + ConformsTo request/apply as locked above.
- Developer environment (2026-10-07): Docker Compose is the single supported dev entry point; hybrid + full-container modes; clone-to-running; migrations + dogfood seed (idempotent); local identity stub disabled in production; no secrets committed; deploy Dockerfile parity; Compose health/readiness (`SEC-DEVENV` / `ARCH-DEVENV-*`). Dev identity resolved as internal OAuth (§2). StrictDoc-in-Compose (§3) and the package manager (§4) remain open.
- Auth foundation (2026-10-07): internal OAuth 2.1 AS (`ARCH-AUTH-*`), credential store (`ARCH-CRED-*`), key store with OpenBao Transit default (`ARCH-KEY-*`), minimal containers (`ARCH-DEPLOY-*`), deployment-scoped Key custodian (`kim-key-custodian`, `platform_grants`), and build order (`SEC-BUILD` / `ARCH-BUILD-FOUNDATION`). Open items are §5–§15.
