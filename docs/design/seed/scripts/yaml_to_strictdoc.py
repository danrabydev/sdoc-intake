#!/usr/bin/env python3
"""ReqALM seed: convert dogfood YAML → StrictDoc 0.30 .sdoc (interchange only)."""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path
import re
from typing import Any

try:
    import yaml
except ImportError:
    print(
        "error: PyYAML is required. Install with:\n"
        "  pip install pyyaml\n"
        "  # or on PEP 668 hosts:\n"
        "  pip install --user --break-system-packages pyyaml",
        file=sys.stderr,
    )
    sys.exit(1)


SEED_DIR = Path(__file__).resolve().parent.parent
DEFAULT_IN = SEED_DIR / "dogfood.yaml"
DEFAULT_OUT = SEED_DIR / "out"

# StrictDoc 0.30 RequirementStatus: Draft | Active | Deleted
STATUS_MAP = {
    "draft": "Draft",
    "active": "Active",
    "obsolete": "Deleted",
    "withdrawn": "Deleted",
}

# Align with sdoc-intake / Northline grammar (PascalCase Parent ROLEs).
ROLE_MAP = {
    "satisfies": "Satisfies",
    "conforms_to": "ConformsTo",
    "uses": "Uses",
    "refines": "Refines",
}

# Catalog UIDs live in separate .sdoc files under seed/catalog/ (and
# reqalm-strictdoc/input/catalog/). Product edges ConformsTo those UIDs;
# converter must not emit catalog controls into requirements.sdoc.
_CATALOG_UID_RE = re.compile(
    r"^(?:"
    r"[A-Z]{1,4}-\d+(?:\.\d+)?|"  # NIST-style AC-3, IA-2, CM-3.1
    r"V-\d+"                      # ASD STIG V-222536
    r")$"
)


def is_catalog_uid(uid: str | None) -> bool:
    return bool(uid and _CATALOG_UID_RE.match(uid))


def role_name(kind: str | None) -> str:
    if not kind:
        return ""
    return ROLE_MAP.get(kind, kind)


def load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise SystemExit(f"error: root of {path} must be a mapping")
    return data


def validate(data: dict[str, Any]) -> list[str]:
    """Lightweight UID/parent checks (no JSON Schema engine required)."""
    errs: list[str] = []
    lines = data.get("requirement_lines") or []
    versions = data.get("requirement_versions") or []
    base_uids = {ln.get("base_uid") for ln in lines if ln.get("base_uid")}
    ver_uids = {v.get("uid") for v in versions if v.get("uid")}

    for ln in lines:
        bu = ln.get("base_uid")
        parent = ln.get("parent")
        kind = ln.get("kind")
        if not bu:
            errs.append("requirement_line missing base_uid")
        if kind not in ("section", "requirement", "control", "capability", "release_node"):
            errs.append(f"line {bu}: invalid kind {kind!r}")
        if parent is not None and parent not in base_uids:
            errs.append(f"line {bu}: parent {parent!r} is not a line base_uid")

    for ver in versions:
        uid = ver.get("uid")
        base = ver.get("base_uid")
        vn = ver.get("version_n")
        status = ver.get("status")
        if base not in base_uids:
            errs.append(f"version {uid}: base_uid {base!r} has no line")
        if status not in ("draft", "active", "superseded", "obsolete", "withdrawn"):
            errs.append(f"version {uid}: invalid status {status!r}")
        if not isinstance(vn, int) or vn < 0:
            errs.append(f"version {uid}: version_n must be int >= 0")
        if vn == 0:
            if uid not in (base, f"{base}.0"):
                errs.append(
                    f"version {uid}: version_n 0 should use uid {base!r} or {base!r}.0"
                )
        else:
            expected = f"{base}.{vn}"
            if uid != expected:
                errs.append(f"version {uid}: expected uid {expected!r} for version_n={vn}")

    imprint_ids = {
        imp.get("id") for imp in (data.get("catalog_imprints") or []) if imp.get("id")
    }
    for imp in data.get("catalog_imprints") or []:
        if not imp.get("id"):
            errs.append("catalog_imprint missing id")
        if not imp.get("catalog_id"):
            errs.append(f"catalog_imprint {imp.get('id')!r}: missing catalog_id")
        if not imp.get("sdoc_path"):
            errs.append(f"catalog_imprint {imp.get('id')!r}: missing sdoc_path")

    for edge in data.get("edges") or []:
        frm, to = edge.get("from"), edge.get("to")
        # from must be a product version; to may be version or external catalog UID
        if frm not in ver_uids:
            errs.append(f"edge {edge}: from {frm!r} not a version uid")
        if to not in ver_uids and not is_catalog_uid(to):
            errs.append(f"edge {edge}: to {to!r} not a version uid or catalog UID")
        if edge.get("kind") not in ("refines", "conforms_to", "uses", "satisfies"):
            errs.append(f"edge {edge}: invalid kind")
        if edge.get("kind") == "conforms_to" and is_catalog_uid(to):
            cid = edge.get("catalog_imprint_id")
            if not cid:
                errs.append(
                    f"edge {frm!r}→{to!r} conforms_to: missing catalog_imprint_id "
                    "(pin is imprint_id + item_uid)"
                )
            elif imprint_ids and cid not in imprint_ids:
                errs.append(
                    f"edge {frm!r}→{to!r} conforms_to: catalog_imprint_id {cid!r} "
                    "not in catalog_imprints"
                )

    release_ids = {r.get("id") for r in (data.get("releases") or []) if r.get("id")}

    for c in data.get("contracts") or []:
        for u in c.get("in_scope_of") or []:
            if u not in ver_uids:
                errs.append(f"contract {c.get('name')}: in_scope_of {u!r} not a version uid")
        for rid in c.get("covers_releases") or []:
            if rid not in release_ids:
                errs.append(f"contract {c.get('name')}: covers_releases {rid!r} not a release id")

    for r in data.get("releases") or []:
        for u in r.get("delivers") or []:
            if u not in ver_uids:
                errs.append(f"release {r.get('name')}: delivers {u!r} not a version uid")

    return errs


