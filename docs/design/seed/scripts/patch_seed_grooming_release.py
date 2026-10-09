#!/usr/bin/env python3
"""Seed-only grooming: requirements, browse roadmap, security follow-ups, honesty pass.

Adds rel-r1-seed-grooming / CAP-SEED-GROOMING. Does NOT ship rel-r1-relations-api (parallel PR).
Idempotent. Run: python3 patch_seed_grooming_release.py && python3 yaml_to_strictdoc.py --validate
"""
from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
REL_GROOM = "rel-r1-seed-grooming"
CAP_GROOM = "CAP-SEED-GROOMING"
MAIN_CB8 = "cb8a8c97895b651c8f25ce660482e7e5e7ae4454"

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 1200
yaml.indent(mapping=2, sequence=2, offset=0)

stats = {
    "lines_added": 0,
    "versions_added": 0,
    "lines_updated": 0,
    "versions_updated": 0,
    "edges_added": 0,
    "edges_removed": 0,
    "releases_added": 0,
    "status_corrections": 0,
}


def cm(**kw):
    m = CommentedMap()
    for k, v in kw.items():
        m[k] = v
    return m


def statement_hash(text: str) -> str:
    canon = "\n".join(line.rstrip() for line in text.strip().replace("\r\n", "\n").split("\n"))
    return "sha256:" + hashlib.sha256(canon.encode("utf-8")).hexdigest()


def find(seq, key, val):
    for x in seq or []:
        if x.get(key) == val:
            return x
    return None


def upsert_line(data, item, *, parent_kind: str | None = None) -> None:
    cur = find(data.get("requirement_lines"), "base_uid", item["base_uid"])
    if cur is None:
        data.setdefault("requirement_lines", []).append(deepcopy(item))
        stats["lines_added"] += 1
        return
    changed = False
    for k, v in item.items():
        if cur.get(k) != v:
            cur[k] = v
            changed = True
    if changed:
        stats["lines_updated"] += 1


def upsert_version(data, item) -> None:
    stmt = item.get("statement")
    if stmt and "statement_hash" not in item:
        item = dict(item)
        item["statement_hash"] = statement_hash(stmt)
    cur = find(data.get("requirement_versions"), "uid", item["uid"])
    if cur is None:
        data.setdefault("requirement_versions", []).append(deepcopy(item))
        stats["versions_added"] += 1
        return
    changed = False
    for k, v in item.items():
        if cur.get(k) != v:
            cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
            changed = True
    if changed:
        stats["versions_updated"] += 1


def edge_key(edge):
    return (
        edge.get("from"),
        edge.get("to"),
        edge.get("kind"),
        edge.get("catalog_imprint_id"),
    )


def ensure_edge(edges, edge):
    key = edge_key(edge)
    for e in edges:
        if edge_key(e) == key:
            return 0
    edges.append(edge)
    stats["edges_added"] += 1
    return 1


def remove_edge(edges, edge):
    key = edge_key(edge)
    before = len(edges)
    kept = [e for e in edges if edge_key(e) != key]
    removed = before - len(kept)
    edges[:] = kept
    stats["edges_removed"] += removed


def upsert(seq, key, item):
    cur = find(seq, key, item[key])
    if cur is None:
        seq.append(item)
        return 1
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
    return 0


def bump_status_correction():
    stats["status_corrections"] += 1


