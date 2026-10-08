# ReqALM — dogfood seed

Design-our-system-with-our-system: this folder holds a **YAML bootstrap** that mirrors the ReqALM product schema (locked 2026-10-06 ERD) and models *ReqALM itself* (the requirements/ALM product that replaces StrictDoc-as-store).

## Why YAML

- **Human-editable** — authors can draft trees, contracts, and edges without a UI yet.
- **Git-diffable** — line-oriented reviews; no binary store.
- **1:1 with future Postgres / OpenAPI** — same entities as `c4/data-erd.puml` (`client` → `project` → `requirement_line` / `requirement_version`, plus catalogs, contracts, releases, edges).
- **StrictDoc is interchange only** — `.sdoc` export is for tools that still want StrictDoc; ReqALM’s store is not StrictDoc.

## Mental validation checklist

1. Every `requirement_version.uid` is either `base_uid` (first / `.0`) or `base_uid.N` with matching `version_n`.
2. Every `requirement_line.parent` is a **line** `base_uid` (or null), never a version UID — no cascade fork.
3. ≤1 `active` per line; D04 activate sets prior active → in-place `superseded`. Terminal obsolete/withdraw without replacement may be in-place (or status-only `.N`).
4. `contract.in_scope_of` and `release.delivers` list **version UIDs** (junctions), not tree parents.
5. `edge.from` / `edge.to` are version UIDs **or** (for `conforms_to`) external catalog item UIDs (`AC-3`, `V-222536`, …); `conforms_to` to a catalog item also requires `catalog_imprint_id` (pin = imprint + item UID). `kind` ∈ `refines|conforms_to|uses|satisfies` (StrictDoc emits PascalCase `Refines|ConformsTo|Uses|Satisfies`).
6. Standard catalogs are versioned as `catalog_imprints[]` (library revision + import identity). New imprint import does **not** auto-retarget live pins; mark `catalog_drift` for review.
7. Migrate-to-imprint (H10): mandatory preview; locked → successor `.N`; draft → in-place after accept; gate + audit.

Optional: validate structure with JSON Schema after YAML→JSON:

```bash
python3 -c "import json,yaml; print(json.dumps(yaml.safe_load(open('dogfood.yaml'))))" \
  | python3 -c "import json,sys; json.load(sys.stdin)"  # smoke parse
# then: ajv / check-jsonschema against reqseed.schema.json if installed
```

The converter’s `--validate` flag checks UID/parent rules without requiring a JSON Schema engine.

## Converter (StrictDoc interchange)

```bash
cd /workspace/requirements-product-diagrams/seed
python3 scripts/yaml_to_strictdoc.py --in dogfood.yaml --out out/ --validate
```

Defaults: `--in` = `dogfood.yaml` next to the script’s parent (`seed/`), `--out` = `seed/out/`.

Requires **PyYAML** (`pip install pyyaml` or `pip install --user --break-system-packages pyyaml` on PEP 668 hosts).

StrictDoc is a **dense interchange view** until ReqALM exists — the converter prefers structured `RELATIONS` over COMMENT-only links:

- Semantic `edges` → `Parent` + ROLE (`Satisfies|ConformsTo|Uses|Refines`) when acyclic; cycle-breakers → `Child` + same ROLE (not dropped to COMMENT).
- Contract `in_scope_of` / release `delivers` → `Parent` + `InScopeOf` / `Delivers` on `contracts-releases.sdoc` (first-class). Reverse children show on requirements in the StrictDoc graph/UI.
- Default also writes `Child` + `InScopeOf`/`Delivers` on each requirement version (densest `.sdoc`). StrictDoc 0.30 normally asserts when both ends declare the same ROLE; this box’s StrictDoc `many_to_many_set.create_link` is patched to be idempotent so dense dual-declare exports cleanly. Use `--no-child-membership` for an unpatched StrictDoc.

Output:

- `out/requirements.sdoc` — sections + requirements / controls / capabilities
- `out/contracts-releases.sdoc` — contracts & releases with Parent InScopeOf/Delivers RELATIONS
- `out/MANIFEST.md` — file list and counts

