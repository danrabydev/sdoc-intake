#!/usr/bin/env python3
"""Cyber attachments + Figma requirement set (seed-only). Idempotent.

Applies docs/design/seed/fixtures/cyber-attach-figma-snippet.yaml verbatim (text, hashes, edges).
Adds rel-r1-seed-attach-figma / CAP-SEED-ATTACH-FIGMA (planned; no release ship).

Run: python3 patch_attach_figma_seed_release.py && python3 yaml_to_strictdoc.py --validate
"""
from __future__ import annotations

import hashlib
import importlib.util
import re
import sys
from collections import Counter
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
SNIPPET = SEED / "fixtures" / "cyber-attach-figma-snippet.yaml"
DELTA = SEED / "fixtures" / "delta-versions.yaml"
REPO = "../../.."
NIST = "nist-800-53@rev5-dogfood-20261006"
PLANNED = "2026-10-10"
BASE_MAIN = "56bfc4d6a9fe04559ccddae636ec4052d84ae907"
REL = "rel-r1-seed-attach-figma"
CAP = "CAP-SEED-ATTACH-FIGMA"
REMOVED_CAP = "CAP-FIGMA-LINK"
KEY_SCOPE = "ARCH-KEY-SCOPE"
KEY_SCOPE_DRAFT = "ARCH-KEY-SCOPE.1"

_CATALOG_UID_RE = re.compile(r"^(?:[A-Z]{1,4}-\d+(?:\.\d+)?|V-\d+)$")

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
yaml.indent(mapping=2, sequence=2, offset=0)

EXPECTED_LINES = 14
EXPECTED_VERSIONS = 15
EXPECTED_EDGE_KINDS = {
    "conforms_to": 65,
    "refines": 18,
    "uses": 21,
    "satisfies": 9,
}

DELTA_EXPECTED_LINES = 1
DELTA_EXPECTED_VERSIONS = 4
DELTA_EXPECTED_EDGE_KINDS = {
    "conforms_to": 19,
    "refines": 8,
    "uses": 10,
    "satisfies": 6,
}

PRESERVE_ACTIVE_V0_BASES = frozenset(
    {
        KEY_SCOPE,
        "ARCH-ATTACH-PIN-VERSION",
        "ARCH-ATTACH-SCOPE",
        "ARCH-ATTACH-ENCRYPT",
    }
)

DRAFT_SCOPE_EXCLUDE_UIDS = frozenset(
    {
        KEY_SCOPE_DRAFT,
        "ARCH-ATTACH-PIN-VERSION.1",
        "ARCH-ATTACH-SCOPE.1",
        "ARCH-ATTACH-ENCRYPT.1",
    }
)


def cm(**kw):
    m = CommentedMap()
    for k, v in kw.items():
        m[k] = v
    return m


def find(seq, key, val):
    for x in seq or []:
        if x.get(key) == val:
            return x
    return None


def is_catalog_uid(uid: str) -> bool:
    return bool(uid and _CATALOG_UID_RE.match(uid))


def active_uid(data, base_uid: str) -> str:
    vers = [v for v in data.get("requirement_versions") or [] if v.get("base_uid") == base_uid]
    if not vers:
        return base_uid
    active = [v for v in vers if v.get("status") == "active"]
    if active:
        return max(active, key=lambda v: v.get("version_n", 0))["uid"]
    non_superseded = [v for v in vers if v.get("status") != "superseded"]
    if non_superseded:
        return max(non_superseded, key=lambda v: v.get("version_n", 0))["uid"]
    return max(vers, key=lambda v: v.get("version_n", 0))["uid"]


def line_base_uids(data) -> set[str]:
    return {ln["base_uid"] for ln in data.get("requirement_lines") or [] if ln.get("base_uid")}


def resolve_endpoint(data, ref: str, *, ver_uids: set[str]) -> str:
    if is_catalog_uid(ref):
        return ref
    # Exact version uid wins over line base_uid (v0 uid often equals base_uid).
    if ref in ver_uids:
        return ref
    if ref in line_base_uids(data):
        resolved = active_uid(data, ref)
        if resolved not in ver_uids and not is_catalog_uid(resolved):
            raise KeyError(f"edge target {ref!r} → {resolved!r} is not a version uid")
        return resolved
    raise KeyError(f"edge target {ref!r} is not a catalog uid, version uid, or line base_uid")


