#!/usr/bin/env python3
"""UI layout capability statements + mock view drafts (seed-only). Idempotent.

Adds rel-r1-ui-layout-capabilities / CAP-UI-LAYOUT (planned; no ship). Content-mints
shipped browse UI capabilities with layout prose; draft mock-view capabilities linked to
Grok Bot box mockups under mockups/reqalm-two-column/shots/. Refreshes ctr-reqalm-product.

Never removes edges from existing version UIDs (baseline @ BASE_MAIN).

Run: python3 patch_ui_layout_capabilities_release.py && python3 yaml_to_strictdoc.py --validate
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import sys
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

_SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPTS))
from seed_baseline_edges import validate_baseline_edges_preserved  # noqa: E402

SEED = _SCRIPTS.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
REPO_ROOT = SEED.parent.parent
PLANNED = "2026-10-10"
BASE_MAIN = "1eb8482b533b5f656240bc7b53a60b1a58c5a203"
TRACE_MERGE = "56bfc4d6a9fe04559ccddae636ec4052d84ae907"
ATTACH_SHIPPED = "2026-10-09"
ATTACH_CAP = "CAP-SEED-ATTACH-FIGMA"
ATTACH_REL = "rel-r1-seed-attach-figma"
REL = "rel-r1-ui-layout-capabilities"
CAP = "CAP-UI-LAYOUT"
MOCK_SHOTS = "mockups/reqalm-two-column/shots/"

EXPECTED_LINES = 453
EXPECTED_VERSIONS = 486
EXPECTED_EDGES = 1934

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
yaml.indent(mapping=2, sequence=2, offset=0)


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


def upsert(seq, key, item):
    cur = find(seq, key, item[key])
    if cur is None:
        seq.append(deepcopy(item))
        return 1
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
    return 0


def edge_key(edge: dict) -> tuple:
    return (
        edge.get("from"),
        edge.get("to"),
        edge.get("kind"),
        edge.get("catalog_imprint_id") or "",
        edge.get("inheritable") if edge.get("inheritable") is not None else "",
        edge.get("trace_suspect") if edge.get("trace_suspect") is not None else "",
    )


def ensure_edge(edges, edge):
    for e in edges:
        if edge_key(e) == edge_key(edge):
            for k, v in edge.items():
                e[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
            return 0
    edges.append(deepcopy(edge))
    return 1


def upsert_version(data, item) -> None:
    stmt = item.get("statement")
    if stmt and "statement_hash" not in item:
        item = dict(item)
        item["statement_hash"] = statement_hash(stmt)
    cur = find(data.get("requirement_versions"), "uid", item["uid"])
    if cur is None:
        data.setdefault("requirement_versions", []).append(deepcopy(item))
        return
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v


def mint_content_successor(
    data,
    tip_uid: str,
    new_statement: str,
    *,
    verification_note: str | None = None,
    copy_kinds: tuple[str, ...] = ("satisfies", "conforms_to", "uses"),
) -> str:
    tip = find(data.get("requirement_versions"), "uid", tip_uid)
    if not tip:
        raise KeyError(f"missing version {tip_uid}")
    base_uid = tip["base_uid"]
    new_n = int(tip.get("version_n", 0)) + 1
    new_uid = f"{base_uid}.{new_n}"
    new_hash = statement_hash(new_statement)

    existing = find(data.get("requirement_versions"), "uid", new_uid)
    if (
        existing
        and existing.get("statement") == new_statement
        and existing.get("status") == "active"
        and tip.get("status") == "superseded"
    ):
        return new_uid

    tip["status"] = "superseded"
    sec = deepcopy(tip.get("security") or {"catalog_ref": "CM-2"})
    if verification_note:
        sec["verification_note"] = verification_note
    ver = cm(
        uid=new_uid,
        base_uid=base_uid,
        version_n=new_n,
        status="active",
        statement=new_statement,
        priority=tip.get("priority", 10),
        iteration=tip.get("iteration", "iter-r1"),
        security=sec,
        statement_hash=new_hash,
        grooming_state=tip.get("grooming_state", "detailed"),
        mint_kind="content",
    )
    if tip.get("verification_outcome"):
        ver["verification_outcome"] = tip["verification_outcome"]
    if tip.get("rbac_op"):
        ver["rbac_op"] = tip["rbac_op"]
    upsert_version(data, ver)

    edges = data.setdefault("edges", [])
    ensure_edge(edges, {"from": new_uid, "to": tip_uid, "kind": "refines"})
    for e in list(edges):
        if e.get("from") != tip_uid or e.get("kind") not in copy_kinds:
            continue
        copied = {
            k: v
            for k, v in e.items()
            if k in ("to", "kind", "catalog_imprint_id", "inheritable", "trace_suspect", "suspect_reason")
        }
        copied["from"] = new_uid
        ensure_edge(edges, copied)
    return new_uid


def add_draft_layout_successor(
    data,
    base_uid: str,
    draft_statement: str,
    *,
    verification_note: str,
) -> None:
    """Draft .1 layout intent; active tip (.0) stays active and unchanged."""
    v0 = find(data.get("requirement_versions"), "uid", base_uid)
    if not v0:
        v0 = find(
            data.get("requirement_versions"),
            "uid",
            next(
                (v["uid"] for v in data.get("requirement_versions") or [] if v.get("base_uid") == base_uid and v.get("version_n") == 0),
                base_uid,
            ),
        )
    if v0 and v0.get("status") == "superseded":
        v0["status"] = "active"
    draft_uid = f"{base_uid}.1"
    upsert_version(
        data,
        cm(
            uid=draft_uid,
            base_uid=base_uid,
            version_n=1,
            status="draft",
            statement=draft_statement,
            priority=v0.get("priority", 15) if v0 else 15,
            iteration=v0.get("iteration", "iter-r0") if v0 else "iter-r0",
            security={
                "catalog_ref": (v0.get("security") or {}).get("catalog_ref", "CM-2") if v0 else "CM-2",
                "verification_note": verification_note,
            },
            statement_hash=statement_hash(draft_statement),
            grooming_state="detailed",
            mint_kind="content",
        ),
    )
    ensure_edge(data.setdefault("edges", []), {"from": draft_uid, "to": base_uid, "kind": "refines"})


def normalize_layout_statements(data) -> None:
    for ver in data.get("requirement_versions") or []:
        stmt = ver.get("statement")
        if not stmt or " Layout: Layout:" not in stmt:
            continue
        ver["statement"] = stmt.replace(" Layout: Layout:", " Layout:")
        ver["statement_hash"] = statement_hash(ver["statement"])


def patch_draft_statement(data, uid: str, statement: str, *, verification_note: str | None = None) -> None:
    ver = find(data.get("requirement_versions"), "uid", uid)
    if not ver or ver.get("status") != "draft":
        return
    ver["statement"] = statement
    ver["statement_hash"] = statement_hash(statement)
    if verification_note:
        ver.setdefault("security", {})["verification_note"] = verification_note


def _contracts_patch_module():
    path = SEED / "scripts" / "patch_reqalm_contracts_release.py"
    spec = importlib.util.spec_from_file_location("patch_reqalm_contracts_release", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _attach_patch_module():
    path = SEED / "scripts" / "patch_attach_figma_seed_release.py"
    spec = importlib.util.spec_from_file_location("patch_attach_figma_seed_release", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def refresh_product_contract_scope(data) -> None:
    _attach_patch_module().refresh_product_contract_scope(data)
    prod = find(data.get("contracts"), "id", _contracts_patch_module().PRODUCT_CONTRACT)
    if prod:
        prod["covers_releases"] = _contracts_patch_module().reqalm_release_ids(data)


def restore_trace_inherit_uses_ship(data) -> None:
    """Keep PR #39 ship metadata frozen at its merge SHA (not this PR's main)."""
    rel = find(data.get("releases"), "id", "rel-r1-trace-inherit-uses")
    if rel:
        rel["notes"] = (
            f"PR #39 merged to main as {TRACE_MERGE} on {ATTACH_SHIPPED}. "
            "trace_edges.inheritable column + seed beds for common-control inheritance over uses."
        )
    ver = find(data.get("requirement_versions"), "uid", "CAP-TRACE-INHERIT-USES")
    if ver:
        sec = dict(ver.get("security") or {})
        sec["verification_note"] = f"Shipped with inherit-uses loader PR #39 (merge {TRACE_MERGE})."
        ver["security"] = sec