def add_requirement(
    data,
    *,
    base_uid: str,
    parent: str,
    kind: str,
    title: str,
    statement: str,
    priority: int = 15,
    iteration: str = "iter-r1",
    rbac_op: str | None = None,
    catalog_ref: str = "CM-2",
    verification_note: str = "Groomed 2026-10-09 seed pass.",
    status: str = "active",
    grooming_state: str = "detailed",
    verification_outcome: str | None = None,
):
    line = cm(
        base_uid=base_uid,
        project_id="reqalm",
        parent=parent,
        kind=kind,
        title=title,
    )
    upsert_line(data, line)
    ver = cm(
        uid=base_uid,
        base_uid=base_uid,
        version_n=0,
        status=status,
        statement=statement,
        priority=priority,
        iteration=iteration,
        security={"catalog_ref": catalog_ref, "verification_note": verification_note},
        statement_hash=statement_hash(statement),
        grooming_state=grooming_state,
    )
    if rbac_op:
        ver["rbac_op"] = rbac_op
    if verification_outcome:
        ver["verification_outcome"] = verification_outcome
    upsert_version(data, ver)


def add_capability(
    data,
    *,
    base_uid: str,
    parent: str,
    title: str,
    statement: str,
    satisfies: list[str],
    status: str = "draft",
    verification_note: str = "Planned; not shipped on main.",
    iteration: str = "iter-r1",
):
    upsert_line(
        data,
        cm(
            base_uid=base_uid,
            project_id="reqalm",
            parent=parent,
            kind="capability",
            title=title,
        ),
    )
    upsert_version(
        data,
        cm(
            uid=base_uid,
            base_uid=base_uid,
            version_n=0,
            status=status,
            statement=statement,
            priority=10,
            iteration=iteration,
            security={"catalog_ref": "CM-2", "verification_note": verification_note},
            statement_hash=statement_hash(statement),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id=f"ar-{base_uid.lower().replace('cap-', 'cap-')}",
            subject_kind="CapabilityLine",
            base_uid=base_uid,
            status="unapproved",
            by=None,
            at=None,
            notes=f"Planned capability {base_uid}.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    for to in satisfies:
        ensure_edge(edges, {"from": base_uid, "to": to, "kind": "satisfies"})


def add_planned_release(
    data,
    rel_id: str,
    name: str,
    delivers: list[str],
    notes: str,
    *,
    planned_on: str = "2026-10-06",
):
    existed = find(data.get("releases"), "id", rel_id) is not None
    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=rel_id,
            project_id="reqalm",
            name=name,
            planned_on=planned_on,
            shipped_on=None,
            status="planned",
            delivers=delivers,
            cyber_gate=False,
            notes=notes,
        ),
    )
    if not existed:
        stats["releases_added"] += 1


def patch_verification(uid: str, outcome: str | None, note: str | None = None):
    ver = find(data.get("requirement_versions"), "uid", uid)
    if not ver:
        return
    if outcome is not None and ver.get("verification_outcome") != outcome:
        ver["verification_outcome"] = outcome
        bump_status_correction()
    if note and ver.get("security", {}).get("verification_note") != note:
        ver.setdefault("security", {})["verification_note"] = note
        bump_status_correction()


def patch_statement(uid: str, statement: str):
    ver = find(data.get("requirement_versions"), "uid", uid)
    if not ver:
        return
    h = statement_hash(statement)
    if ver.get("statement") != statement or ver.get("statement_hash") != h:
        ver["statement"] = statement
        ver["statement_hash"] = h
        stats["versions_updated"] += 1


# --- requirement bodies (shall statements) ---

