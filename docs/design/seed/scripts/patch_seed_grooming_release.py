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


def delete_release(data, rel_id: str) -> None:
    rels = data.get("releases") or []
    data["releases"] = [r for r in rels if r.get("id") != rel_id]


def remove_requirement(data, base_uid: str) -> None:
    data["requirement_lines"] = [
        ln for ln in (data.get("requirement_lines") or []) if ln.get("base_uid") != base_uid
    ]
    data["requirement_versions"] = [
        v for v in (data.get("requirement_versions") or []) if v.get("base_uid") != base_uid
    ]


def dedupe_seed_grooming_approvals(data) -> None:
    arts = data.get("approval_records") or []
    data["approval_records"] = [a for a in arts if a.get("id") != "ar-cap-seed-grooming"]


R0_NOTE_SUFFIX = (
    "Delivered CAP-* packs here are R0 design/sequence artifacts (diagrams), not runtime verification — "
    "see CAP-SSO / CAP-SCOPED-VIEW honesty."
)


def ensure_r0_sequences_note(data) -> None:
    rel = find(data.get("releases"), "id", "rel-r0-sequences")
    if not rel:
        return
    notes = (rel.get("notes") or "").strip()
    if R0_NOTE_SUFFIX in notes:
        return
    rel["notes"] = f"{notes} {R0_NOTE_SUFFIX}".strip() if notes else R0_NOTE_SUFFIX


CAP_RBAC_V0_STMT = (
    "API routes enforce project-grant derived permissions (CAP-RBAC matrix subset). "
    "`POST /api/v1/projects/:projectId/grants` requires `grant:manage`; Readers receive 403 with audit. "
    "MCP `/mcp` requires MCP-audience tokens. Acceptance: auth-flow-smoke RBAC deny for casey-reader."
)
CAP_RBAC_V0_HASH = "sha256:07904dc523cccd3c24e8ab49deca0a2aa3cbaaf2882a8d8028c24eaf737ea60b"
CAP_RBAC_V1_STMT = (
    "Capability pack for API RBAC enforcement (subset of the full permission matrix). Shipped foundation "
    "covers OAuth routes, defineOperationRoute business reads, and auth-flow-smoke beds — not every ARCH-API-RBAC "
    "mutating operation. MCP and grant-management mutators remain planned in core-ALM."
)
CAP_UI_FRAME_V0_STMT = (
    "The Web UI frame served by the web role: top navigation, client-scoped sidebar chrome, and route guards that "
    "send unauthenticated users to the internal-AS sign-in flow and keep `/app/*` behind a valid API-audience session "
    "via HttpOnly SameSite=Lax cookies (BFF) with CSRF on sign-out; API clients use bearer tokens. Sign-out revokes "
    "refresh tokens via RFC 7009. Acceptance: unauthenticated `/app` redirects to login; authenticated shell renders "
    "`/api/v1/me` grants."
)
CAP_UI_FRAME_V0_HASH = "sha256:0828332feb654b6ef8c411828750b14e293b41e4400377cb3abf3d6c18aefde6"
CAP_UI_FRAME_V1_STMT = (
    "Web UI frame: navigation, client-scoped sidebar chrome, and route guards for /app/* via BFF session cookies "
    "and CSRF on cookie mutations. Partial: shell and sign-in work; not every ARCH-UI surface is implemented."
)

PR13_EVIDENCE = "Verified: Local Docker 2026-10-07 on PR #13 follow-up (6a5f0db + verification fixes)."

CAP_SSO_V0_STMT = (
    "Capability pack for federated SSO session establishment and teardown against the enterprise IdP.\n"
    "Covers sign-in and sign-out paths used by UI and MCP hosts. No local passwords; MFA and authenticator\n"
    "policy live at the IdP (NIST IA-2/IA-5, V-222536/542)."
)
CAP_SSO_V0_HASH = "sha256:090fad7f2a28d03f0eb0ea1684631e535ac2df550dc81596a7f1abb3cc271cb4"
CAP_SSO_V1_STMT = (
    "Capability pack for enterprise federated SSO session establishment and teardown (ARCH-AUTH-FEDERATION). "
    "R0 delivered sequence diagrams and requirements only; runtime today uses the internal OAuth AS with dev "
    "local accounts (ARCH-DEVENV-IDENTITY.1), not upstream IdP federation. MFA for production remains at the "
    "enterprise IdP when federation ships."
)