def ship_attach_figma_seed_release(data) -> None:
    """Ship PR #40 attachments/Figma seed release at full main merge SHA (PR #42)."""
    rel = find(data.get("releases"), "id", ATTACH_REL)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = ATTACH_SHIPPED
        rel["notes"] = (
            f"PR #40 merged to main as {BASE_MAIN} on {ATTACH_SHIPPED}. "
            "Cyber attachments + Figma requirement set in dogfood seed."
        )
    ver = find(data.get("requirement_versions"), "uid", ATTACH_CAP)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "CM-2")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {
            "catalog_ref": catalog_ref,
            "verification_note": f"Shipped with attachments/Figma seed PR #40 (merge {BASE_MAIN}).",
        }
    ar = find(data.get("approval_records"), "id", "ar-seed-attach-figma")
    if ar:
        ar["status"] = "unapproved"
        ar["notes"] = (
            f"Capability active with verification pass after PR #40 merge {BASE_MAIN}; "
            "formal approval record not filed in seed."
        )
        ar["approved_version_uid"] = None
        ar["approved_statement_hash"] = None


def update_planned_release_tips(data) -> None:
    rel = find(data.get("releases"), "id", "rel-r1-core-alm")
    if not rel:
        return
    rel["delivers"] = [
        "CAP-UI-FRAME.2" if d == "CAP-UI-FRAME.1" else d for d in (rel.get("delivers") or [])
    ]