REQ_ACCEPT_FACET = (
    "A requirement version may decompose into one or more acceptance criteria (facets). Each facet shall be "
    "a child requirement line under the parent requirement (or section grouping); facets are not capability lines. "
    "Each facet shall have its own testable 'shall' statement. One or more capabilities or future implementations "
    "may satisfy a facet via satisfies edges; a requirement is complete only when every facet is satisfied."
)
REQ_ACCEPT_ROLLUP = (
    "Requirement completeness shall roll up from acceptance criteria: a parent requirement is satisfied when all "
    "of its facet children are satisfied; a facet is satisfied when at least one linked capability (or verified "
    "implementation) satisfies it. Partial facet satisfaction shall surface as incomplete on the parent."
)
REQ_RECHECK = (
    "A criterion, control, or trace target that was satisfied shall enter a distinct needs re-check state when a "
    "capability that satisfies or conforms to it changes content, loses verification, or is not yet complete. "
    "Needs re-check shall be represented as trace_suspect (and related review queues) distinct from never-satisfied "
    "and from satisfied. Security controls and audit-sensitive traces shall re-check when upstream capabilities change. "
    "A uses dependency change shall flag dependent capabilities for re-check without inheriting controls unless "
    "explicitly modeled."
)
REQ_CAT_REP = (
    "Standard and custom catalogs (NIST 800-53, STIG, project REQALM-SEC-*) shall live outside the project "
    "requirement tree while remaining first-class: imprints, item UIDs, and ConformsTo pins are referenced, not "
    "copied, into project data."
)
REQ_CAT_ROLLUP = (
    "For catalog controls in scope of a project, a control shall show incomplete for the project when any in-scope "
    "capability or requirement relying on that control is incomplete or needs re-check. Rollup shall not require "
    "duplicating catalog text in the project tree."
)
REQ_CAT_PICK = (
    "The user shall choose which catalogs are visible in browse and trace views at the current Scoped View; hidden "
    "catalogs shall not appear in control rollups or two-column catalog views until selected."
)
REQ_TRACE_RTM = (
    "The product shall provide a two-column traceability view with system requirements on the left and capabilities "
    "on the right, joined by satisfies edges (and refines where shown). Selection shall highlight the active path."
)
REQ_TRACE_CCM = (
    "The product shall provide a two-column traceability view with catalog controls on the left and capabilities on "
    "the right, joined by conforms_to edges. Direct ConformsTo pins shall render as solid links; inherited or "
    "aggregated links shall render dashed. Heavy controls (AC-3, AU-2, AU-3, AU-12) shall collapse into bundles "
    "by default with expand affordance."
)
REQ_TRACE_WORKER = (
    "Layout, link aggregation, and rollup math for trace views shall run behind one small TypeScript interface "
    "executed off the main thread (Web Worker). The default implementation shall be plain TypeScript; WebAssembly "
    "shall be used only if measured project sizes require it (lean default)."
)
REQ_HIER_REQ = (
    "Requirement lines may have child requirement lines (decomposition). Child requirements shall roll up "
    "completeness and status into the parent. Requirements shall nest only under requirements or sections, never "
    "under capability lines."
)
REQ_HIER_CAP = (
    "Capability lines may have child capability lines (part-of composition). Child capabilities shall roll up "
    "operational/verification status into the parent. Child capabilities shall inherit the parent's conforms_to "
    "control pins unless a successor capability explicitly replaces them."
)
REQ_HIER_USES = (
    "A uses edge shall model dependency, not ownership: for example a page capability uses a shared header "
    "capability. Uses shall not pass conforms_to controls along the edge unless explicitly annotated. When a used "
    "capability changes, dependents shall be flagged needs re-check (trace_suspect) for trace review."
)
REQ_HIER_SEC = (
    "Section lines shall group siblings only. Section placement shall not imply status rollup, control inheritance, "
    "or satisfies/conforms_to propagation."
)
REQ_UIKIT = (
    "A UI Kit capability shall own shared presentation components (tree, header chrome, badges) as child capabilities. "
    "Feature views (project tree, two-column trace views) shall use the shared tree via uses edges; tree-specific "
    "requirements (keyboard navigation, paging label 'showing 100 of N' when a parent has more than 100 children, "
    "and accessibility) shall be stated once on the tree capability, not duplicated per view."
)
REQ_BROWSE_ROADMAP = (
    "Read-only browse is the current delivery priority for every object type, API first then UI, in this order: "
    "(1) catalogs, imprints, and controls — API capability owned by parallel rel-r1-catalogs-api / CAP-CATALOGS-API; "
    "(2) planning objects: contracts, iterations, change sets; (3) capability artifacts (mocks, OpenAPI, wireframes); "
    "(4) workflow: profiles, gates, action hooks, approvals and sign-offs; (5) people and access: identities, grants, "
    "role bindings with need-to-know visibility; (6) audit events (read view). Relationships browse UI is owned by "
    "parallel rel-r1-browse-ui-relations — do not duplicate here."
)