## Security catalogs (Northline pattern + imprint pins)

Full StrictDoc catalogs (control text) live beside the seed and are served by StrictDoc next to requirements:

| File | YAML imprint id | Source |
|------|-----------------|--------|
| `catalog/nist-800-53.sdoc` | `nist-800-53@rev5-dogfood-20261006` | NIST SP 800-53 Rev 5 (UIDs `AC-3`, `IA-2`, …) |
| `catalog/asd-stig-v6r4.sdoc` | `asd-stig@v6r4` | ASD STIG V6R4 (UIDs `V-222536`, …) |

Copy into StrictDoc input as `reqalm-strictdoc/input/catalog/`. Product / capability / fixture versions **ConformsTo** those catalog item UIDs **through a catalog imprint** (`catalog_imprint_id` + `to` item UID); they do **not** copy control text. Synthetic `CTL-*` requirement lines were removed in favor of real catalog UIDs.

YAML `catalogs[]` holds **project** `REQALM-SEC-*` entries (steward-mutable without imprint until publish) plus pointers for NIST/STIG. `catalog_imprints[]` records published standard library revisions. Standards always require imprint publish (H03 / ARCH-CAT-SCOPE). New imprint import diffs by item UID and does **not** auto-retarget live pins (ARCH-CAT-IMPORT); affected versions get `catalog_drift` for review (ARCH-CAT-DRIFT / ARCH-CAT-REACT). **Migrate to imprint** (H10 / ARCH-CAT-MIGRATE): scoped dry-run preview then apply; locked pins only via successor `.N`; drafts may retarget in place after accept; Steward/Security gate + audit.

Promote note/ref IDs → edges (pins imprint automatically):

```bash
python3 scripts/promote_security_conforms_to.py   # expands AU-2/3/12; aliases REQALM-SEC-* → real UIDs
python3 scripts/patch_catalog_imprints.py         # idempotent: imprints + pin + ARCH-CAT-* (if needed)
python3 scripts/patch_catalog_migrate.py          # idempotent: H10 + ARCH-CAT-MIGRATE (preview/.N/draft)
python3 scripts/yaml_to_strictdoc.py --validate
python3 scripts/patch_catalog_reverse_conforms.py # Child ConformsTo on catalog nodes (idempotent)
# then sync out/*.sdoc + catalog/*.sdoc → reqalm-strictdoc/input/
```

Re-run `patch_catalog_reverse_conforms.py` after re-copying catalogs from sdoc-intake so reverse links are not wiped.

## Coverage

`dogfood.yaml` dogfoods **ReqALM itself** against `../user-actions.md` (groups **A–N**, **105** actions), plus the **Cyber+QA minimal cut** (denial actors, FIX-* fixtures, STIG, audit samples).