CAP_SCOPED_V0_STMT = (
    "Capability pack for selecting, clearing, and binding Client Scoped View on the server session.\n"
    "UI App providers consume the bound clientId for navigation guards. Scope change and clear are audited;\n"
    "server rejects cross-client resource access even if the client id appears in a forged request."
)
CAP_SCOPED_V0_HASH = "sha256:6d9d653098304d18fc6d61cd24753e12655075be1d43e5b64f6b6ae74150fe6c"
CAP_SCOPED_V1_STMT = (
    "Capability pack for Client Scoped View: select, clear, and bind clientId on the server session. "
    "Partial R1: grant-scoped browse APIs enforce project/client visibility; full A03/A04 UX and MCP parity "
    "remain in core-ALM. Scope changes shall be audited when mutating routes exist."
)

ARCH_API_RBAC_V0_STMT = (
    "Every mutating business operation checks project_grant (and steward grants where applicable) before\n"
    "writes. Denied calls return a consistent unauthorized/forbidden outcome and emit an audit event."
)
ARCH_API_RBAC_V0_HASH = "sha256:319f1dad1c8772a1cc5be6cc71b9a52630fd21601c5bac288a1b4b33eee3e8be"
ARCH_API_RBAC_V1_STMT = (
    "Every mutating business operation shall check project_grant (and steward grants where applicable) before "
    "writes. Denied calls return a consistent unauthorized/forbidden outcome and emit an audit event. "
    "CAP-RBAC documents the currently verified enforcement subset; this architecture requirement remains "
    "active until all mutators in scope ship."
)


def mint_content_n(
    data,
    base_uid: str,
    v0_statement: str,
    v0_hash: str,
    v1_statement: str,
    v1_verification_note: str,
    *,
    v1_verification_outcome: str | None = "pass",
    copy_edge_kinds: tuple[str, ...] = ("satisfies", "conforms_to"),
) -> None:
    v0 = find(data.get("requirement_versions"), "uid", base_uid)
    if v0:
        v0["statement"] = v0_statement
        v0["statement_hash"] = v0_hash
        v0["status"] = "superseded"
    tip = f"{base_uid}.1"
    ver = cm(
        uid=tip,
        base_uid=base_uid,
        version_n=1,
        status="active",
        statement=v1_statement,
        priority=v0.get("priority", 10) if v0 else 10,
        iteration=v0.get("iteration", "iter-r1") if v0 else "iter-r1",
        security={
            "catalog_ref": (v0.get("security") or {}).get("catalog_ref", "AC-3") if v0 else "AC-3",
            "verification_note": v1_verification_note,
        },
        statement_hash=statement_hash(v1_statement),
        grooming_state="detailed",
        mint_kind="content",
    )
    if v1_verification_outcome is not None:
        ver["verification_outcome"] = v1_verification_outcome
    upsert_version(data, ver)
    if v1_verification_outcome is None:
        tip_ver = find(data.get("requirement_versions"), "uid", tip)
        if tip_ver and "verification_outcome" in tip_ver:
            tip_ver.pop("verification_outcome")
            stats["versions_updated"] += 1
    edges = data.setdefault("edges", [])
    ensure_edge(edges, {"from": tip, "to": base_uid, "kind": "refines"})
    for e in list(edges):
        if e.get("from") != base_uid or e.get("kind") not in copy_edge_kinds:
            continue
        copied = {k: v for k, v in e.items() if k in ("to", "kind", "catalog_imprint_id")}
        copied["from"] = tip
        ensure_edge(edges, copied)
    suspect_reason = (
        f"target line content-succeeded; edge still on superseded .0 ({base_uid})"
    )
    for e in edges:
        if e.get("to") != base_uid:
            continue
        if e.get("from") == tip and e.get("kind") == "refines":
            continue
        if not e.get("trace_suspect"):
            e["trace_suspect"] = True
            e["suspect_reason"] = suspect_reason
            stats["versions_updated"] += 1


def mint_capability_content_n(
    data,
    base_uid: str,
    v0_statement: str,
    v0_hash: str,
    v1_statement: str,
    v1_verification_note: str,
    *,
    v1_verification_outcome: str | None = "pass",
) -> None:
    mint_content_n(
        data,
        base_uid,
        v0_statement,
        v0_hash,
        v1_statement,
        v1_verification_note,
        v1_verification_outcome=v1_verification_outcome,
    )


def restore_shipped_release_delivers(data) -> None:
    """Shipped releases pin historical version UIDs; content mint must not rewrite them to .1."""
    replacements = {
        "rel-r0-sequences": {
            "CAP-RBAC.1": "CAP-RBAC",
            "CAP-SSO.1": "CAP-SSO",
            "CAP-SCOPED-VIEW.1": "CAP-SCOPED-VIEW",
        },
        "rel-r1-foundation-shell-auth": {
            "CAP-RBAC.1": "CAP-RBAC",
            "CAP-UI-FRAME.1": "CAP-UI-FRAME",
            "ARCH-API-RBAC.1": "ARCH-API-RBAC",
        },
    }
    for rel_id, mapping in replacements.items():
        rel = find(data.get("releases"), "id", rel_id)
        if not rel:
            continue
        rel["delivers"] = [mapping.get(d, d) for d in (rel.get("delivers") or [])]