def add_draft_view_cap(
    data,
    *,
    base_uid: str,
    title: str,
    statement: str,
    mock_files: list[str],
    satisfies: list[str],
    parent: str = "SEC-UI",
) -> None:
    files_note = ", ".join(mock_files)
    note = f"Mockup files (Grok Bot box): {files_note}."
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
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
            status="draft",
            statement=statement,
            priority=12,
            iteration="iter-r1",
            security={"catalog_ref": "CM-2", "verification_note": note},
            statement_hash=statement_hash(statement),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id=f"ar-{base_uid.lower()}",
            subject_kind="CapabilityLine",
            base_uid=base_uid,
            status="unapproved",
            by=None,
            at=None,
            notes=note,
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    kit_tip = active_uid(data, "CAP-UI-KIT")
    edges = data.setdefault("edges", [])
    for to in satisfies:
        ensure_edge(edges, {"from": base_uid, "to": to, "kind": "satisfies"})
    ensure_edge(edges, {"from": base_uid, "to": kit_tip, "kind": "uses"})
    arts = data.setdefault("capability_artifacts", [])
    for mf in mock_files:
        uri = f"{MOCK_SHOTS}{mf}"
        if not any(a.get("requirement_version_uid") == base_uid and a.get("uri") == uri for a in arts):
            arts.append({"requirement_version_uid": base_uid, "kind": "mock", "uri": uri})


def active_uid(data, base_uid: str) -> str:
    vers = [v for v in data.get("requirement_versions") or [] if v.get("base_uid") == base_uid]
    if not vers:
        return base_uid
    active = [v for v in vers if v.get("status") == "active"]
    if active:
        return max(active, key=lambda v: v.get("version_n", 0))["uid"]
    non_sup = [v for v in vers if v.get("status") != "superseded"]
    if non_sup:
        return max(non_sup, key=lambda v: v.get("version_n", 0))["uid"]
    return max(vers, key=lambda v: v.get("version_n", 0))["uid"]