def escape_sdoc_text(text: str) -> str:
    return (text or "").rstrip() + "\n"


def comment_block(lines: list[str]) -> str:
    body = "\n".join(lines).rstrip() + "\n"
    return f"COMMENT: >>>\n{body}<<<\n"


def map_status(raw: str | None, *, default: str = "Draft") -> str:
    if not raw:
        return default
    return STATUS_MAP.get(raw, default)


def pick_version(versions_by_base: dict[str, list[dict]], base_uid: str) -> dict | None:
    vers = versions_by_base.get(base_uid) or []
    if not vers:
        return None
    active = [v for v in vers if v.get("status") == "active"]
    pool = active or vers
    return max(pool, key=lambda v: int(v.get("version_n") or 0))


def build_children(lines: list[dict]) -> dict[str | None, list[dict]]:
    children: dict[str | None, list[dict]] = defaultdict(list)
    for ln in lines:
        parent = ln.get("parent")
        children[parent].append(ln)
    return children


def parent_relation_uid(
    parent_base: str | None,
    lines_by_base: dict[str, dict],
    versions_by_base: dict[str, list[dict]],
) -> str | None:
    """Map ReqALM line parent base_uid → StrictDoc Parent VALUE (section or req UID)."""
    if not parent_base:
        return None
    parent_ln = lines_by_base.get(parent_base) or {}
    if parent_ln.get("kind") == "section":
        return parent_base
    ver = pick_version(versions_by_base, parent_base)
    return (ver or {}).get("uid") or parent_base


def emit_requirement_version(
    *,
    base: str,
    kind: str,
    title: str,
    ver: dict,
    parent_uid: str | None,
    edges_by_uid: dict[str, list[dict]],
    contract_membership: dict[str, list[str]],
    release_membership: dict[str, list[str]],
    contract_uid_membership: dict[str, list[str]] | None = None,
    release_uid_membership: dict[str, list[str]] | None = None,
    emit_outgoing: bool,
    allowed_role_edges: set[tuple[str, str, str]] | None = None,
    child_role_edges: set[tuple[str, str, str]] | None = None,
) -> list[str]:
    """Emit a single [REQUIREMENT] for one version row."""
    out: list[str] = []
    uid = ver.get("uid") or base
    status = map_status(ver.get("status"), default="Draft")
    stmt = ver.get("statement") or title

    out.append("[REQUIREMENT]")
    out.append(f"UID: {uid}")
    out.append(f"STATUS: {status}")
    out.append(f"TITLE: {title}")
    out.append("STATEMENT: >>>")
    out.append(escape_sdoc_text(stmt).rstrip())
    out.append("<<<")

    cmt: list[str] = [
        f"KIND: {kind}",
        f"BASE_UID: {base}",
        f"VERSION_N: {ver.get('version_n', 0)}",
    ]
    if ver.get("rbac_op"):
        cmt.append(f"rbac_op: {ver['rbac_op']}")
    if ver.get("priority") is not None:
        cmt.append(f"priority: {ver['priority']}")
    if ver.get("iteration"):
        cmt.append(f"iteration: {ver['iteration']}")
    sec = ver.get("security") or {}
    if sec.get("catalog_ref"):
        cmt.append(f"security.catalog_ref: {sec['catalog_ref']}")
    if sec.get("verification_note"):
        cmt.append(f"security.verification_note: {sec['verification_note']}")
    drift = ver.get("catalog_drift") or {}
    if drift:
        cmt.append(
            "catalog_drift: "
            f"status={drift.get('status')} class={drift.get('change_class')} "
            f"item={drift.get('item_uid')} "
            f"from={drift.get('imprint_from')} to={drift.get('imprint_to')}"
        )
    for e in edges_by_uid.get(f"to:{uid}", []):
        cmt.append(f"edge: ← {e['kind']} from {e['from']}")
    for name in contract_membership.get(uid, []):
        cmt.append(f"in_scope_of_contract: {name}")
    for name in release_membership.get(uid, []):
        cmt.append(f"delivered_by_release: {name}")

    allowed_role_edges = allowed_role_edges or set()
    child_role_edges = child_role_edges or set()
    contract_uid_membership = contract_uid_membership or {}
    release_uid_membership = release_uid_membership or {}

    parent_outgoing: list[dict] = []
    child_outgoing: list[dict] = []
    skipped_missing: list[str] = []
    if emit_outgoing:
        for e in edges_by_uid.get(uid, []):
            if e.get("from") != uid:
                continue
            key = (e["from"], e["to"], e["kind"])
            imprint = e.get("catalog_imprint_id")
            imprint_note = f" imprint={imprint}" if imprint else ""
            if key in allowed_role_edges:
                parent_outgoing.append(e)
                if imprint and e.get("kind") == "conforms_to":
                    cmt.append(
                        f"edge: → conforms_to to {e['to']} (pin imprint={imprint})"
                    )
            elif key in child_role_edges:
                child_outgoing.append(e)
                cmt.append(
                    f"edge: → {e['kind']} to {e['to']}{imprint_note} "
                    "(RELATIONS TYPE: Child; Parent would cycle)"
                )
            else:
                # Target UID not in export/catalogs — cannot emit RELATIONS.
                skipped_missing.append(f"{e['kind']} to {e['to']}")
                cmt.append(
                    f"edge: → {e['kind']} to {e['to']}{imprint_note} "
                    "(no RELATIONS: target missing)"
                )

    out.append(comment_block(cmt).rstrip())

    # Reverse membership as Child ROLE (dense interchange). Same-ROLE Parent+Child
    # dual-declare needs idempotent StrictDoc graph links (patched on this box)
    # or --no-child-membership for unpatched StrictDoc.
    child_contracts = contract_uid_membership.get(uid, [])
    child_releases = release_uid_membership.get(uid, [])

    if parent_uid or parent_outgoing or child_outgoing or child_contracts or child_releases:
        out.append("RELATIONS:")
        if parent_uid:
            out.append("- TYPE: Parent")
            out.append(f"  VALUE: {parent_uid}")
        for e in parent_outgoing:
            out.append("- TYPE: Parent")
            out.append(f"  VALUE: {e['to']}")
            out.append(f"  ROLE: {role_name(e['kind'])}")
        for e in child_outgoing:
            out.append("- TYPE: Child")
            out.append(f"  VALUE: {e['to']}")
            out.append(f"  ROLE: {role_name(e['kind'])}")
        for cuid in child_contracts:
            out.append("- TYPE: Child")
            out.append(f"  VALUE: {cuid}")
            out.append("  ROLE: InScopeOf")
        for ruid in child_releases:
            out.append("- TYPE: Child")
            out.append(f"  VALUE: {ruid}")
            out.append("  ROLE: Delivers")
    out.append("")
    return out