def prune_legacy_grooming_edges(data) -> None:
    """Drop parent/section noise and stale CAP-RELATIONS satisfies (idempotent re-run)."""
    edges = data.setdefault("edges", [])
    noise = [
        ("ARCH-REQ-AC-FACET", "SEC-RL", "refines"),
        ("ARCH-REQ-AC-ROLLUP", "SEC-RL", "refines"),
        ("ARCH-TRACE-RECHECK", "SEC-EDGE", "refines"),
        ("ARCH-TRACE-VIEW-RTM", "SEC-UI", "refines"),
        ("ARCH-TRACE-VIEW-CCM", "SEC-UI", "refines"),
        ("ARCH-TRACE-LAYOUT-WORKER", "SEC-UI", "refines"),
        ("ARCH-CAT-EXTERNAL", "SEC-CAT", "refines"),
        ("ARCH-CAT-PROJECT-ROLLUP", "SEC-CAT", "refines"),
        ("ARCH-CAT-VISIBILITY", "SEC-CAT", "refines"),
        ("ARCH-HIER-REQ-DECOMP", "ARCH-CP-HIER", "refines"),
        ("ARCH-HIER-USES-DEP", "SEC-EDGE", "refines"),
        ("ARCH-HIER-SECTION-GROUP", "ARCH-CP-HIER", "refines"),
        ("ARCH-UI-KIT-SHARED", "SEC-UI", "refines"),
        ("ARCH-BROWSE-ROADMAP", "SEC-UI", "refines"),
        ("ARCH-SEC-EDGE-DEDUPE-DB", "SEC-EDGE", "refines"),
        ("ARCH-SEC-EDGE-DEDUPE-API", "SEC-EDGE", "refines"),
        ("ARCH-SEC-SEED-INTEGRITY", "SEC-IO", "refines"),
        ("ARCH-SEC-XPROJ-READ", "SEC-EDGE", "refines"),
        ("ARCH-SEC-REL-STUB", "SEC-EDGE", "refines"),
        ("ARCH-SEC-REL-PAGING", "SEC-EDGE", "refines"),
        ("ARCH-SEC-CAT-FK", "SEC-CAT", "refines"),
        ("ARCH-SEC-LOADER-EDGE-SYNC", "SEC-IO", "refines"),
        ("ARCH-SEC-CAT-LABEL-IMPRINT", "SEC-CAT", "refines"),
        ("ARCH-SEC-HEADERS", "SEC-SEC", "refines"),
        ("ARCH-WRITE-UOW-AUDIT", "SEC-API", "refines"),
        ("ARCH-WRITE-REPOSITORY-LAYER", "SEC-API", "refines"),
        ("ARCH-WRITE-TRUNCATE-GUARD", "SEC-API", "refines"),
        ("ARCH-WRITE-AUDIT-FLOOD", "SEC-API", "refines"),
        ("ARCH-WRITE-VERSION-UNIQUE", "SEC-API", "refines"),
        ("ARCH-WRITE-RESERVED-IDS", "SEC-API", "refines"),
        ("ARCH-KEY-RUNTIME-CACHE", "ARCH-KEY", "refines"),
        ("ARCH-TEST-HARNESS-TEARDOWN", "SEC-BUILD", "refines"),
        ("CAP-UI-KIT-TREE", "CAP-UI-KIT", "refines"),
        ("CAP-UI-KIT-CHROME", "CAP-UI-KIT", "refines"),
        ("ARCH-HIER-CAP-PARTOF", "ARCH-CP-HIER", "refines"),
        ("ARCH-BROWSE-ROADMAP", "C07", "refines"),
        ("ARCH-WRITE-UOW-AUDIT", "ARCH-CRED-AUDIT", "refines"),
        ("ARCH-WRITE-AUDIT-FLOOD", "ARCH-CRED-AUDIT", "refines"),
        ("ARCH-WRITE-TRUNCATE-GUARD", "ARCH-API-RBAC", "refines"),
        ("CAP-BROWSE-ROADMAP", "K03", "satisfies"),
        ("CAP-SEED-GROOMING", "K03", "satisfies"),
        ("CAP-RELATIONS-API", "ARCH-SEC-EDGE-DEDUPE-DB", "satisfies"),
        ("CAP-RELATIONS-API", "ARCH-SEC-EDGE-DEDUPE-API", "satisfies"),
        ("CAP-RELATIONS-API", "ARCH-SEC-XPROJ-READ", "satisfies"),
        ("CAP-RELATIONS-API", "ARCH-SEC-REL-PAGING", "satisfies"),
    ]
    for frm, to, kind in noise:
        remove_edge(edges, {"from": frm, "to": to, "kind": kind})