STMT_LAYOUT = (
    "ReqALM /app layout (no persistent sidebar): a fixed header band (CAP-UI-HEADER-NAV) spans the viewport with "
    "brand, client/project/page breadcrumb, project tabs, and account menu; the remaining viewport is the main "
    "content region. Main patterns: (1) paged list with URL-driven filters and row links to detail; (2) list + "
    "detail split (tree or table beside a detail pane); (3) single-column detail with secondary panels (version "
    "history, relationships); (4) two- or three-column trace boards with cross-highlighted join paths; (5) catalog "
    "pickers with imprint/control columns. Navigation: header tabs switch major project modes (Requirements list/tree, "
    "Releases, future Traceability/Capabilities/Contracts/Audit stubs); breadcrumbs and in-content links drill to "
    "requirement, release, capability, contract, and catalog routes; client-scoped routes under /app/clients and "
    "/app/projects/:projectId/*. All feature views consume shared chrome via CAP-UI-KIT (header, badges, tree widget)."
)

STMT_FRAME_2 = (
    "Web UI frame (shipped partial): internal-AS sign-in, HttpOnly session cookies, CSRF on cookie-mutating routes, "
    "and route guards that keep unauthenticated users off /app/*. Top header chrome only — no persistent sidebar rail "
    "(CAP-UI-HEADER-NAV). Implemented today: grant-scoped read-only browse for clients, projects, requirements "
    "(list, tree, detail, version history, relationships panel), and releases under the header. Not implemented in "
    "this frame: contract/version/trace/catalog/planning screens (see draft CAP-UI-VIEW-* and CAP-CONTRACT-UI.1 / "
    "CAP-VERSION-UI.1)."
)

STMT_CHROME = (
    "Shared header chrome fragments and status badges for browse and trace views (brand slot, breadcrumb slot, tab strip "
    "host, account avatar). Consumed by CAP-UI-HEADER-NAV and feature pages via CAP-UI-KIT; no sidebar rail and no "
    "domain logic."
)

STMT_KIT = (
    "Shared UI components for ReqALM browse surfaces: header chrome (CAP-UI-KIT-CHROME), badges, and the lazy tree "
    "control (CAP-UI-KIT-TREE). Feature pages compose these widgets; layout regions are documented on CAP-UI-LAYOUT "
    "and per-view capabilities."
)

STMT_KIT_TREE = (
    "Lazy tree with expand/collapse, WCAG 2.2 AA keyboard navigation per WAI-ARIA tree pattern, and parent paging label "
    "'showing 100 of N' when more than 100 direct children exist. Layout role: primary column on the tree route; selecting "
    "a requirement navigates to the requirement detail route (no split-pane detail on the tree URL). Shipped "
    "CAP-BROWSE-UI-TREE will be refactored to consume this widget later (see ARCH-UI-KIT-SHARED)."
)