SEC_EDGE_DEDUPE = (
    "Before the first trace edge write route ships, trace_edges shall enforce uniqueness on "
    "(from_project_id, from_uid, COALESCE(to_project_id,''), to_uid, kind, catalog_imprint_id) so cross-project "
    "peers participate in deduplication."
)
SEC_SEED_BASE_UID = (
    "The dogfood seed loader shall reject a base_uid that appears in more than one project and shall reject "
    "release.delivers entries whose requirement version project_id does not match the release's project_id."
)
SEC_XPROJ_LINK = (
    "Creating a cross-project trace link shall require requirement:read on the target project. Conflict and dedupe "
    "errors shall not reveal edges the caller cannot read."
)
SEC_STUB_DESIGN = (
    "Deliberate design choice: restricted relation stubs from unreadable projects shall reveal the count and kind "
    "of links (incoming/outgoing and relation_kind) without revealing peer ids, titles, or project identifiers."
)
SEC_REL_PAGE = (
    "Relations read responses shall support paging before large real datasets land (page size caps consistent with "
    "other browse APIs)."
)
SEC_CAT_FK = (
    "catalog_defs.project_id shall reference projects(id) with a foreign key when project-scoped catalogs are stored."
)
SEC_LOADER_EDGE_SYNC = (
    "The seed loader shall delete trace_edges removed from the seed document on re-load (sync), not only insert new rows."
)
SEC_CAT_LABEL_KEY = (
    "Catalog item labels shall be keyed per imprint (catalog_imprint_id + item_uid), not per catalog id alone, so "
    "imprint succession does not collide titles."
)
SEC_HEADERS = (
    "Before any non-127.0.0.1 deployment, HTTP responses shall send security headers including Content-Security-Policy "
    "default-src 'self', frame-ancestors 'none', X-Content-Type-Options nosniff, and Referrer-Policy no-referrer. "
    "Request logs shall record the path only (no query strings with secrets)."
)
SEC_WRITE_FOUNDATION = (
    "The first mutating domain write foundation shall include: a unit-of-work boundary with audit append, a repository "
    "layer (no SQL in HTTP adapters), a TRUNCATE trigger plus non-owner runtime DB role to curb destructive SQL, "
    "rate limiting or auth on audit append to curb unauthenticated audit flooding, UNIQUE (project_id, base_uid, version_n) "
    "enforcement, and rejection of reserved id segments at mint time."
)
SEC_KEY_CACHE = (
    "The runtime shall cache the unwrapped signing key in-process for performance and shall flush OpenTelemetry spans "
    "on graceful shutdown after draining in-flight token operations."
)
SEC_TEST_TEARDOWN = (
    "createTestApp (in-process harness) shall close the database pool when setup throws so PGlite/file-backed tests do "
    "not leak handles between cases."
)