# Upstream refines: each groomed ARCH requirement → an existing requirement it elaborates.
ARCH_UPSTREAM_REFINES: list[tuple[str, str]] = [
    ("ARCH-REQ-AC-FACET", "ARCH-VERIFICATION"),
    ("ARCH-TRACE-RECHECK", "ARCH-SUSPECT"),
    ("ARCH-CAT-EXTERNAL", "ARCH-CAT-IMPRINT"),
    ("ARCH-TRACE-LAYOUT-WORKER", "E06"),
    ("ARCH-HIER-CAP-PARTOF", "ARCH-CAP-LINK"),
    ("ARCH-HIER-USES-DEP", "E03"),
    ("ARCH-HIER-SECTION-GROUP", "ARCH-SUBJECT-KIND"),
    ("ARCH-UI-KIT-SHARED", "ARCH-UI"),
    ("ARCH-BROWSE-ROADMAP", "H09"),
    ("ARCH-SEC-EDGE-DEDUPE-DB", "E04"),
    ("ARCH-SEC-EDGE-DEDUPE-API", "E04"),
    ("ARCH-SEC-SEED-INTEGRITY", "ARCH-DEVENV-SEED"),
    ("ARCH-SEC-XPROJ-READ", "ARCH-API-RBAC"),
    ("ARCH-SEC-REL-STUB", "E06"),
    ("ARCH-SEC-REL-PAGING", "ARCH-API"),
    ("ARCH-SEC-CAT-FK", "ARCH-CAT-SCOPE"),
    ("ARCH-SEC-LOADER-EDGE-SYNC", "ARCH-DEVENV-SEED"),
    ("ARCH-SEC-CAT-LABEL-IMPRINT", "ARCH-CAT-PIN"),
    ("ARCH-SEC-HEADERS", "ARCH-API"),
    ("ARCH-WRITE-UOW-AUDIT", "ARCH-OTEL"),
    ("ARCH-WRITE-REPOSITORY-LAYER", "ARCH-API-LAYERS"),
    ("ARCH-WRITE-TRUNCATE-GUARD", "ARCH-CP-SCOPE"),
    ("ARCH-WRITE-AUDIT-FLOOD", "ARCH-OTEL"),
    ("ARCH-WRITE-VERSION-UNIQUE", "ARCH-VER"),
    ("ARCH-WRITE-RESERVED-IDS", "ARCH-MINT-KIND"),
    ("ARCH-KEY-RUNTIME-CACHE", "ARCH-KEY-LIFECYCLE"),
    ("ARCH-TEST-HARNESS-TEARDOWN", "ARCH-BUILD-FOUNDATION"),
]


def wire_architecture_edges(data) -> None:
    edges = data.setdefault("edges", [])
    pairs = [
        ("ARCH-REQ-AC-ROLLUP", "ARCH-REQ-AC-FACET", "refines"),
        ("ARCH-SUSPECT", "ARCH-TRACE-RECHECK", "uses"),
        ("ARCH-HIER-USES-DEP", "ARCH-TRACE-RECHECK", "uses"),
        ("ARCH-TRACE-VIEW-RTM", "E06", "refines"),
        ("ARCH-TRACE-VIEW-CCM", "E06", "refines"),
        ("ARCH-CAT-VISIBILITY", "H09", "refines"),
        ("ARCH-CAT-PROJECT-ROLLUP", "ARCH-CAT-EXTERNAL", "refines"),
        ("ARCH-HIER-REQ-DECOMP", "C01", "refines"),
        ("ARCH-TRACE-VIEW-RTM", "CAP-UI-KIT-TREE", "uses"),
        ("ARCH-TRACE-VIEW-CCM", "CAP-UI-KIT-TREE", "uses"),
        ("CAP-UI-KIT", "ARCH-UI-KIT-SHARED", "satisfies"),
        ("CAP-UI-KIT", "ARCH-UI", "satisfies"),
        ("CAP-UI-KIT", "C07", "satisfies"),
        ("CAP-UI-KIT-TREE", "ARCH-UI-KIT-SHARED", "satisfies"),
        ("CAP-UI-KIT-CHROME", "ARCH-UI-KIT-SHARED", "satisfies"),
        ("CAP-BROWSE-ROADMAP", "ARCH-BROWSE-ROADMAP", "satisfies"),
        ("CAP-BROWSE-UI-TREE", "CAP-UI-KIT-TREE", "uses"),
        ("CAP-SEED-GROOMING", "ARCH-BROWSE-ROADMAP", "satisfies"),
        ("CAP-RELATIONS-API", "ARCH-SEC-REL-STUB", "satisfies"),
    ]
    for frm, to, kind in pairs:
        ensure_edge(edges, {"from": frm, "to": to, "kind": kind})
    for frm, to in ARCH_UPSTREAM_REFINES:
        ensure_edge(edges, {"from": frm, "to": to, "kind": "refines"})