def emit_node(
    ln: dict,
    children: dict[str | None, list[dict]],
    versions_by_base: dict[str, list[dict]],
    edges_by_uid: dict[str, list[dict]],
    contract_membership: dict[str, list[str]],
    release_membership: dict[str, list[str]],
    lines_by_base: dict[str, dict],
    indent_level: int,
    required_version_uids: set[str] | None = None,
    allowed_role_edges: set[tuple[str, str, str]] | None = None,
    child_role_edges: set[tuple[str, str, str]] | None = None,
    contract_uid_membership: dict[str, list[str]] | None = None,
    release_uid_membership: dict[str, list[str]] | None = None,
) -> list[str]:
    """Emit SECTION or REQUIREMENT for a line, then recurse."""
    out: list[str] = []
    base = ln["base_uid"]
    kind = ln["kind"]
    title = ln.get("title") or base
    ver = pick_version(versions_by_base, base)
    parent_base = ln.get("parent")
    parent_uid = parent_relation_uid(parent_base, lines_by_base, versions_by_base)
    required_version_uids = required_version_uids or set()
    allowed_role_edges = allowed_role_edges or set()
    child_role_edges = child_role_edges or set()
    contract_uid_membership = contract_uid_membership or {}
    release_uid_membership = release_uid_membership or {}

    if kind == "section":
        out.append("[[SECTION]]")
        out.append(f"UID: {base}")
        out.append(f"TITLE: {title}")
        out.append("")

        # Section body text is not allowed as STATEMENT/COMMENT on SECTION in 0.30;
        # emit as freestanding TEXT under the section when present.
        if ver and ver.get("statement"):
            out.append("[TEXT]")
            out.append(f"UID: {base}-INTRO")
            out.append("STATEMENT: >>>")
            out.append(escape_sdoc_text(ver["statement"]).rstrip())
            out.append("<<<")
            out.append("")

        for child in children.get(base, []):
            out.extend(
                emit_node(
                    child,
                    children,
                    versions_by_base,
                    edges_by_uid,
                    contract_membership,
                    release_membership,
                    lines_by_base,
                    indent_level + 1,
                    required_version_uids,
                    allowed_role_edges,
                    child_role_edges,
                    contract_uid_membership,
                    release_uid_membership,
                )
            )
        out.append("[[/SECTION]]")
        out.append("")
        return out

    # requirement | control | capability | release_node → [REQUIREMENT]
    # Emit edge-referenced prior versions first (e.g. A12 before A12.1), then the
    # picked (usually active) version so succession ROLE targets exist in-document.
    picked_uid = (ver or {}).get("uid") or base
    extras = [
        v
        for v in (versions_by_base.get(base) or [])
        if v.get("uid") in required_version_uids and v.get("uid") != picked_uid
    ]
    extras.sort(key=lambda v: int(v.get("version_n") or 0))
    for ev in extras:
        out.extend(
            emit_requirement_version(
                base=base,
                kind=kind,
                title=title,
                ver=ev,
                parent_uid=parent_uid,
                edges_by_uid=edges_by_uid,
                contract_membership=contract_membership,
                release_membership=release_membership,
                contract_uid_membership=contract_uid_membership,
                release_uid_membership=release_uid_membership,
                emit_outgoing=True,
                allowed_role_edges=allowed_role_edges,
                child_role_edges=child_role_edges,
            )
        )

    if ver:
        out.extend(
            emit_requirement_version(
                base=base,
                kind=kind,
                title=title,
                ver=ver,
                parent_uid=parent_uid,
                edges_by_uid=edges_by_uid,
                contract_membership=contract_membership,
                release_membership=release_membership,
                contract_uid_membership=contract_uid_membership,
                release_uid_membership=release_uid_membership,
                emit_outgoing=True,
                allowed_role_edges=allowed_role_edges,
                child_role_edges=child_role_edges,
            )
        )
    else:
        # No version row — emit a stub from the line alone.
        out.extend(
            emit_requirement_version(
                base=base,
                kind=kind,
                title=title,
                ver={"uid": base, "version_n": 0, "status": "draft", "statement": title},
                parent_uid=parent_uid,
                edges_by_uid=edges_by_uid,
                contract_membership=contract_membership,
                release_membership=release_membership,
                contract_uid_membership=contract_uid_membership,
                release_uid_membership=release_uid_membership,
                emit_outgoing=True,
                allowed_role_edges=allowed_role_edges,
                child_role_edges=child_role_edges,
            )
        )

    # Nest children under a synthetic SECTION so tree survives; also Parent RELATIONS
    # on each child point at this requirement UID.
    kids = children.get(base, [])
    if kids:
        out.append("[[SECTION]]")
        out.append(f"UID: {base}-CHILDREN")
        out.append(f"TITLE: Children of {base}")
        out.append("")
        for child in kids:
            out.extend(
                emit_node(
                    child,
                    children,
                    versions_by_base,
                    edges_by_uid,
                    contract_membership,
                    release_membership,
                    lines_by_base,
                    indent_level + 1,
                    required_version_uids,
                    allowed_role_edges,
                    child_role_edges,
                    contract_uid_membership,
                    release_uid_membership,
                )
            )
        out.append("[[/SECTION]]")
        out.append("")

    return out