def edge_key(edge: dict) -> tuple:
    return (
        edge.get("from"),
        edge.get("to"),
        edge.get("kind"),
        edge.get("catalog_imprint_id") or "",
    )


def dict_eq(a: dict, b: dict) -> bool:
    return deepcopy(a) == deepcopy(b)


def upsert_line(lines: list, item: dict) -> None:
    bu = item["base_uid"]
    cur = find(lines, "base_uid", bu)
    if cur is None:
        lines.append(deepcopy(item))
        return
    if dict_eq(cur, item):
        return
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v


def upsert_version(versions: list, item: dict) -> None:
    uid = item["uid"]
    cur = find(versions, "uid", uid)
    if cur is None:
        versions.append(deepcopy(item))
        return
    if dict_eq(cur, item):
        return
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v


def ensure_edge(edges: list, edge: dict) -> None:
    key = edge_key(edge)
    for e in edges:
        if edge_key(e) == key:
            return
    edges.append(deepcopy(edge))


def statement_hash(text: str) -> str:
    canon = "\n".join(line.rstrip() for line in text.strip().replace("\r\n", "\n").split("\n"))
    return "sha256:" + hashlib.sha256(canon.encode("utf-8")).hexdigest()


def _contracts_patch_module():
    path = SEED / "scripts" / "patch_reqalm_contracts_release.py"
    spec = importlib.util.spec_from_file_location("patch_reqalm_contracts_release", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def refresh_product_contract_scope(data) -> None:
    mod = _contracts_patch_module()
    maint = find(data.get("contracts"), "id", mod.MAINT_CONTRACT)
    maint_in_scope = set(maint.get("in_scope_of") or []) if maint else set()
    scope = mod.reqalm_product_contract_scope(data, maint_in_scope=maint_in_scope)
    prod = find(data.get("contracts"), "id", mod.PRODUCT_CONTRACT)
    if prod:
        prod["covers_releases"] = mod.reqalm_release_ids(data)
        # One version per line (#38): when auto-scope picks a draft .1, pin v0 instead.
        pins: set[str] = set()
        for uid in scope:
            if uid in DRAFT_SCOPE_EXCLUDE_UIDS:
                ver = find(data.get("requirement_versions"), "uid", uid)
                if ver and ver.get("base_uid"):
                    pins.add(str(ver["base_uid"]))
                continue
            pins.add(str(uid))
        prod["in_scope_of"] = sorted(pins)


def load_fixture(path: Path, label: str) -> dict:
    if not path.is_file():
        print(f"error: missing {label} {path}", file=sys.stderr)
        sys.exit(1)
    with path.open("r", encoding="utf-8") as f:
        return yaml.load(f)


def load_snippet() -> dict:
    return load_fixture(SNIPPET, "snippet")


def load_delta() -> dict:
    return load_fixture(DELTA, "delta")


def remove_cap_figma_link(data) -> None:
    data["requirement_lines"] = [
        ln for ln in data.get("requirement_lines") or [] if ln.get("base_uid") != REMOVED_CAP
    ]
    data["requirement_versions"] = [
        v for v in data.get("requirement_versions") or [] if v.get("base_uid") != REMOVED_CAP
    ]
    data["edges"] = [
        e
        for e in data.get("edges") or []
        if e.get("from") != REMOVED_CAP and e.get("to") != REMOVED_CAP
    ]
    arts = data.get("capability_artifacts") or []
    data["capability_artifacts"] = [
        a for a in arts if a.get("requirement_version_uid") != REMOVED_CAP
    ]


def fixture_version_uids(fixture: dict) -> set[str]:
    """Version uids declared in a fixture (not line base_uids)."""
    return {str(v["uid"]) for v in fixture.get("requirement_versions") or [] if v.get("uid")}


def line_has_successor_version(data, base: str) -> bool:
    return any(
        v.get("base_uid") == base and int(v.get("version_n") or 0) >= 1
        for v in data.get("requirement_versions") or []
    )


def preserve_v0_line(data, base: str) -> bool:
    if base not in PRESERVE_ACTIVE_V0_BASES:
        return False
    v0 = find(data.get("requirement_versions"), "uid", base)
    if not v0:
        return False
    if v0.get("status") == "active":
        return True
    return line_has_successor_version(data, base)


def fixture_managed_from_uids(fixtures: list[dict], data) -> set[str]:
    """Managed outbound sources: fixture version uids minus preserved v0 tips."""
    managed: set[str] = set()
    for fix in fixtures:
        managed |= fixture_version_uids(fix)
    for base in PRESERVE_ACTIVE_V0_BASES:
        if preserve_v0_line(data, base) and base in managed:
            managed.discard(base)
    return managed


def skip_preserved_v0_upsert(data, item: dict) -> bool:
    uid = item.get("uid")
    base = item.get("base_uid")
    if uid == KEY_SCOPE:
        return True
    if base not in PRESERVE_ACTIVE_V0_BASES or uid != base:
        return False
    return preserve_v0_line(data, base)


def snapshot_preserve_v0_outbounds(data) -> dict[str, list[dict]]:
    snaps: dict[str, list[dict]] = {}
    for base in PRESERVE_ACTIVE_V0_BASES:
        if not preserve_v0_line(data, base):
            continue
        snaps[base] = [
            deepcopy(e) for e in data.get("edges") or [] if e.get("from") == base
        ]
    return snaps


def restore_preserve_v0_outbounds(data, snapshots: dict[str, list[dict]]) -> None:
    edges = data.setdefault("edges", [])
    for edge_list in snapshots.values():
        for edge in edge_list:
            ensure_edge(edges, edge)


KEY_SCOPE_V0_OUTBOUND: list[dict] = [
    {"from": KEY_SCOPE, "to": "ARCH-KEY", "kind": "refines"},
    {"from": KEY_SCOPE, "to": "M03", "kind": "uses"},
    {
        "from": KEY_SCOPE,
        "to": "SC-28.1",
        "kind": "conforms_to",
        "catalog_imprint_id": NIST,
    },
    {
        "from": KEY_SCOPE,
        "to": "V-222588",
        "kind": "conforms_to",
        "catalog_imprint_id": "asd-stig@v6r4",
    },
    {
        "from": KEY_SCOPE,
        "to": "V-222589",
        "kind": "conforms_to",
        "catalog_imprint_id": "asd-stig@v6r4",
    },
    {
        "from": KEY_SCOPE,
        "to": "V-222642",
        "kind": "conforms_to",
        "catalog_imprint_id": "asd-stig@v6r4",
    },
]


def ensure_key_scope_v0_outbound(data) -> None:
    """Restore shipped v0 outbound edges (never move — copy to .1 separately)."""
    edges = data.setdefault("edges", [])
    for edge in KEY_SCOPE_V0_OUTBOUND:
        ensure_edge(edges, edge)


def carry_key_scope_outbound_edges(data) -> None:
    """Duplicate ARCH-KEY-SCOPE v0 outbound edges onto draft .1; never edit v0."""
    v0 = find(data.get("requirement_versions"), "uid", KEY_SCOPE)
    tip = find(data.get("requirement_versions"), "uid", KEY_SCOPE_DRAFT)
    if not v0 or not tip:
        return
    if v0.get("status") != "active":
        return
    edges = data.setdefault("edges", [])
    for e in list(edges):
        if e.get("from") != KEY_SCOPE:
            continue
        dup = deepcopy(e)
        dup["from"] = KEY_SCOPE_DRAFT
        ensure_edge(edges, dup)


def protected_edge_keys(edges: list, managed_from: set[str]) -> set[tuple]:
    return {edge_key(e) for e in edges if e.get("from") not in managed_from}


def assert_protected_edges_unchanged(before: set[tuple], after_edges: list, managed_from: set[str]) -> None:
    after = protected_edge_keys(after_edges, managed_from)
    missing = before - after
    if missing:
        sample = sorted(missing)[:8]
        raise RuntimeError(
            f"protected outbound edges removed or changed ({len(missing)}): {sample}"
        )


def apply_cyber_fixtures(data, *fixtures: dict) -> None:
    remove_cap_figma_link(data)

    lines = data.setdefault("requirement_lines", [])
    versions = data.setdefault("requirement_versions", [])
    edges = data.setdefault("edges", [])

    v0_outbound_before = snapshot_preserve_v0_outbounds(data)
    v0_records_before = {
        base: deepcopy(find(versions, "uid", base))
        for base in PRESERVE_ACTIVE_V0_BASES
        if find(versions, "uid", base)
    }

    managed_from = fixture_managed_from_uids(list(fixtures), data)
    protected_before = protected_edge_keys(edges, managed_from)

    for fix in fixtures:
        for ln in fix.get("requirement_lines") or []:
            upsert_line(lines, dict(ln))

    for fix in fixtures:
        for ver in fix.get("requirement_versions") or []:
            item = dict(ver)
            if skip_preserved_v0_upsert(data, item):
                continue
            upsert_version(versions, item)

    for base, before in v0_records_before.items():
        if not before:
            continue
        cur = find(versions, "uid", base)
        if cur and not dict_eq(cur, before):
            raise RuntimeError(f"{base} v0 was modified; only draft successors may change")

    ver_uids = {v["uid"] for v in versions if v.get("uid")}

    edges[:] = [
        e
        for e in edges
        if e.get("from") not in managed_from
        and e.get("from") != REMOVED_CAP
        and e.get("to") != REMOVED_CAP
    ]

    for fix in fixtures:
        for raw in fix.get("edges") or []:
            resolved = dict(raw)
            resolved["from"] = resolve_endpoint(data, str(raw["from"]), ver_uids=ver_uids)
            resolved["to"] = resolve_endpoint(data, str(raw["to"]), ver_uids=ver_uids)
            ensure_edge(edges, resolved)

    restore_preserve_v0_outbounds(data, v0_outbound_before)
    ensure_key_scope_v0_outbound(data)
    carry_key_scope_outbound_edges(data)
    assert_protected_edges_unchanged(protected_before, edges, managed_from)


CAP_STMT = (
    "Seed-only: Cyber attachments and Figma design-link requirement set in dogfood.yaml "
    "(ARCH-ATTACH-*, ARCH-ATTACH-VERSIONS, ARCH-ATTACH-SCAN, ARCH-FIGMA-*, SPIKE-FIGMA-FEASIBILITY, "
    "CAP-ATTACH-*, ARCH-KEY-SCOPE.1 and attachment .1 content mints) with conforms_to, refines, uses, "
    "and satisfies edges from fixtures/cyber-attach-figma-snippet.yaml and delta-versions.yaml. "
    "Regenerates out/ and HANDOFF.md. No application runtime changes; does not ship any release."
)

CAP_ARTIFACTS = [
    f"{REPO}/docs/design/seed/dogfood.yaml",
    f"{REPO}/docs/design/seed/fixtures/cyber-attach-figma-snippet.yaml",
    f"{REPO}/docs/design/seed/fixtures/delta-versions.yaml",
    f"{REPO}/docs/design/seed/scripts/patch_attach_figma_seed_release.py",
    f"{REPO}/docs/design/HANDOFF.md",
]


def upsert(seq, key, item):
    cur = find(seq, key, item[key])
    if cur is None:
        seq.append(deepcopy(item))
        return
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v


def upsert_this_release(data) -> None:
    upsert_line(
        data.setdefault("requirement_lines", []),
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-CT",
            kind="capability",
            title="Cyber attachments + Figma requirements (seed)",
        ),
    )
    upsert_version(
        data.setdefault("requirement_versions", []),
        cm(
            uid=CAP,
            base_uid=CAP,
            version_n=0,
            status="draft",
            statement=CAP_STMT,
            priority=10,
            iteration="iter-r1",
            grooming_state="detailed",
            security={
                "catalog_ref": "CM-2",
                "verification_note": "Planned until attachments/Figma seed PR merges.",
            },
            statement_hash=statement_hash(CAP_STMT),
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-seed-attach-figma",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Seed-only attachments + Figma requirement set PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP]
    for base in ("ARCH-ATTACH", "ARCH-FIGMA"):
        ensure_edge(data["edges"], {"from": CAP, "to": active_uid(data, base), "kind": "satisfies"})
    ensure_edge(
        data["edges"],
        {"from": CAP, "to": "CM-2", "kind": "conforms_to", "catalog_imprint_id": NIST},
    )
    arts = data.setdefault("capability_artifacts", [])
    data["capability_artifacts"] = [a for a in arts if a.get("requirement_version_uid") != CAP]
    for uri in CAP_ARTIFACTS:
        data["capability_artifacts"].append({"requirement_version_uid": CAP, "kind": "other", "uri": uri})
    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=REL,
            project_id="reqalm",
            name="R1 — Cyber attachments + Figma requirements (seed)",
            planned_on=PLANNED,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes=(
                f"Seed-only on main {BASE_MAIN[:12]}…; applies Cyber 2026-10-09 attachments-figma mapping (v2). "
                "Parallel Catalogs UI / Contracts API PRs may merge first; whichever lands later ships releases."
            ),
        ),
    )