# (base_uid, title, mock_files, statement, satisfies)
VIEW_CAPS: list[tuple] = [
    (
        "CAP-UI-VIEW-RTM",
        "Requirements ↔ capabilities trace view (mock)",
        ["01-two-column-overview-v2.png", "02-two-column-suspect-highlight-v2.png"],
        (
            "Planned two-column trace view under the project header: left column lists system requirements "
            "(filterable, scrollable); right column lists capabilities; center join highlights satisfies (and shown "
            "refines) edges when a row is selected on either side. Header breadcrumb holds project context; a back link "
            "returns to Requirements list/tree. Uses shared header chrome and badges from CAP-UI-KIT."
        ),
        ["ARCH-TRACE-VIEW-RTM", "ARCH-TRACE-LAYOUT-WORKER"],
    ),
    (
        "CAP-UI-VIEW-CRITERIA",
        "Requirement acceptance criteria view (mock)",
        ["04-criteria-v2.png", "05-criteria-suspect-why-v2.png"],
        (
            "Planned requirement detail extension: below the statement, an Acceptance criteria region lists facet rows "
            "(shall statements) with satisfied / incomplete / needs re-check badges; each facet links to satisfying "
            "capabilities when present. Header breadcrumb includes requirement uid; tabs remain on Requirements. "
            "Rollup status surfaces on the parent requirement header per ARCH-REQ-AC-ROLLUP."
        ),
        ["ARCH-REQ-AC-FACET", "ARCH-REQ-AC-ROLLUP"],
    ),
    (
        "CAP-UI-VIEW-CATALOG",
        "Catalog browse three-column view (mock)",
        ["06c-catalog-BC-three-column-v2.png", "06e-catalog-BC-three-column-AC3-v2.png"],
        (
            "Planned catalog browse under Capabilities/Catalog tab: column one lists visible catalogs for the project "
            "(ARCH-CAT-VISIBILITY); column two lists imprints/versions for the selected catalog; column three lists "
            "controls with conforming counts. Row selection loads control detail in a slide-over or replaces column "
            "three. Links from control rows jump to catalog-to-capability trace (CAP-UI-VIEW-CCM) when trace is enabled."
        ),
        ["ARCH-CAT-VISIBILITY", "ARCH-CAT-EXTERNAL"],
    ),
    (
        "CAP-UI-VIEW-CCM",
        "Catalog ↔ capabilities trace view (mock)",
        ["07a-catalog-caps-collapsed-v2.png", "07b-catalog-caps-AC3-expanded-v2.png"],
        (
            "Planned two-column trace view: left column lists catalog controls (respecting visible catalog set); right "
            "column lists capabilities; joins follow conforms_to with solid direct pins and dashed inherited/heavy-bundle "
            "links per ARCH-TRACE-VIEW-CCM. Selection highlights paired rows; capability rows link to capability detail "
            "(CAP-UI-VIEW-CAP-DETAIL). Header shows catalog + project context."
        ),
        ["ARCH-TRACE-VIEW-CCM", "ARCH-TRACE-LAYOUT-WORKER"],
    ),
    (
        "CAP-UI-VIEW-CAP-DETAIL",
        "Capability detail view (mock)",
        ["09-capability-detail.png"],
        (
            "Planned capability detail: header with uid, title, status, verification outcome; statement body; sections "
            "for part-of children, satisfies/requirements links, conforms_to control pins (with inherited-via-uses "
            "chips), artifacts/attachments list, and delivered-in releases. Relationships to catalog controls link to "
            "CAP-UI-VIEW-CCM; requirement peers open requirement detail. Uses CAP-UI-KIT header and badges."
        ),
        ["I01", "I03", "ARCH-HIER-CAP-PARTOF"],
    ),
    (
        "CAP-UI-VIEW-CAP-FOCUS",
        "Capability and release focus view (mock)",
        [
            "10a-focus-cap-rbac.png",
            "10d-focus-picker-search.png",
            "11a-focus-release-r1-foundation-shipped.png",
        ],
        (
            "Planned focus screen for a capability line within a release or iteration context: top summary shows "
            "capability uid/title, verification badge, and part-of parent; a Releases strip lists planned/shipped "
            "releases that deliver this capability with links to release detail; main body lists child capabilities "
            "(part-of) and satisfies targets. Breadcrumb: project → Capabilities → uid. Links to requirement/detail "
            "routes for satisfied requirements."
        ),
        ["ARCH-HIER-CAP-PARTOF", "ARCH-RELEASE"],
    ),
]

BROWSE_MINTS: list[tuple[str, str, str]] = []


def append_layout(base_uid: str, layout: str, verification_note: str) -> None:
    BROWSE_MINTS.append((base_uid, layout, verification_note))