def select_acyclic_role_edges(
    *,
    lines: list[dict],
    versions_by_base: dict[str, list[dict]],
    lines_by_base: dict[str, dict],
    edges: list[dict],
    required_version_uids: set[str],
) -> tuple[set[tuple[str, str, str]], set[tuple[str, str, str]]]:
    """Split semantic edges into Parent ROLE (acyclic) vs Child ROLE (cycle breakers).

    StrictDoc HTML export recurses Parent links; dogfood semantic edges can
    reverse a tree parent (e.g. ARCH-UI uses ARCH-UI-GUARD) or form ROLE loops.
    Edges that would cycle as Parent are still emitted as TYPE: Child + same ROLE
    so every YAML edge appears as a RELATIONS entry when the target UID exists.
    """
    # Emitted requirement UIDs (picked + edge-referenced extras).
    emitted: set[str] = set()
    for ln in lines:
        base = ln["base_uid"]
        if ln.get("kind") == "section":
            emitted.add(base)
            continue
        ver = pick_version(versions_by_base, base)
        picked = (ver or {}).get("uid") or base
        emitted.add(picked)
        for v in versions_by_base.get(base) or []:
            uid = v.get("uid")
            if uid and uid in required_version_uids:
                emitted.add(uid)

    # Directed edges child -> parent (StrictDoc Parent VALUE semantics).
    graph: dict[str, set[str]] = {u: set() for u in emitted}

    def would_cycle(frm: str, to: str) -> bool:
        """True if adding frm -> to creates a path to -> ... -> frm."""
        if frm == to:
            return True
        stack = [to]
        seen = {to}
        while stack:
            n = stack.pop()
            if n == frm:
                return True
            for nxt in graph.get(n, ()):
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        return False

    # Tree parents first (mandatory).
    for ln in lines:
        if ln.get("kind") == "section":
            continue
        base = ln["base_uid"]
        ver = pick_version(versions_by_base, base)
        picked = (ver or {}).get("uid") or base
        parent_uid = parent_relation_uid(ln.get("parent"), lines_by_base, versions_by_base)
        if parent_uid and picked in graph:
            # Extra versions share the same tree parent.
            for uid in list(emitted):
                # same base extras: uid is version of base
                pass
            targets = [picked]
            for v in versions_by_base.get(base) or []:
                uid = v.get("uid")
                if uid and uid in emitted and uid != picked:
                    targets.append(uid)
            for uid in targets:
                if parent_uid not in graph:
                    graph[parent_uid] = set()
                if not would_cycle(uid, parent_uid):
                    graph.setdefault(uid, set()).add(parent_uid)

    allowed: set[tuple[str, str, str]] = set()
    child_fallback: set[tuple[str, str, str]] = set()
    # Prefer higher-value kinds first so Satisfies/ConformsTo survive over Uses loops.
    # Keys are YAML edge kinds (snake_case); emission maps to PascalCase ROLEs.
    kind_rank = {
        "satisfies": 0,
        "Satisfies": 0,
        "conforms_to": 1,
        "ConformsTo": 1,
        "refines": 2,
        "Refines": 2,
        "uses": 3,
        "Uses": 3,
    }
    ordered = sorted(
        edges,
        key=lambda e: (kind_rank.get(e.get("kind"), 9), e.get("from") or "", e.get("to") or ""),
    )
    for e in ordered:
        frm, to, kind = e.get("from"), e.get("to"), e.get("kind")
        if not frm or not to or not kind:
            continue
        if frm not in emitted:
            continue
        # External catalog UID (NIST AC-*/AU-*/… or STIG V-*) — Parent ROLE target
        # lives in a sibling .sdoc; cannot cycle within this document.
        if to not in emitted:
            if is_catalog_uid(to):
                allowed.add((frm, to, kind))
            continue
        if would_cycle(frm, to):
            # Still emit as Child + ROLE (does not add frm->to Parent arc).
            child_fallback.add((frm, to, kind))
            continue
        graph.setdefault(frm, set()).add(to)
        allowed.add((frm, to, kind))
    return allowed, child_fallback