# --- requirement bodies (shall statements) ---

REQ_ACCEPT_FACET = (
    "An acceptance criterion (facet) is a verifiable condition attached to exactly one requirement version — not a "
    "separate requirement line and not a capability line. Facets shall have no independent trace graph; satisfaction "
    "is recorded on the parent requirement. Each facet shall use a testable 'shall' statement. A child requirement "
    "line (decomposition) is a distinct concept per ARCH-HIER-REQ-DECOMP."
)
REQ_ACCEPT_ROLLUP = (
    "Requirement completeness shall roll up from acceptance criteria on the parent version: the parent is complete "
    "when every attached facet is satisfied; a facet is satisfied when at least one linked capability (or verified "
    "implementation) satisfies it. Partial facet satisfaction shall surface as incomplete on the parent."
)
REQ_RECHECK = (
    "Re-check (needs re-check) is a distinct state from incomplete: re-check applies to a criterion, control, or trace "
    "target that was previously complete whose conforming capability changed content, lost verification, or regressed. "
    "Incomplete means the target was never completed. Re-check shall be represented as trace_suspect (and review queues) "
    "separately from incomplete. Audit-sensitive targets — controls in the AU and AC families plus any target the user "
    "marks audit-sensitive — shall enter re-check when an upstream satisfying or conforming capability changes. A uses "
    "dependency change shall flag dependents for re-check without inheriting controls unless explicitly modeled."
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
    "The user shall choose which catalogs are visible in browse and trace views per user per project; the selection "
    "shall persist in server-side session or profile state keyed by (identity_id, project_id). The default when unset "
    "shall be all catalogs that have at least one conforms_to or catalog link in the project. Hidden catalogs shall not "
    "appear in control rollups or two-column catalog views until selected."
)
REQ_TRACE_RTM = (
    "The product shall provide a two-column traceability view with system requirements on the left and capabilities "
    "on the right, joined by satisfies edges (and refines where shown). Selecting a row on either column shall "
    "highlight the active joined path on both columns."
)
REQ_TRACE_CCM = (
    "The product shall provide a two-column traceability view with catalog controls on the left and capabilities on "
    "the right, joined by conforms_to edges. Selecting a row on either column shall highlight the active joined path "
    "on both columns. Direct ConformsTo pins shall render as solid links; inherited or aggregated links shall render "
    "dashed. A control shall be treated as heavy when it has more than 25 direct capability links in the current "
    "project view; heavy controls shall collapse into bundles by default with an expand affordance."
)
REQ_TRACE_WORKER = (
    "Layout, link aggregation, and rollup math for trace views shall run behind one small TypeScript interface "
    "executed off the main thread (Web Worker). The default implementation shall be plain TypeScript. WebAssembly "
    "shall be adopted only when plain TypeScript layout exceeds 50 ms at P95 on a reference project size (full "
    "dogfood trace graph)."
)
REQ_HIER_REQ = (
    "Requirement lines may have child requirement lines (decomposition). Child requirements shall roll up "
    "completeness and status into the parent. Requirements shall nest only under requirements or sections, never "
    "under capability lines."
)
REQ_HIER_CAP = (
    "Capability lines may have child capability lines (part-of composition). Child capabilities shall roll up "
    "operational/verification status into the parent. Child capabilities shall inherit the parent's conforms_to "
    "control pins unless a child override capability explicitly replaces them."
)
REQ_HIER_USES = (
    "A uses edge shall model dependency, not ownership: for example a page capability uses a shared header "
    "capability. Uses shall not pass conforms_to controls along the edge unless explicitly annotated. When a used "
    "capability changes, dependents shall enter re-check per ARCH-TRACE-RECHECK."
)
REQ_HIER_SEC = (
    "Section lines shall group siblings only. Section placement shall not imply status rollup, control inheritance, "
    "or satisfies/conforms_to propagation."
)
REQ_UIKIT = (
    "A UI Kit capability shall own shared presentation components (tree, header chrome, badges) as child capabilities "
    "(part-of under CAP-UI-KIT). Feature views shall use the shared tree via uses edges. Tree behavior shall meet "
    "WCAG 2.2 Level AA and keyboard navigation per the WAI-ARIA tree pattern. Paging label 'showing 100 of N' shall "
    "appear when a parent has more than 100 direct children. CAP-BROWSE-UI-TREE (shipped) embeds tree behavior inline "
    "today; a later refactor shall extract that implementation into CAP-UI-KIT-TREE without duplicating a11y requirements."
)
REQ_BROWSE_ROADMAP = (
    "The product shall provide read-only views for catalogs/imprints/controls, planning objects (contracts, iterations, "
    "change sets), capability artifacts, workflow objects, people/access bindings, and audit events — API first then "
    "matching browse UI per tranche. Delivery order and release names are recorded on CAP-BROWSE-ROADMAP. Relationships "
    "browse UI remains parallel (rel-r1-browse-ui-relations); do not duplicate here."
)