def verify_snippet_targets(data, snippet: dict) -> None:
    ver_uids = {v["uid"] for v in data.get("requirement_versions") or []}
    line_bases = {ln["base_uid"] for ln in data.get("requirement_lines") or [] if ln.get("base_uid")}
    imprint_ids = {imp.get("id") for imp in data.get("catalog_imprints") or []}
    for raw in snippet.get("edges") or []:
        for end in ("from", "to"):
            ref = str(raw[end])
            if is_catalog_uid(ref):
                if raw.get("kind") == "conforms_to":
                    cid = raw.get("catalog_imprint_id")
                    if cid and cid not in imprint_ids:
                        raise ValueError(f"unknown catalog_imprint_id {cid!r} on edge to {ref}")
                continue
            resolved = resolve_endpoint(data, ref, ver_uids=ver_uids)
            if resolved not in ver_uids:
                raise ValueError(f"edge {end} {ref!r} → {resolved!r} not in versions")
        if raw.get("kind") == "conforms_to" and is_catalog_uid(str(raw.get("to"))):
            if not raw.get("catalog_imprint_id"):
                raise ValueError(f"conforms_to to {raw.get('to')} missing catalog_imprint_id")
    for ln in snippet.get("requirement_lines") or []:
        parent = ln.get("parent")
        if parent and parent not in line_bases:
            raise ValueError(f"line {ln.get('base_uid')}: parent {parent!r} missing")