def write_document_header(
    parts: list[str],
    *,
    title: str,
    uid: str,
    client: dict,
    project: dict,
    schema_version: Any,
    extra_meta: list[tuple[str, str]] | None = None,
) -> None:
    parts.append("[DOCUMENT]")
    parts.append(f"TITLE: {title}")
    parts.append(f"UID: {uid}")
    if schema_version:
        parts.append(f"VERSION: {schema_version}")
    # Text markup avoids RST choke on free-form COMMENT meta lines.
    parts.append("OPTIONS:")
    parts.append("  MARKUP: Text")
    parts.append("METADATA:")
    parts.append(f"  client: {client.get('name')} ({client.get('id')})")
    parts.append(f"  project: {project.get('name')} ({project.get('id')})")
    parts.append(f"  schema_version: {schema_version}")
    parts.append("  note: ReqALM dogfood export — StrictDoc interchange only")
    for key, val in extra_meta or []:
        parts.append(f"  {key}: {val}")
    parts.append("")
    # StrictDoc requires every Parent ROLE to be registered on REQUIREMENT.
    parts.extend(
        [
            "[GRAMMAR]",
            "ELEMENTS:",
            "- TAG: TEXT",
            "  FIELDS:",
            "  - TITLE: UID",
            "    TYPE: String",
            "    REQUIRED: False",
            "  - TITLE: STATEMENT",
            "    TYPE: String",
            "    REQUIRED: True",
            "- TAG: REQUIREMENT",
            "  FIELDS:",
            "  - TITLE: UID",
            "    TYPE: String",
            "    REQUIRED: True",
            "  - TITLE: STATUS",
            "    TYPE: String",
            "    REQUIRED: False",
            "  - TITLE: TITLE",
            "    TYPE: String",
            "    REQUIRED: False",
            "  - TITLE: STATEMENT",
            "    TYPE: String",
            "    REQUIRED: True",
            "  - TITLE: COMMENT",
            "    TYPE: String",
            "    REQUIRED: False",
            "  RELATIONS:",
            "  - TYPE: Parent",
            "  - TYPE: Parent",
            "    ROLE: Satisfies",
            "  - TYPE: Parent",
            "    ROLE: ConformsTo",
            "  - TYPE: Parent",
            "    ROLE: Uses",
            "  - TYPE: Parent",
            "    ROLE: Refines",
            "  - TYPE: Parent",
            "    ROLE: InScopeOf",
            "    REVERSE_ROLE: InScopeOf",
            "  - TYPE: Parent",
            "    ROLE: Delivers",
            "    REVERSE_ROLE: Delivers",
            "  - TYPE: Child",
            "  - TYPE: Child",
            "    ROLE: Satisfies",
            "  - TYPE: Child",
            "    ROLE: ConformsTo",
            "  - TYPE: Child",
            "    ROLE: Uses",
            "  - TYPE: Child",
            "    ROLE: Refines",
            "  - TYPE: Child",
            "    ROLE: InScopeOf",
            "  - TYPE: Child",
            "    ROLE: Delivers",
            "  - TYPE: File",
            "",
        ]
    )