def main() -> None:
    global data
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    # --- A: new / refined architecture requirements ---
    arch_reqs = [
        ("ARCH-REQ-AC-FACET", "SEC-RL", "Acceptance criteria facets", REQ_ACCEPT_FACET, "requirement:read"),
        ("ARCH-REQ-AC-ROLLUP", "SEC-RL", "Roll up completeness from facets", REQ_ACCEPT_ROLLUP, "requirement:read"),
        ("ARCH-TRACE-RECHECK", "SEC-EDGE", "Needs re-check (look-back completeness)", REQ_RECHECK, "trace:suspect"),
        ("ARCH-CAT-EXTERNAL", "SEC-CAT", "Catalogs represented outside project tree", REQ_CAT_REP, "catalog:browse"),
        ("ARCH-CAT-PROJECT-ROLLUP", "SEC-CAT", "Catalog control project rollup", REQ_CAT_ROLLUP, "catalog:browse"),
        ("ARCH-CAT-VISIBILITY", "SEC-CAT", "User-selected visible catalogs", REQ_CAT_PICK, "catalog:browse"),
        ("ARCH-TRACE-VIEW-RTM", "SEC-UI", "Two-column requirements ↔ capabilities view", REQ_TRACE_RTM, None),
        ("ARCH-TRACE-VIEW-CCM", "SEC-UI", "Two-column controls ↔ capabilities view", REQ_TRACE_CCM, None),
        ("ARCH-TRACE-LAYOUT-WORKER", "SEC-UI", "Off-main-thread trace layout engine", REQ_TRACE_WORKER, None),
        ("ARCH-HIER-REQ-DECOMP", "ARCH-CP-HIER", "Requirement decomposition rollup", REQ_HIER_REQ, "requirement:line:create"),
        ("ARCH-HIER-CAP-PARTOF", "ARCH-CP-HIER", "Capability part-of rollup", REQ_HIER_CAP, "capability:view"),
        ("ARCH-HIER-USES-DEP", "SEC-EDGE", "Uses dependency without control pass-through", REQ_HIER_USES, "trace:edit"),
        ("ARCH-HIER-SECTION-GROUP", "ARCH-CP-HIER", "Sections group only (no rollup)", REQ_HIER_SEC, "requirement:read"),
        ("ARCH-UI-KIT-SHARED", "SEC-UI", "UI Kit shared components", REQ_UIKIT, None),
        ("ARCH-BROWSE-ROADMAP", "SEC-UI", "Read-only browse priority order", REQ_BROWSE_ROADMAP, "requirement:read"),
        ("ARCH-SEC-EDGE-DEDUPE", "SEC-EDGE", "Trace edge dedupe including cross-project", SEC_EDGE_DEDUPE, None),
        ("ARCH-SEC-SEED-INTEGRITY", "SEC-IO", "Seed loader base_uid and delivers integrity", SEC_SEED_BASE_UID, None),
        ("ARCH-SEC-XPROJ-READ", "SEC-EDGE", "Cross-project link requires target read", SEC_XPROJ_LINK, "requirement:read"),
        ("ARCH-SEC-REL-STUB", "SEC-EDGE", "Restricted relation stub shape", SEC_STUB_DESIGN, None),
        ("ARCH-SEC-REL-PAGING", "SEC-EDGE", "Relations response paging", SEC_REL_PAGE, "requirement:read"),
        ("ARCH-SEC-CAT-FK", "SEC-CAT", "catalog_defs.project_id FK", SEC_CAT_FK, None),
        ("ARCH-SEC-LOADER-EDGE-SYNC", "SEC-IO", "Seed loader deletes removed trace edges", SEC_LOADER_EDGE_SYNC, None),
        ("ARCH-SEC-CAT-LABEL-IMPRINT", "SEC-CAT", "Catalog labels keyed per imprint", SEC_CAT_LABEL_KEY, None),
        ("ARCH-SEC-HEADERS", "SEC-SEC", "Security headers before wide bind", SEC_HEADERS, None),
        ("ARCH-WRITE-FOUNDATION", "SEC-API", "Mutating write foundation", SEC_WRITE_FOUNDATION, None),
        ("ARCH-KEY-RUNTIME-CACHE", "ARCH-KEY", "Signing key cache and span flush on shutdown", SEC_KEY_CACHE, None),
        ("ARCH-TEST-HARNESS-TEARDOWN", "SEC-BUILD", "createTestApp closes DB on setup failure", SEC_TEST_TEARDOWN, None),
    ]
    for base_uid, parent, title, stmt, rbac in arch_reqs:
        add_requirement(
            data,
            base_uid=base_uid,
            parent=parent,
            kind="requirement",
            title=title,
            statement=stmt,
            rbac_op=rbac,
            catalog_ref="AU-2" if base_uid.startswith("ARCH-SEC") else "CM-2",
            verification_note="Groomed 2026-10-09; pre-write or UI track.",
        )

    # Refine ARCH-SUSPECT (extend, do not duplicate ARCH-TRACE-RECHECK)
    patch_statement(
        "ARCH-SUSPECT",
        "When a target line receives a content mint_kind=.N, inbound trace edges (satisfies/refines/uses) and "
        "contract in_scope_of / release delivers junctions that pin a prior version of that line are marked "
        "trace_suspect=true (needs re-check). Pin-only migrate (mint_kind=pin) updates the ConformsTo pin and "
        "does NOT suspect that pin. Needs re-check is distinct from never-satisfied: UI and APIs shall surface "
        "trace_suspect separately from incomplete facets. When a satisfying capability changes or is incomplete, "
        "downstream satisfies/conforms targets shall re-enter needs re-check per ARCH-TRACE-RECHECK. Detect bed: "
        "edge FIX-CONTRACT-DOC-NOCTX → FIX-SUCC-2HOP.1 (stale uses on superseded UID).",
    )
    # No new trace edges here — loader tests pin edge count; trace links are documented on versions.

    # UI Kit capability tree
    add_capability(
        data,
        base_uid="CAP-UI-KIT",
        parent="SEC-UI",
        title="UI Kit (shared chrome and tree)",
        statement=(
            "Shared UI components for ReqALM browse surfaces: header chrome, badges, and the lazy tree control. "
            "Child capabilities hold concrete widgets; feature pages use them via uses edges."
        ),
        satisfies=[],
    )
    for child, title, stmt in [
        (
            "CAP-UI-KIT-TREE",
            "Shared lazy tree widget",
            "Lazy tree with expand/collapse, keyboard navigation, ARIA tree roles, and parent paging label "
            "'showing 100 of N' when more than 100 direct children exist. Single requirement owner for tree a11y.",
        ),
        (
            "CAP-UI-KIT-CHROME",
            "Shared header and badges",
            "Top/sidebar chrome fragments and status badges reused by browse views; no business logic.",
        ),
    ]:
        upsert_line(
            data,
            cm(
                base_uid=child,
                project_id="reqalm",
                parent="CAP-UI-KIT",
                kind="capability",
                title=title,
            ),
        )
        upsert_version(
            data,
            cm(
                uid=child,
                base_uid=child,
                version_n=0,
                status="draft",
                statement=stmt,
                priority=12,
                iteration="iter-r1",
                security={
                    "catalog_ref": "CM-2",
                    "verification_note": "Planned; tree browse exists in CAP-BROWSE-UI-TREE without extracted kit.",
                },
                statement_hash=statement_hash(stmt),
                grooming_state="detailed",
            ),
        )
    add_capability(
        data,
        base_uid="CAP-BROWSE-ROADMAP",
        parent="SEC-GROOM",
        title="Browse roadmap (planned releases queue)",
        statement=(
            "Tracks the ordered read-only browse program under ARCH-BROWSE-ROADMAP. Each tranche is still one "
            "PR = one release (API then UI): rel-r1-catalogs-api (parallel CAP-CATALOGS-API), rel-r1-browse-ui-catalogs, "
            "rel-r1-read-planning, rel-r1-browse-ui-planning, rel-r1-read-artifacts, rel-r1-browse-ui-artifacts, "
            "rel-r1-read-workflow, rel-r1-browse-ui-workflow, rel-r1-read-access, rel-r1-browse-ui-access, "
            "rel-r1-read-audit, rel-r1-browse-ui-audit, rel-r1-browse-ui-relations (parallel), "
            "rel-r1-browse-ui-trace-views. This capability is documentation-only until the first tranche PR adds real caps."
        ),
        satisfies=[],
    )

    # rel-r1-catalogs-api: reference only (parallel PR owns CAP-CATALOGS-API body)
    add_planned_release(
        data,
        "rel-r1-catalogs-api",
        "R1 — catalogs read API (parallel PR)",
        [],
        "Capability CAP-CATALOGS-API and requirements are owned by the in-flight catalogs API PR — not duplicated "
        "in this grooming patch. This release row anchors ordering before rel-r1-browse-ui-catalogs.",
    )

    # This PR's release + capability
    add_capability(
        data,
        base_uid=CAP_GROOM,
        parent="SEC-GROOM",
        title="Dogfood seed grooming (requirements honesty)",
        statement=(
            "Documentation-only seed pass: refined architecture requirements (acceptance criteria, trace views, "
            "hierarchy, security follow-ups), browse roadmap releases, and honesty corrections in dogfood.yaml with "
            "regenerated StrictDoc out/ and HANDOFF.md. No application runtime changes."
        ),
        satisfies=["K03", "ARCH-BROWSE-ROADMAP"],
        status="draft",
        verification_note="Planned until seed grooming PR merges.",
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-seed-grooming",
            subject_kind="CapabilityLine",
            base_uid=CAP_GROOM,
            status="unapproved",
            by=None,
            at=None,
            notes="Seed-only grooming PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    for uri in [
        f"{REPO}/docs/design/seed/dogfood.yaml",
        f"{REPO}/docs/design/seed/scripts/patch_seed_grooming_release.py",
        f"{REPO}/docs/design/HANDOFF.md",
    ]:
        arts = data.setdefault("capability_artifacts", [])
        if not any(a.get("requirement_version_uid") == CAP_GROOM and a.get("uri") == uri for a in arts):
            arts.append({"requirement_version_uid": CAP_GROOM, "kind": "other", "uri": uri})

    add_planned_release(
        data,
        REL_GROOM,
        "R1 — dogfood seed grooming",
        [CAP_GROOM],
        f"Seed-only PR on main {MAIN_CB8[:12]}…; regenerates out/ and HANDOFF. Does not ship rel-r1-relations-api.",
    )

    # --- B: honesty / grooming corrections ---
    remove_edge(
        data["edges"],
        {
            "from": "ARCH-DEVENV-IDENTITY",
            "to": "V-222518",
            "kind": "conforms_to",
            "catalog_imprint_id": "asd-stig@v6r4",
        },
    )
    remove_edge(
        data["edges"],
        {
            "from": "FIX-DENY-DEVENV-PROD-LOGIN",
            "to": "V-222518",
            "kind": "conforms_to",
            "catalog_imprint_id": "asd-stig@v6r4",
        },
    )

    patch_statement(
        "CAP-SSO",
        "Capability pack for enterprise federated SSO session establishment and teardown (ARCH-AUTH-FEDERATION). "
        "R0 delivered sequence diagrams and requirements only; runtime today uses the internal OAuth AS with dev "
        "local accounts (ARCH-DEVENV-IDENTITY.1), not upstream IdP federation. MFA for production remains at the "
        "enterprise IdP when federation ships.",
    )
    patch_verification(
        "CAP-SSO",
        None,
        "R0 design pack; federation not shipped — do not mark pass until ARCH-AUTH-FEDERATION delivers.",
    )
    if find(data.get("requirement_versions"), "uid", "CAP-SSO") and find(
        data.get("requirement_versions"), "uid", "CAP-SSO"
    ).get("verification_outcome") == "pass":
        find(data.get("requirement_versions"), "uid", "CAP-SSO").pop("verification_outcome", None)
        bump_status_correction()

    patch_statement(
        "CAP-SCOPED-VIEW",
        "Capability pack for Client Scoped View: select, clear, and bind clientId on the server session. "
        "Partial R1: grant-scoped browse APIs enforce project/client visibility; full A03/A04 UX and MCP parity "
        "remain in core-ALM. Scope changes shall be audited when mutating routes exist.",
    )
    patch_verification(
        "CAP-SCOPED-VIEW",
        "pending",
        "Partial: browse read scope shipped; full scoped-view mutate UX not complete.",
    )

    patch_statement(
        "CAP-RBAC",
        "Capability pack for API RBAC enforcement (subset of the full permission matrix). Shipped foundation "
        "covers OAuth routes, defineOperationRoute business reads, and auth-flow-smoke beds — not every ARCH-API-RBAC "
        "mutating operation. MCP and grant-management mutators remain planned in core-ALM.",
    )
    patch_verification(
        "CAP-RBAC",
        "pass",
        "Partial pass: foundation + read routes verified; full matrix deferred to core-ALM.",
    )

    patch_statement(
        "ARCH-API-RBAC",
        "Every mutating business operation shall check project_grant (and steward grants where applicable) before "
        "writes. Denied calls return a consistent unauthorized/forbidden outcome and emit an audit event. "
        "CAP-RBAC documents the currently verified enforcement subset; this architecture requirement remains "
        "active until all mutators in scope ship.",
    )

    patch_statement(
        "CAP-UI-FRAME",
        "Web UI frame: navigation, client-scoped sidebar chrome, and route guards for /app/* via BFF session cookies "
        "and CSRF on cookie mutations. Partial: shell and sign-in work; not every ARCH-UI surface is implemented.",
    )
    patch_verification(
        "CAP-UI-FRAME",
        "pass",
        "Partial pass: shell + guards verified on PR #13; full UI catalog still planned.",
    )

    patch_statement(
        "CAP-READ-REQS",
        "Grant-scoped requirements read APIs: paged list, detail, and version history. listScope enforces "
        "allowedProjectIds. Trace edges load from dogfood into trace_edges (PR #31 merge on main); relations detail "
        "is served by CAP-RELATIONS-API (seed release still parallel).",
    )

    patch_statement(
        "CAP-RELATIONS-API",
        "Grant-scoped read-only GET .../requirements/:id/relations with redacted cross-project stubs, catalog labels, "
        "and suspect flags. Implemented on main (PR #31 merge cb8a8c9); rel-r1-relations-api seed release ships in a "
        "parallel PR — do not mark this capability shipped here.",
    )

    rel_r0 = find(data.get("releases"), "id", "rel-r0-sequences")
    r0_note_suffix = (
        "Delivered CAP-* packs here are R0 design/sequence artifacts (diagrams), not runtime verification — "
        "see CAP-SSO / CAP-SCOPED-VIEW honesty."
    )
    if rel_r0:
        base_notes = (rel_r0.get("notes") or "").split(" Delivered CAP-*")[0].rstrip()
        desired = f"{base_notes} {r0_note_suffix}".strip() if base_notes else r0_note_suffix
        if rel_r0.get("notes") != desired:
            rel_r0["notes"] = desired
            stats["versions_updated"] += 1

    ar_cp = find(data.get("approval_records"), "id", "ar-browse-ui-cp")
    if ar_cp and "Planned for browse UI PR" in (ar_cp.get("notes") or ""):
        ar_cp["notes"] = "Shipped with browse UI PR #23 (merge b5c7b5e9efd48de95e5e0ca5a71e23cb0a640f4a)."
        bump_status_correction()

    pg = find(data.get("requirement_versions"), "uid", "CAP-TEST-PGLITE-DB")
    if pg:
        extra = " createTestApp shall close the pool when setup throws (ARCH-TEST-HARNESS-TEARDOWN)."
        if extra.strip() not in (pg.get("statement") or ""):
            patch_statement("CAP-TEST-PGLITE-DB", (pg.get("statement") or "").rstrip() + extra)

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)

    print("Patched dogfood.yaml (seed grooming)")
    for k, v in stats.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