append_layout(
    "CAP-BROWSE-UI-CP",
    "Clients entry lists grant-scoped clients; row opens client detail with projects table; All projects "
    "lists cross-client projects with client name; project stub shows Requirements/Releases placeholders linking "
    "into project routes. Header uses global Clients/Projects nav outside project tabs.",
    "Layout prose added 2026-10-10 seed (CAP-UI-LAYOUT); shipped browse UI PR #23.",
)
append_layout(
    "CAP-BROWSE-UI-REQS",
    "Project Requirements tab — filter strip (kind/type/status/q) above a paged table; row navigates to "
    "detail with statement and attributes; version history is a secondary route; relationships panel sits below "
    "statement on detail (CAP-BROWSE-UI-RELATIONS). Breadcrumb: client → project → requirement uid.",
    "Layout prose added 2026-10-10 seed; shipped PR #26.",
)
append_layout(
    "CAP-BROWSE-UI-RELEASES",
    "Project Releases tab — status filter and paged table; row opens release detail with notes and delivered "
    "capabilities list linking to requirement/capability detail routes. Breadcrumb includes project name.",
    "Layout prose added 2026-10-10 seed; shipped PR #27.",
)
append_layout(
    "CAP-BROWSE-UI-TREE",
    "Project Requirements tree mode — lazy tree in the primary column (see also repo mockup "
    "01-requirements-tree-detail.jpg); selecting a requirement navigates to the requirement detail route "
    "(no split-pane detail on the tree URL). Section ancestors in breadcrumb on detail link back to tree parent. "
    "List/tree toggle lives in the header tab strip.",
    "Layout prose added 2026-10-10 seed; shipped PR #29.",
)
append_layout(
    "CAP-BROWSE-UI-RELATIONS",
    "Relationships region on requirement detail — outgoing and incoming groups by kind; requirement peers link "
    "to detail; catalog conforms_to peers render as non-navigating chips; restricted peers show muted stub.",
    "Layout prose added 2026-10-10 seed; shipped PR #32.",
)
append_layout(
    "CAP-UI-HEADER-NAV",
    "Fixed top header — brand (links home), breadcrumb (client/project/page), project tab strip with "
    "Requirements list|tree toggle and Releases, stub tabs for Traceability/Capabilities/Contracts/Audit, avatar menu "
    "with sign-out. No sidebar; main content begins below the header.",
    "Layout cross-ref 2026-10-10 seed; shipped PR #37.",
)

STMT_CONTRACT_DRAFT = (
    "Planned capability pack for contract list/detail and document view (not built on main). Layout intent when "
    "implemented: contracts list with overlap timeline and in_scope_of counts; detail with membership linking to "
    "requirement versions; document view built from in_scope_of uids with optional context-parent walk. Reference "
    "mockups in repo: 02-contracts-list-detail.jpg, 03-document-view-from-contract.jpg."
)

STMT_VERSION_DRAFT = (
    "Planned capability pack for version succession, lineage, and compare UX (not built on main). Layout intent when "
    "implemented: lineage strip across obsolete → active → draft tips; compare with field-level diffs; successor mint "
    "actions on detail header. Reference mockup in repo: 04-requirement-lineage-versions.jpg."
)

ARTIFACTS = [
    f"{REPO}/docs/design/seed/dogfood.yaml",
    f"{REPO}/docs/design/seed/scripts/patch_ui_layout_capabilities_release.py",
    f"{REPO}/docs/design/mockups/README.md",
    f"{REPO}/docs/design/HANDOFF.md",
]