def write_requirements_sdoc(data: dict[str, Any], path: Path, *, emit_child_membership: bool = True) -> tuple[int, int]:
    lines = data.get("requirement_lines") or []
    versions = data.get("requirement_versions") or []
    project = (data.get("projects") or [{}])[0]
    client = data.get("client") or {}

    versions_by_base: dict[str, list[dict]] = defaultdict(list)
    for v in versions:
        versions_by_base[v["base_uid"]].append(v)

    edges_by_uid: dict[str, list[dict]] = defaultdict(list)
    for e in data.get("edges") or []:
        edges_by_uid[e["from"]].append(e)
        edges_by_uid[f"to:{e['to']}"].append(e)

    # Dense interchange (default): emit Parent membership on contracts/releases
    # and Child reverse on requirements. Unpatched StrictDoc 0.30 asserts on
    # same-ROLE dual-declare — use emit_child_membership=False / --no-child-membership.
    contract_membership: dict[str, list[str]] = defaultdict(list)
    contract_uid_membership: dict[str, list[str]] = defaultdict(list)
    for c in data.get("contracts") or []:
        cid = c.get("id")
        cname = c.get("name") or cid
        cuid = f"CONTRACT-{cid}" if cid else None
        for u in c.get("in_scope_of") or []:
            contract_membership[u].append(cname)
            if emit_child_membership and cuid:
                contract_uid_membership[u].append(cuid)

    release_membership: dict[str, list[str]] = defaultdict(list)
    release_uid_membership: dict[str, list[str]] = defaultdict(list)
    for r in data.get("releases") or []:
        rid = r.get("id")
        rname = r.get("name") or rid
        ruid = f"RELEASE-{rid}" if rid else None
        for u in r.get("delivers") or []:
            release_membership[u].append(rname)
            if emit_child_membership and ruid:
                release_uid_membership[u].append(ruid)

    lines_by_base = {ln["base_uid"]: ln for ln in lines if ln.get("base_uid")}
    children = build_children(lines)
    roots = children.get(None, [])

    # Non-picked versions that edges or membership lists still point at
    # (succession / fixtures / obsolete still in a contract or release snapshot).
    required_version_uids: set[str] = set()
    for e in data.get("edges") or []:
        required_version_uids.add(e["from"])
        required_version_uids.add(e["to"])
    for c in data.get("contracts") or []:
        for u in c.get("in_scope_of") or []:
            required_version_uids.add(u)
    for r in data.get("releases") or []:
        for u in r.get("delivers") or []:
            required_version_uids.add(u)

    allowed_role_edges, child_role_edges = select_acyclic_role_edges(
        lines=lines,
        versions_by_base=versions_by_base,
        lines_by_base=lines_by_base,
        edges=list(data.get("edges") or []),
        required_version_uids=required_version_uids,
    )

    parts: list[str] = []
    write_document_header(
        parts,
        title=f"{project.get('name', 'ReqALM')} — Requirements",
        uid=f"{project.get('id', 'reqalm')}-requirements",
        client=client,
        project=project,
        schema_version=data.get("schema_version"),
    )

    section_count = 0
    req_count = 0
    for root in roots:
        chunk = emit_node(
            root,
            children,
            versions_by_base,
            edges_by_uid,
            contract_membership,
            release_membership,
            lines_by_base,
            1,
            required_version_uids,
            allowed_role_edges,
            child_role_edges,
            contract_uid_membership,
            release_uid_membership,
        )
        parts.extend(chunk)
    for ln in lines:
        if ln.get("kind") == "section":
            section_count += 1
        else:
            req_count += 1

    path.write_text("\n".join(parts).rstrip() + "\n", encoding="utf-8")
    return section_count, req_count


def write_contracts_releases_sdoc(data: dict[str, Any], path: Path) -> tuple[int, int]:
    project = (data.get("projects") or [{}])[0]
    client = data.get("client") or {}
    contracts = data.get("contracts") or []
    releases = data.get("releases") or []
    known_ver_uids = {
        v.get("uid") for v in (data.get("requirement_versions") or []) if v.get("uid")
    }

    parts: list[str] = []
    write_document_header(
        parts,
        title=f"{project.get('name', 'ReqALM')} — Contracts & Releases",
        uid=f"{project.get('id', 'reqalm')}-contracts-releases",
        client=client,
        project=project,
        schema_version=data.get("schema_version"),
        extra_meta=[
            ("export_kind", "contracts-releases"),
            ("tree_note", "junction entities; not tree parents"),
        ],
    )

    parts.append("[[SECTION]]")
    parts.append("UID: SEC-CONTRACTS-EXPORT")
    parts.append("TITLE: Contracts")
    parts.append("")

    for c in contracts:
        parts.append("[REQUIREMENT]")
        parts.append(f"UID: CONTRACT-{c.get('id')}")
        parts.append(f"STATUS: {map_status(c.get('status'), default='Draft')}")
        parts.append(f"TITLE: Contract {c.get('name')}")
        parts.append("STATEMENT: >>>")
        parts.append(
            f"ReqALM contract overlay `{c.get('name')}` "
            f"(status={c.get('status')}, starts_on={c.get('starts_on')}). "
            "Links requirement versions via in_scope_of; not a tree parent."
        )
        parts.append("<<<")
        uids = c.get("in_scope_of") or []
        rel_ids = c.get("covers_releases") or []
        # Flat COMMENT summary (may truncate); full membership is RELATIONS InScopeOf.
        uid_summary = ", ".join(str(u) for u in uids) if uids else "(none)"
        if len(uid_summary) > 240:
            uid_summary = uid_summary[:237] + "..."
        rel_summary = ", ".join(str(r) for r in rel_ids) if rel_ids else "(none)"
        if len(rel_summary) > 240:
            rel_summary = rel_summary[:237] + "..."
        cmt = [
            "KIND: contract",
            f"contract_id: {c.get('id')}",
            f"client_id: {c.get('client_id')}",
            f"project_id: {c.get('project_id')}",
            "in_scope_of: " + uid_summary,
            f"in_scope_of_count: {len(uids)}",
            "covers_releases: " + rel_summary,
            f"covers_releases_count: {len(rel_ids)}",
        ]
        parts.append(comment_block(cmt).rstrip())
        parts.append("RELATIONS:")
        parts.append("- TYPE: Parent")
        parts.append("  VALUE: SEC-CONTRACTS-EXPORT")
        for u in uids:
            if u not in known_ver_uids:
                continue
            parts.append("- TYPE: Parent")
            parts.append(f"  VALUE: {u}")
            parts.append("  ROLE: InScopeOf")
        for rid in rel_ids:
            parts.append("- TYPE: Parent")
            parts.append(f"  VALUE: RELEASE-{rid}")
            parts.append("  ROLE: CoversRelease")
        parts.append("")

    parts.append("[[/SECTION]]")
    parts.append("")

    parts.append("[[SECTION]]")
    parts.append("UID: SEC-RELEASES-EXPORT")
    parts.append("TITLE: Releases")
    parts.append("")

    for r in releases:
        status_raw = r.get("status", "planned")
        # shipped → Active; planned/other → Draft; obsolete-like → Deleted
        if status_raw == "shipped":
            status = "Active"
        elif status_raw in ("obsolete", "withdrawn", "cancelled"):
            status = "Deleted"
        else:
            status = "Draft"
        parts.append("[REQUIREMENT]")
        parts.append(f"UID: RELEASE-{r.get('id')}")
        parts.append(f"STATUS: {status}")
        parts.append(f"TITLE: Release {r.get('name')}")
        parts.append("STATEMENT: >>>")
        parts.append(
            f"ReqALM release `{r.get('name')}` "
            f"(status={status_raw}, planned_on={r.get('planned_on')}). "
            "delivers is a snapshot of requirement version UIDs."
        )
        parts.append("<<<")
        uids = r.get("delivers") or []
        uid_summary = ", ".join(str(u) for u in uids) if uids else "(none)"
        if len(uid_summary) > 240:
            uid_summary = uid_summary[:237] + "..."
        cmt = [
            "KIND: release",
            f"release_id: {r.get('id')}",
            f"project_id: {r.get('project_id')}",
            f"shipped_on: {r.get('shipped_on')}",
            f"raw_status: {status_raw}",
            "delivers: " + uid_summary,
            f"delivers_count: {len(uids)}",
        ]
        parts.append(comment_block(cmt).rstrip())
        parts.append("RELATIONS:")
        parts.append("- TYPE: Parent")
        parts.append("  VALUE: SEC-RELEASES-EXPORT")
        for u in uids:
            if u not in known_ver_uids:
                continue
            parts.append("- TYPE: Parent")
            parts.append(f"  VALUE: {u}")
            parts.append("  ROLE: Delivers")
        parts.append("")

    parts.append("[[/SECTION]]")
    parts.append("")

    path.write_text("\n".join(parts).rstrip() + "\n", encoding="utf-8")
    return len(contracts), len(releases)