def verify_fixture_inventory(
    fixture: dict,
    *,
    label: str,
    expected_lines: int,
    expected_versions: int,
    expected_edge_kinds: dict[str, int],
) -> None:
    if len(fixture.get("requirement_lines") or []) != expected_lines:
        raise RuntimeError(f"{label} requirement_lines count mismatch")
    if len(fixture.get("requirement_versions") or []) != expected_versions:
        raise RuntimeError(f"{label} requirement_versions count mismatch")
    kinds = Counter(e["kind"] for e in fixture.get("edges") or [])
    for kind, want in expected_edge_kinds.items():
        if kinds.get(kind, 0) != want:
            raise RuntimeError(f"{label} edges {kind}: got {kinds.get(kind, 0)} want {want}")


def verify_snippet_targets_all(data, *fixtures: dict) -> None:
    for fix in fixtures:
        verify_snippet_targets(data, fix)


def main() -> None:
    snippet = load_snippet()
    delta = load_delta()
    verify_fixture_inventory(
        snippet,
        label="snippet",
        expected_lines=EXPECTED_LINES,
        expected_versions=EXPECTED_VERSIONS,
        expected_edge_kinds=EXPECTED_EDGE_KINDS,
    )
    verify_fixture_inventory(
        delta,
        label="delta",
        expected_lines=DELTA_EXPECTED_LINES,
        expected_versions=DELTA_EXPECTED_VERSIONS,
        expected_edge_kinds=DELTA_EXPECTED_EDGE_KINDS,
    )

    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    apply_cyber_fixtures(data, snippet, delta)
    verify_snippet_targets_all(data, snippet, delta)
    upsert_this_release(data)
    refresh_product_contract_scope(data)

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    delta_edges = sum(DELTA_EXPECTED_EDGE_KINDS.values())
    print(
        f"Patched dogfood.yaml: snippet {EXPECTED_LINES}/{EXPECTED_VERSIONS}/"
        f"{sum(EXPECTED_EDGE_KINDS.values())} edges + delta {DELTA_EXPECTED_LINES}/"
        f"{DELTA_EXPECTED_VERSIONS}/{delta_edges} edges, {REL} / {CAP} (planned)"
    )


if __name__ == "__main__":
    main()