def apply_patch(data) -> None:
    restore_trace_inherit_uses_ship(data)

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-UI",
            kind="capability",
            title="ReqALM application layout (regions and navigation)",
        ),
    )
    upsert_version(
        data,
        cm(
            uid=CAP,
            base_uid=CAP,
            version_n=0,
            status="draft",
            statement=STMT_LAYOUT,
            priority=10,
            iteration="iter-r1",
            security={
                "catalog_ref": "CM-2",
                "verification_note": "Planned layout architecture; seed-only 2026-10-10.",
            },
            statement_hash=statement_hash(STMT_LAYOUT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-ui-layout",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned CAP-UI-LAYOUT.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )

    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP]
    for to in ("ARCH-UI", "ARCH-UI-GUARD"):
        ensure_edge(data["edges"], {"from": CAP, "to": to, "kind": "satisfies"})
    header_tip = active_uid(data, "CAP-UI-HEADER-NAV")
    kit_tip = active_uid(data, "CAP-UI-KIT")
    ensure_edge(data["edges"], {"from": CAP, "to": header_tip, "kind": "uses"})
    ensure_edge(data["edges"], {"from": CAP, "to": kit_tip, "kind": "uses"})

    frame_tip = active_uid(data, "CAP-UI-FRAME")
    frame_ver = find(data.get("requirement_versions"), "uid", frame_tip)
    if frame_ver and STMT_FRAME_2.split(".")[0] not in (frame_ver.get("statement") or ""):
        if frame_tip == "CAP-UI-FRAME.2":
            frame_ver["statement"] = STMT_FRAME_2
            frame_ver["statement_hash"] = statement_hash(STMT_FRAME_2)
        elif "Web UI frame (shipped partial)" not in (frame_ver.get("statement") or ""):
            mint_content_successor(
                data,
                frame_tip,
                STMT_FRAME_2,
                verification_note="Content mint .2: header-only built shell; no sidebar rail.",
            )

    patch_draft_statement(data, "CAP-UI-KIT-CHROME", STMT_CHROME)
    patch_draft_statement(data, "CAP-UI-KIT", STMT_KIT)
    patch_draft_statement(data, "CAP-UI-KIT-TREE", STMT_KIT_TREE)

    for base_uid, layout, vnote in BROWSE_MINTS:
        active = active_uid(data, base_uid)
        active_ver = find(data.get("requirement_versions"), "uid", active)
        if not active_ver:
            continue
        stmt = active_ver.get("statement") or ""
        if layout in stmt:
            continue
        merged = stmt.strip()
        if " Layout: " not in merged:
            merged = f"{merged} Layout: {layout}"
        else:
            merged = f"{merged} {layout}"
        mint_content_successor(data, active, merged, verification_note=vnote)

    add_draft_layout_successor(
        data,
        "CAP-CONTRACT-UI",
        STMT_CONTRACT_DRAFT,
        verification_note="Draft .1 layout intent; active CAP-CONTRACT-UI unchanged until contract UI ships.",
    )
    add_draft_layout_successor(
        data,
        "CAP-VERSION-UI",
        STMT_VERSION_DRAFT,
        verification_note="Draft .1 layout intent; active CAP-VERSION-UI unchanged until version UI ships.",
    )

    for base_uid, title, mock_files, statement, satisfies in VIEW_CAPS:
        add_draft_view_cap(
            data,
            base_uid=base_uid,
            title=title,
            statement=statement,
            mock_files=mock_files,
            satisfies=satisfies,
        )

    arts = data.setdefault("capability_artifacts", [])
    for base_uid, _title, mock_files, _statement, _sat in VIEW_CAPS:
        for mf in mock_files:
            uri = f"{MOCK_SHOTS}{mf}"
            if not any(a.get("requirement_version_uid") == base_uid and a.get("uri") == uri for a in arts):
                arts.append({"requirement_version_uid": base_uid, "kind": "mock", "uri": uri})
    data["capability_artifacts"] = [a for a in arts if a.get("requirement_version_uid") != CAP]
    for uri in ARTIFACTS:
        data["capability_artifacts"].append(
            {"requirement_version_uid": CAP, "kind": "other", "uri": uri}
        )

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=REL,
            project_id="reqalm",
            name="R1 — UI layout capability statements (seed)",
            planned_on=PLANNED,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes=(
                f"Seed-only UI layout + mock view capabilities on main @ {BASE_MAIN[:7]}. "
                "Documents regions/links in capability text; ships nothing."
            ),
        ),
    )

    normalize_layout_statements(data)
    update_planned_release_tips(data)
    ship_attach_figma_seed_release(data)
    refresh_product_contract_scope(data)
    validate_baseline_edges_preserved(data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--validate-baseline-edges",
        action="store_true",
        help="Load dogfood.yaml and verify baseline outbound edges preserved (no write)",
    )
    args = parser.parse_args()

    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    if args.validate_baseline_edges:
        validate_baseline_edges_preserved(data)
        print("baseline edge preservation ok")
        return

    apply_patch(data)

    lines = len(data.get("requirement_lines") or [])
    vers = len(data.get("requirement_versions") or [])
    edge_c = len(data.get("edges") or [])
    if (lines, vers, edge_c) != (EXPECTED_LINES, EXPECTED_VERSIONS, EXPECTED_EDGES):
        print(
            f"COUNT MISMATCH: lines={lines} (expected {EXPECTED_LINES}), "
            f"versions={vers} (expected {EXPECTED_VERSIONS}), edges={edge_c} (expected {EXPECTED_EDGES})",
            file=sys.stderr,
        )
        sys.exit(1)

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(
        f"Patched dogfood.yaml: {REL} / {CAP}, layout mints, {len(VIEW_CAPS)} mock view caps, "
        f"lines={lines} versions={vers} edges={edge_c}"
    )


if __name__ == "__main__":
    main()