SEC_EDGE_DEDUPE_DB = (
    "Before the first trace edge write route ships, trace_edges shall enforce a unique index on "
    "(from_project_id, from_uid, COALESCE(to_project_id,''), to_uid, kind, catalog_imprint_id) so cross-project peer "
    "project ids participate in deduplication at persistence."
)
SEC_EDGE_DEDUPE_API = (
    "Trace edge create/update APIs shall treat the dedupe key as "
    "(from_project_id, from_uid, to_project_id, to_uid, kind, catalog_imprint_id) including the peer project id, "
    "matching the database uniqueness rule in ARCH-SEC-EDGE-DEDUPE-DB. The grant-scoped GET relations read API shall "
    "use the same peer-inclusive key when deduplicating edges in responses; requirements-relations.ts on main cb8a8c9 "
    "still omits the peer project id in its dedupe key — this requirement remains unsatisfied until a follow-up PR."
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
    "catalog_defs.project_id shall reference projects(id) with a foreign key when project-scoped catalogs are stored. "
    "Parallel PR #33 migration 010 delivers this constraint."
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
WRITE_UOW = (
    "Mutating domain operations shall run inside a unit-of-work boundary that appends audit events atomically with "
    "business writes."
)
WRITE_REPO = (
    "HTTP route adapters shall not embed SQL; persistence shall go through a repository layer invoked from the "
    "unit-of-work boundary."
)
WRITE_TRUNCATE = (
    "The database shall install a TRUNCATE guard (trigger or equivalent) and the runtime application DB role shall "
    "not be table owner, curbing destructive SQL from compromised credentials."
)
WRITE_AUDIT_FLOOD = (
    "Audit append endpoints shall require authentication or rate limiting so unauthenticated callers cannot flood "
    "audit storage."
)
WRITE_VERSION_UNIQUE = (
    "The schema shall enforce UNIQUE (project_id, base_uid, version_n) on requirement versions."
)
WRITE_RESERVED_IDS = (
    "Minting requirement or capability ids shall reject reserved path segments defined by the product id policy."
)
SEC_KEY_CACHE = (
    "The runtime shall cache the unwrapped signing key in-process for performance, shall clear that cache on key "
    "rotation events, and shall flush OpenTelemetry spans on graceful shutdown after draining in-flight token "
    "operations."
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
    arch_catalog = {
        "ARCH-SEC-EDGE-DEDUPE-DB": "CM-6",
        "ARCH-SEC-EDGE-DEDUPE-API": "AC-4",
        "ARCH-SEC-SEED-INTEGRITY": "CM-6",
        "ARCH-SEC-XPROJ-READ": "AC-3",
        "ARCH-SEC-REL-STUB": "AC-4",
        "ARCH-SEC-REL-PAGING": "AC-3",
        "ARCH-SEC-CAT-FK": "CM-6",
        "ARCH-SEC-LOADER-EDGE-SYNC": "CM-6",
        "ARCH-SEC-CAT-LABEL-IMPRINT": "CM-6",
        "ARCH-SEC-HEADERS": "SC-8",
        "ARCH-WRITE-UOW-AUDIT": "AU-9",
        "ARCH-WRITE-AUDIT-FLOOD": "AU-9",
        "ARCH-WRITE-TRUNCATE-GUARD": "CM-6",
        "ARCH-KEY-RUNTIME-CACHE": "SC-12",
        "ARCH-TRACE-RECHECK": "CM-3",
    }
    arch_reqs = [
        ("ARCH-REQ-AC-FACET", "SEC-RL", "Acceptance criteria facets", REQ_ACCEPT_FACET, "requirement:tree:read"),
        ("ARCH-REQ-AC-ROLLUP", "SEC-RL", "Roll up completeness from facets", REQ_ACCEPT_ROLLUP, "requirement:tree:read"),
        ("ARCH-TRACE-RECHECK", "SEC-EDGE", "Needs re-check (look-back completeness)", REQ_RECHECK, "trace:suspect"),
        ("ARCH-CAT-EXTERNAL", "SEC-CAT", "Catalogs represented outside project tree", REQ_CAT_REP, "catalog:browse"),
        ("ARCH-CAT-PROJECT-ROLLUP", "SEC-CAT", "Catalog control project rollup", REQ_CAT_ROLLUP, "catalog:browse"),
        ("ARCH-CAT-VISIBILITY", "SEC-CAT", "User-selected visible catalogs", REQ_CAT_PICK, "catalog:browse"),
        ("ARCH-TRACE-VIEW-RTM", "SEC-UI", "Two-column requirements ↔ capabilities view", REQ_TRACE_RTM, None),
        ("ARCH-TRACE-VIEW-CCM", "SEC-UI", "Two-column controls ↔ capabilities view", REQ_TRACE_CCM, None),
        ("ARCH-TRACE-LAYOUT-WORKER", "SEC-UI", "Off-main-thread trace layout engine", REQ_TRACE_WORKER, None),
        ("ARCH-HIER-REQ-DECOMP", "ARCH-CP-HIER", "Requirement decomposition rollup", REQ_HIER_REQ, "requirement:line:create"),
        (
            "ARCH-HIER-CAP-PARTOF",
            "ARCH-CP-HIER",
            "Capability part-of rollup",
            REQ_HIER_CAP,
            None,
        ),
        ("ARCH-HIER-USES-DEP", "SEC-EDGE", "Uses dependency without control pass-through", REQ_HIER_USES, None),
        ("ARCH-HIER-SECTION-GROUP", "ARCH-CP-HIER", "Sections group only (no rollup)", REQ_HIER_SEC, "requirement:tree:read"),
        ("ARCH-UI-KIT-SHARED", "SEC-UI", "UI Kit shared components", REQ_UIKIT, None),
        ("ARCH-BROWSE-ROADMAP", "SEC-UI", "Read-only browse priority order", REQ_BROWSE_ROADMAP, "requirement:tree:read"),
        ("ARCH-SEC-EDGE-DEDUPE-DB", "SEC-EDGE", "Trace edge dedupe index (DB)", SEC_EDGE_DEDUPE_DB, None),
        ("ARCH-SEC-EDGE-DEDUPE-API", "SEC-EDGE", "Trace edge dedupe key (API)", SEC_EDGE_DEDUPE_API, None),
        ("ARCH-SEC-SEED-INTEGRITY", "SEC-IO", "Seed loader base_uid and delivers integrity", SEC_SEED_BASE_UID, None),
        ("ARCH-SEC-XPROJ-READ", "SEC-EDGE", "Cross-project link requires target read", SEC_XPROJ_LINK, "requirement:tree:read"),
        ("ARCH-SEC-REL-STUB", "SEC-EDGE", "Restricted relation stub shape", SEC_STUB_DESIGN, None),
        ("ARCH-SEC-REL-PAGING", "SEC-EDGE", "Relations response paging", SEC_REL_PAGE, "requirement:tree:read"),
        ("ARCH-SEC-CAT-FK", "SEC-CAT", "catalog_defs.project_id FK", SEC_CAT_FK, None),
        ("ARCH-SEC-LOADER-EDGE-SYNC", "SEC-IO", "Seed loader deletes removed trace edges", SEC_LOADER_EDGE_SYNC, None),
        ("ARCH-SEC-CAT-LABEL-IMPRINT", "SEC-CAT", "Catalog labels keyed per imprint", SEC_CAT_LABEL_KEY, None),
        ("ARCH-SEC-HEADERS", "SEC-SEC", "Security headers before wide bind", SEC_HEADERS, None),
        ("ARCH-WRITE-UOW-AUDIT", "SEC-API", "Write unit-of-work with audit", WRITE_UOW, None),
        ("ARCH-WRITE-REPOSITORY-LAYER", "SEC-API", "Repository layer (no SQL in routes)", WRITE_REPO, None),
        ("ARCH-WRITE-TRUNCATE-GUARD", "SEC-API", "TRUNCATE guard and runtime DB role", WRITE_TRUNCATE, None),
        ("ARCH-WRITE-AUDIT-FLOOD", "SEC-API", "Audit append flood controls", WRITE_AUDIT_FLOOD, None),
        ("ARCH-WRITE-VERSION-UNIQUE", "SEC-API", "Unique requirement version constraint", WRITE_VERSION_UNIQUE, None),
        ("ARCH-WRITE-RESERVED-IDS", "SEC-API", "Reject reserved id segments at mint", WRITE_RESERVED_IDS, None),
        ("ARCH-KEY-RUNTIME-CACHE", "ARCH-KEY", "Signing key cache and span flush on shutdown", SEC_KEY_CACHE, None),
        ("ARCH-TEST-HARNESS-TEARDOWN", "SEC-BUILD", "createTestApp closes DB on setup failure", SEC_TEST_TEARDOWN, None),
    ]
    for base_uid, parent, title, stmt, rbac in arch_reqs:
        note = "Groomed 2026-10-09; pre-write or UI track."
        if base_uid == "ARCH-HIER-CAP-PARTOF":
            note += " rbac_op capability:view proposed for future hierarchy browse."
        if base_uid == "ARCH-HIER-USES-DEP":
            note += " rbac_op trace:edit proposed for future trace mutation routes."
        add_requirement(
            data,
            base_uid=base_uid,
            parent=parent,
            kind="requirement",
            title=title,
            statement=stmt,
            rbac_op=rbac,
            catalog_ref=arch_catalog.get(base_uid, "CM-2"),
            verification_note=note,
        )

    patch_statement(
        "ARCH-SUSPECT",
        "When a target line receives a content mint_kind=.N, inbound trace edges (satisfies/refines/uses) and "
        "contract in_scope_of / release delivers junctions that pin a prior version of that line are marked "
        "trace_suspect=true. Pin-only migrate (mint_kind=pin) updates the ConformsTo pin and does NOT suspect that "
        "pin. Semantics for re-check vs incomplete and audit-sensitive rollups are defined in ARCH-TRACE-RECHECK; "
        "UI and APIs shall surface trace_suspect separately from incomplete. Detect bed: edge FIX-CONTRACT-DOC-NOCTX "
        "→ FIX-SUCC-2HOP.1 (stale uses on superseded UID).",
    )

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
            "Lazy tree with expand/collapse, WCAG 2.2 AA keyboard navigation per WAI-ARIA tree pattern, and parent "
            "paging label 'showing 100 of N' when more than 100 direct children exist. Shipped CAP-BROWSE-UI-TREE "
            "will be refactored to consume this widget later (see ARCH-UI-KIT-SHARED).",
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

    delete_release(data, "rel-r1-catalogs-api")
    remove_requirement(data, "ARCH-WRITE-FOUNDATION")
    remove_requirement(data, "ARCH-SEC-EDGE-DEDUPE")

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
        satisfies=["ARCH-BROWSE-ROADMAP"],
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

    patch_verification(
        "CAP-RELATIONS-API",
        None,
        "Runtime on main (PR #31); rel-r1-relations-api release still planned in a parallel seed PR.",
    )

    ensure_r0_sequences_note(data)
    dedupe_seed_grooming_approvals(data)
    prune_legacy_grooming_edges(data)
    wire_architecture_edges(data)

    # --- B: content mints after trace edges (so inbound refines get trace_suspect on first run) ---
    mint_content_n(
        data,
        "CAP-SSO",
        CAP_SSO_V0_STMT,
        CAP_SSO_V0_HASH,
        CAP_SSO_V1_STMT,
        "R0 design pack; federation not shipped — do not mark pass until ARCH-AUTH-FEDERATION delivers.",
        v1_verification_outcome=None,
    )
    mint_content_n(
        data,
        "CAP-SCOPED-VIEW",
        CAP_SCOPED_V0_STMT,
        CAP_SCOPED_V0_HASH,
        CAP_SCOPED_V1_STMT,
        "Partial: browse read scope shipped; full scoped-view mutate UX not complete.",
        v1_verification_outcome="pending",
    )
    mint_capability_content_n(
        data,
        "CAP-RBAC",
        CAP_RBAC_V0_STMT,
        CAP_RBAC_V0_HASH,
        CAP_RBAC_V1_STMT,
        f"Partial pass on .1: foundation + read routes verified; full matrix deferred to core-ALM. {PR13_EVIDENCE}",
    )
    mint_content_n(
        data,
        "ARCH-API-RBAC",
        ARCH_API_RBAC_V0_STMT,
        ARCH_API_RBAC_V0_HASH,
        ARCH_API_RBAC_V1_STMT,
        "Maps to ReqALM RBAC catalog item; .1 narrows honesty vs CAP-RBAC enforcement subset.",
        v1_verification_outcome=None,
    )
    mint_capability_content_n(
        data,
        "CAP-UI-FRAME",
        CAP_UI_FRAME_V0_STMT,
        CAP_UI_FRAME_V0_HASH,
        CAP_UI_FRAME_V1_STMT,
        f"Partial pass on .1: shell + guards verified on PR #13; full UI catalog still planned. {PR13_EVIDENCE}",
    )
    restore_shipped_release_delivers(data)

    ar_cp = find(data.get("approval_records"), "id", "ar-browse-ui-cp")
    if ar_cp and "Planned for browse UI PR" in (ar_cp.get("notes") or ""):
        ar_cp["notes"] = "Shipped with browse UI PR #23 (merge b5c7b5e9efd48de95e5e0ca5a71e23cb0a640f4a)."
        bump_status_correction()

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)

    print("Patched dogfood.yaml (seed grooming)")
    for k, v in stats.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