def write_manifest(
    path: Path,
    *,
    data: dict[str, Any],
    req_path: Path,
    cr_path: Path,
    section_count: int,
    req_count: int,
    contract_count: int,
    release_count: int,
) -> None:
    lines = data.get("requirement_lines") or []
    versions = data.get("requirement_versions") or []
    edges = data.get("edges") or []
    project = (data.get("projects") or [{}])[0]
    client = data.get("client") or {}

    body = f"""# ReqALM StrictDoc export manifest

Generated from dogfood YAML. StrictDoc is **interchange only**.
Target grammar: **StrictDoc 0.30**.

## Source

- Client: `{client.get('name')}` (`{client.get('id')}`)
- Project: `{project.get('name')}` (`{project.get('id')}`)
- schema_version: `{data.get('schema_version')}`

## Emitted files

| File | Description |
|------|-------------|
| `{req_path.name}` | Sections + requirements / controls / capabilities |
| `{cr_path.name}` | Contracts & releases as REQUIREMENTs; membership via Parent InScopeOf/Delivers RELATIONS |

## Counts (YAML)

| Entity | Count |
|--------|------:|
| requirement_lines | {len(lines)} |
| requirement_versions | {len(versions)} |
| edges | {len(edges)} |
| contracts | {len(data.get('contracts') or [])} |
| releases | {len(data.get('releases') or [])} |
| catalogs | {len(data.get('catalogs') or [])} |
| catalog_imprints | {len(data.get('catalog_imprints') or [])} |
| identities | {len(data.get('identities') or [])} |
| project_grants | {len(data.get('project_grants') or [])} |

## Counts (exported .sdoc structure)

| Kind | Count |
|------|------:|
| section lines | {section_count} |
| non-section lines → REQUIREMENT | {req_count} |
| contracts | {contract_count} |
| releases | {release_count} |

## Edge kinds (YAML)

| Kind | Count |
|------|------:|
| conforms_to | {sum(1 for e in edges if e.get('kind') == 'conforms_to')} |
| uses | {sum(1 for e in edges if e.get('kind') == 'uses')} |
| satisfies | {sum(1 for e in edges if e.get('kind') == 'satisfies')} |
| refines | {sum(1 for e in edges if e.get('kind') == 'refines')} |

`conforms_to` pins are `(catalog_imprint_id, item_uid)` — `to` is the stable item UID in `catalog/*.sdoc` (`AC-3`, `V-222536`, …) and `catalog_imprint_id` names the published imprint (`nist-800-53@rev5-…`, `asd-stig@v6r4`). YAML `catalog_imprints[]` points at those `.sdoc` files. Project `REQALM-SEC-*` entries remain steward-mutable without imprint until publish; standards always require imprint publish. New imprint import does **not** auto-retarget live pins (see ARCH-CAT-IMPORT / ARCH-CAT-DRIFT).

## Catalog reverse Child ConformsTo

After export, run `scripts/patch_catalog_reverse_conforms.py` to mirror product Parent ConformsTo as Child ConformsTo on catalog nodes (idempotent; preserves STATEMENT). Re-run after re-copying catalogs from sdoc-intake. Dual Parent+Child needs the idempotent StrictDoc `create_link` patch (or omit reverse). Use `--no-reverse` for Parent-only.

## Grammar compromises (StrictDoc 0.30)

- DOCUMENT uses `TITLE`/`UID`/`VERSION` + `METADATA:` key/value (no free DOCUMENT `COMMENT:`).
- SECTION emitted as composite `[[SECTION]]`/`[[/SECTION]]` (StrictDoc 0.30 rejects legacy `[SECTION]`); fields only `UID`/`TITLE` (+ nested children + `[/SECTION]`); section intro text → `[TEXT]` node.
- STATUS mapped: active→Active, draft→Draft, obsolete/withdrawn→Deleted (only these three allowed).
- StrictDoc is a **dense interchange view** of ReqALM — prefer structured `RELATIONS` even when that diverges slightly from the product model.
- Outgoing `edges` → `RELATIONS` `TYPE: Parent` + `ROLE: <PascalCase>` when acyclic; if a Parent ROLE edge would cycle, emit `TYPE: Child` + same ROLE (not COMMENT-only). Roles: Satisfies|ConformsTo|Uses|Refines|InScopeOf|Delivers (+ bare Parent/Child + File).
- Contract `in_scope_of` / release `delivers` → first-class `RELATIONS` (`Parent` + `InScopeOf` / `Delivers`) on `contracts-releases.sdoc`. Requirements mirror as `Child` + same ROLEs (default dense interchange). Unpatched StrictDoc 0.30 asserts on same-ROLE dual-declare — use `--no-child-membership`, or keep the local idempotent `create_link` patch. COMMENT keeps a truncated summary.
- Tree: nested `[[SECTION]]…[[/SECTION]]`; `RELATIONS` Parent VALUE = parent section or requirement UID.
- Children of non-section lines (if any) use synthetic `{{base}}-CHILDREN` section.
- Contracts/releases are a second document, not tree parents.
- **Security catalogs** live under `seed/catalog/` (`nist-800-53.sdoc`, `asd-stig-v6r4.sdoc`) and are copied beside requirements into StrictDoc `input/catalog/`. Product/capability versions `ConformsTo` catalog UIDs (e.g. `AC-3`, `V-222536`) **through a catalog imprint**; control text is **not** copied into `requirements.sdoc` (Northline pattern). YAML pin metadata `catalog_imprint_id` is emitted in REQUIREMENT COMMENT. Catalog files may carry reverse `Child` + `ConformsTo` via `scripts/patch_catalog_reverse_conforms.py`.
"""
    path.write_text(body, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="ReqALM YAML → StrictDoc .sdoc converter")
    parser.add_argument("--in", dest="infile", default=str(DEFAULT_IN), help="Input YAML path")
    parser.add_argument("--out", dest="outdir", default=str(DEFAULT_OUT), help="Output directory")
    parser.add_argument("--validate", action="store_true", help="Validate UID/parent rules before emit")
    parser.add_argument(
        "--no-child-membership",
        action="store_true",
        help="Omit Child InScopeOf/Delivers on requirements (graph-safe for unpatched "
        "StrictDoc 0.30). Default emits them for densest .sdoc interchange.",
    )
    args = parser.parse_args()

    infile = Path(args.infile)
    if not infile.is_absolute():
        cand = Path.cwd() / infile
        infile = cand if cand.exists() else (SEED_DIR / infile)
    outdir = Path(args.outdir)
    if not outdir.is_absolute():
        outdir = Path.cwd() / outdir

    if not infile.exists():
        print(f"error: input not found: {infile}", file=sys.stderr)
        return 1

    data = load_yaml(infile)

    if args.validate:
        errs = validate(data)
        if errs:
            print("validation failed:", file=sys.stderr)
            for e in errs:
                print(f"  - {e}", file=sys.stderr)
            return 2
        print(f"validation ok: {infile}")

    outdir.mkdir(parents=True, exist_ok=True)
    req_path = outdir / "requirements.sdoc"
    cr_path = outdir / "contracts-releases.sdoc"
    man_path = outdir / "MANIFEST.md"

    section_count, req_count = write_requirements_sdoc(
        data, req_path, emit_child_membership=not args.no_child_membership
    )
    contract_count, release_count = write_contracts_releases_sdoc(data, cr_path)
    write_manifest(
        man_path,
        data=data,
        req_path=req_path,
        cr_path=cr_path,
        section_count=section_count,
        req_count=req_count,
        contract_count=contract_count,
        release_count=release_count,
    )

    print(f"wrote {req_path}")
    print(f"wrote {cr_path}")
    print(f"wrote {man_path}")
    print(
        f"lines={len(data.get('requirement_lines') or [])} "
        f"versions={len(data.get('requirement_versions') or [])} "
        f"contracts={len(data.get('contracts') or [])} "
        f"releases={len(data.get('releases') or [])} "
        f"edges={len(data.get('edges') or [])} "
        f"imprints={len(data.get('catalog_imprints') or [])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