| Entity | Count (approx.) |
|--------|----------------:|
| requirement_lines | 331 (sections + req/capability; + 17 PR-release CapabilityLines (12 delivered by PR #12, 5 planned for the next PR); + ARCH-AUTH/CRED/KEY/DEPLOY/BUILD + local-optional/upstream + ARCH-DEVENV-* + ARCH-MINT/SUSPECT/GATE-SIGNOFF + Cyber+QA and auth FIX beds) |
| requirement_versions | 343 (incl. the 17 capability versions; FIX-SUCC-2HOP/DEVENV/AUTH-LOCAL content successors `.1`; + auth foundation + local-optional/upstream ARCH/FIX) |
| edges | 1451 (conforms_to + uses/satisfies/refines; + auth foundation + local-optional/upstream NIST/ASD pins + suspect detect bed) |
| catalog_imprints | 2 (`nist-800-53@rev5-dogfood-20261006`, `asd-stig@v6r4`) |
| contracts | 5 (Design-2026-10, Security package, Platform baseline, **Legacy intake closed**, Fixture doc-walk) |
| releases | 5 (R0-sequences **shipped**; **PR #11 planning baseline shipped** (docs only, delivers nothing); **PR #12 devenv foundation planned** (until merge); **R1-foundation-shell-auth planned** = next PR (UI frame + internal auth); R1-core-ALM **planned** — includes obsolete `ARCH-CONTRACT` for stale-backlog UX) |
| identities / grants | 13 / 11 project + 1 client_grant + 1 platform_grant (incl. jordan Auditor, morgan steward, **pat-client-admin**, **jamie-ao**, **drew-developer**, **kim-key-custodian** (deployment-scoped Key custodian via `platform_grants`), no-grant-user, tombstone `grant-alex-author-revoked`) |
| catalog_steward_grants | 1 (`steward-morgan-reqalm-project` on `cat-reqalm-security`) |
| clients (extra) | 1 (`other-family` — cross-client denial; no projects/grants into reqalm) |
| audit_events | 50 (prior + mint/suspect/pin/approve/signoff + auth/key + upstream-logout/agent-attribution samples; deployment-scoped key ops have null client/project) |
| change_sets | 3 (1 leaf, 1 SDLC parent + 1 nested leaf) |
| work_item_links | 2 (FIX-SAMPLE-APPROVED, A01) |
| catalog entries | 9 project `REQALM-SEC-*` (incl. OAUTH / CRED / KEYS) only; NIST/STIG via imprints → `catalog/*.sdoc` |
| iterations | 3 (R0 / R1 / R2) |
| capability_artifacts | 74 (sequences A01–A08/MC*/AS*, C4 L1–L3/ERD, mockups **01–04**, auth design notes; PR #12 capabilities point at repo files such as `Dockerfile`, `scripts/devenv-smoke.mjs`, `apps/reqalm/openapi/openapi.yaml`) |

### Sections

| Section | Focus | Action UIDs |
|---------|-------|-------------|
| SEC-IA | Identity & access | A01–A12, ARCH-AUTH-AS/PKCE/METADATA/AUDIENCE/REFRESH/REVOKE/CLIENTREG/FEDERATION/LOCAL.1/PROFILE/MCP-REQUIRED/LOCAL-BREAKGLASS/UPSTREAM-CONNECTOR/CLAIM-MAP/UPSTREAM-REVOKE/AGENT-ATTRIBUTION |
| SEC-CP | Client & project | B01–B08, ARCH-CP-* |
| SEC-RL | Lines & versions + approval/verification | C01–C08, D01–D12, ARCH-VER-*, ARCH-APPROVAL, ARCH-VERIFICATION |
| SEC-EDGE | Traces | E01–E07 |
| SEC-CT | Contracts | F01–F10, ARCH-CONTRACT* |
| SEC-REL | Releases | G01–G08, ARCH-RELEASE* |
| SEC-CAT | Catalogs + imprint architecture | H01–H10, ARCH-CAT-IMPRINT/PIN/IMPORT/DRIFT/REACT/FREEZE/SCOPE/MIGRATE |
| SEC-CAP | Capabilities & artifacts | I01–I06, CAP-TREE/CONTRACT-UI/VERSION-UI |
| SEC-WI | Work items & sync | J01–J08 |
| SEC-GROOM | Grooming | K01–K06 |
| SEC-IO | Import / export | L01–L04 |
| SEC-AUDIT | Audit & ops + change sets | M01–M07, ARCH-CHANGESET*, CAP-AUDIT |
| SEC-UI | UI architecture + chrome | N01–N03, ARCH-UI* |
| SEC-API | API architecture | ARCH-API*, ARCH-OTEL |
| SEC-SEC | Security / RBAC + credential & key stores | CAP-SSO/SCOPED-VIEW/RBAC; ARCH-CRED-* (HASH/POLICY/LOCKOUT/MFA/TOKENS/SESSION/REAUTH/AUDIT); ARCH-KEY-* (PROVIDER/SCOPE/JWKS/LIFECYCLE/CUSTODIAN/BREAKGLASS/FIPS/FAILCLOSED); product ConformsTo catalog `AC-*`/`AU-*`/`IA-*`/`SC-*`/`CM-*`/`SI-*` + STIG `V-*` |
| SEC-MCP | MCP desks | MC01–MC03, CAP-MCP-DESK |
| SEC-FIX | Cyber+QA fixtures (test beds) | FIX-DENY-*, FIX-ALLOW-*, FIX-COMPARE-2HOP, FIX-EXPORT-L02-GOLDEN, FIX-SUCC-2HOP, FIX-CONTRACT-DOC-*, FIX-REL-SNAP, FIX-DENY-NOOP-CONTENT, FIX-*-SUSPECT-*, FIX-*-PIN-*, FIX-*-APPROVE-*, FIX-DENY-SHIP-UNSIGNED, FIX-*-DEVENV-*, auth/cred/key beds (FIX-*-MCP-*, FIX-DENY-PKCE-PLAIN, FIX-DENY-LOCKOUT, FIX-DENY-REFRESH-REUSE, FIX-*-KEK-*, FIX-JWKS-ROTATION-OVERLAP, FIX-DENY-KEYOP-NO-CUSTODIAN, FIX-ALLOW-DEVENV-MIN-CONTAINERS, FIX-ALLOW-APP-ROLE-SPLIT), … |
| SEC-WF | Workflow + Cyber+QA locked ARCH | ARCH-WORKFLOW…, ARCH-MINT-KIND, ARCH-SUSPECT, ARCH-SUSPECT-QUEUE, ARCH-GATE-SIGNOFF |
| SEC-DEVENV | Developer environment & deployment topology | ARCH-DEVENV-COMPOSE.1/MODES.1/CLONE/SEED/IDENTITY.1/SECRETS/PARITY.1/HEALTH/KEYS; ARCH-DEPLOY-MINIMAL/PERIPHERALS; FIX-ALLOW-DEVENV-SMOKE, FIX-DENY-DEVENV-PROD-LOGIN.1, FIX-ALLOW-DEVENV-SEED-IDEMPOTENT |
| SEC-BUILD | Build sequencing (no scope cut) | ARCH-BUILD-FOUNDATION (shell + auth first slice; `rel-r1-foundation-shell-auth`) |

### Cyber+QA minimal cut

Denial / multi-tenant seed (schema-compatible; root `additionalProperties` + optional props in `reqseed.schema.json`):

- **Identities:** `jordan-auditor` (`oidc:jordan-auditor`), `morgan-steward`, `no-grant-user` (linked IdP, **zero** `project_grants`). Existing dan / casey Reader / alex / etc. kept.
- **Grants:** `grant-jordan-reqalm-auditor` → Auditor; Casey stays Reader (deny-write); tombstone `grant-alex-author-revoked` with `status: revoked` + `revoked_at`.
- **Steward:** `catalog_steward_grants` → `steward-morgan-reqalm-project` on `cat-reqalm-security` (not NIST global).
- **Second client:** `clients[]` → `other-family` (Other Family) with no projects/grants into reqalm.
- **FIX-DENY-\*:** Reader grant-create, cross-client read, steward-on-standard, MCP escalate (pairs MC03), no-grant read, revoked write — each stamped `rbac_op` + `security.catalog_ref` + `verification_note`.
- **Controls / STIG:** Real NIST/ASD catalogs under `seed/catalog/`; product edges ConformsTo `AC-6`, `AU-6`, `V-222550`, etc. YAML NIST/STIG stubs removed (pointers only); `cat-reqalm-security` keeps `REQALM-SEC-*`. `security.catalog_ref` uses bare ids (`AC-3`, not `NIST-AC-3`); notes with `AU-2/3/12` expand to AU-2+AU-3+AU-12.
- **Succession:** `FIX-SUCC-2HOP` .0 obsolete → .1 obsolete → .2 active; edge still targets obsolete `.1`.
- **Contracts / releases:** `FIX-CONTRACT-DOC-NOCTX` / `FIX-CONTRACT-DOC-CTX` (expected UID sets); one contract `status: closed`; `FIX-REL-SNAP` asserts R0 freeze immutable + planned R1 stale obsolete UID.
- **audit_events:** sample deny/allow rows for the fixtures above.
- **L02 StrictDoc golden:** `seed/fixtures/L02-contract-fixture-doc-walk.{sdoc,uids.txt,expected.json}` — `.sdoc` golden pair exists for contract-fixture-doc-walk with context parents off (UID set `{A01, A02}`; see `fixtures/README.md`).

Backup: `dogfood.yaml.bak-catalog` (NIST/STIG catalog import). Prior: `dogfood.yaml.bak3` / `.bak2`. No git commit from this cut.

Regenerate from the table-driven builder (optional): `python3 scripts/gen_expanded_dogfood.py` then re-apply Cyber+QA cut (or merge) and re-run the converter with `--validate`. The generator does **not** yet emit the Cyber+QA fixtures — prefer editing `dogfood.yaml` directly for this cut.

## Releases = PRs (keep the seed in step with development)

For now **each pull request is one release** (`releases[]`, id `rel-pr<N>-<slug>`), and the seed models ReqALM's real development, not only its design:

- **Every dev PR updates `dogfood.yaml` in the same PR:** add or update its release (status `planned` while open; flip to `shipped` with `shipped_on` and the merge SHA in `notes` once merged; PR URL in `notes`), and add CapabilityLines for what it actually built.
- **Capabilities follow the locked workflow rules:** born with `satisfies` edges to the requirement versions they meet (gate-satisfies-at-create), a line `ApprovalRecord` (`unapproved` until Dan approves the solution; activate ≠ approve), `security.verification_note` with the evidence, `capability_artifacts` pointing at the code/docs, and `verification_outcome: pass` only when verified. Planned work stays `status: draft` with no outcome.
- **`delivers` lists what the release fully meets** (capabilities, requirement versions, fixture beds). A requirement met only in part stays in the release that completes it; the partial contribution shows as the capability's `satisfies` edge. Move fully met versions out of later planned releases (see `rel-r1-foundation-shell-auth` notes).
- Patch with an idempotent script (`scripts/patch_release_per_pr_encode.py` is the model), then `python3 scripts/yaml_to_strictdoc.py --validate` and commit `out/` with the YAML.

**Import-ready:** this seed is intended to be the **first project imported into ReqALM** once auth lands (ReqALM manages its own requirements). Keep it schema-valid (`reqseed.schema.json`) and loadable by the app (`pnpm reqalm:seed`; `/api/v1/seed/summary` lists releases and capability counts). The dev seed loader currently stores clients, projects, identities, grants, requirement lines/versions (including capabilities) and releases with their `delivers`; edges, contracts, approvals, catalogs, audit and workflow rows are not loaded yet, and only releases are updated in place on re-seed (other rows are insert-if-absent). To realign an existing dev database with edited YAML without destroying auth data, use `pnpm devenv:seed:reset --confirm` (dev-only; see root README).

## Edit loop

1. Edit `dogfood.yaml`.
2. Re-run the converter (optional) for `.sdoc` consumers.
3. **Future:** load the same YAML (or equivalent API payload) into ReqALM’s Postgres store — StrictDoc remains optional export/import only.

Client: `Raby-Family`. Project display name: **ReqALM** (working intake repo often called `sdoc-intake`).

## Source-of-truth note

Canonical design tree for planning: `repos/sdoc-intake/docs/design/` on branch `pr-11`. `/workspace/requirements-product-diagrams/` is a working mirror of `docs/design/` — keep both identical after seed edits.

### 2026-10-07 encoding pass (approval / change sets / cyber gate)

Additive dogfood: stakeholder approval (≠ D04 activate), change_sets + work_item_links, grooming_state, catalog_drift sample, release.cyber_gate, thin verification_outcome, AO+Developer grants. Open policy questions: `../roles/open-questions.md`. Backup: `dogfood.yaml.bak-pre-approval-changeset`.
