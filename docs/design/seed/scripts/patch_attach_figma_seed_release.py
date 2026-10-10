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
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
SNIPPET = SEED / "fixtures" / "cyber-attach-figma-snippet.yaml"
REPO = "../../.."
NIST = "nist-800-53@rev5-dogfood-20261006"
PLANNED = "2026-10-10"
BASE_MAIN = "56bfc4d6a9fe04559ccddae636ec4052d84ae907"
REL = "rel-r1-seed-attach-figma"
CAP = "CAP-SEED-ATTACH-FIGMA"

_CATALOG_UID_RE = re.compile(r"^(?:[A-Z]{1,4}-\d+(?:\.\d+)?|V-\d+)$")

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
yaml.indent(mapping=2, sequence=2, offset=0)


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
    # Base uid in the snippet → active tip (even when superseded v0 uid still exists).
    if ref in line_base_uids(data):
        resolved = active_uid(data, ref)
        if resolved not in ver_uids and not is_catalog_uid(resolved):
            raise KeyError(f"edge target {ref!r} → {resolved!r} is not a version uid")
        return resolved
    if ref in ver_uids:
        return ref
    raise KeyError(f"edge target {ref!r} is not a catalog uid, version uid, or line base_uid")


def dict_eq(a: dict, b: dict) -> bool:
    return deepcopy(a) == deepcopy(b)


def upsert_line(lines: list, item: dict) -> bool:
    bu = item["base_uid"]
    cur = find(lines, "base_uid", bu)
    if cur is None:
        lines.append(deepcopy(item))
        return True
    if dict_eq(cur, item):
        return False
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
    return False


def upsert_version(versions: list, item: dict) -> bool:
    uid = item["uid"]
    cur = find(versions, "uid", uid)
    if cur is None:
        versions.append(deepcopy(item))
        return True
    if dict_eq(cur, item):
        return False
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
    return False


def ensure_edge(edges: list, edge: dict) -> bool:
    key = (
        edge.get("from"),
        edge.get("to"),
        edge.get("kind"),
        edge.get("catalog_imprint_id") or "",
    )
    for e in edges:
        if (
            e.get("from"),
            e.get("to"),
            e.get("kind"),
            e.get("catalog_imprint_id") or "",
        ) == key:
            return False
    edges.append(deepcopy(edge))
    return True


def replace_snippet_edge(edges: list, raw: dict, resolved: dict) -> None:
    """Drop stale endpoints (base uid or old active tip) then ensure resolved edge."""
    imprint = raw.get("catalog_imprint_id") or ""
    raw_from, raw_to = str(raw["from"]), str(raw["to"])
    want_from, want_to = resolved["from"], resolved["to"]
    kind = raw["kind"]
    edges[:] = [
        e
        for e in edges
        if not (
            e.get("kind") == kind
            and (e.get("catalog_imprint_id") or "") == imprint
            and e.get("from") in (raw_from, want_from)
            and e.get("to") in (raw_to, want_to)
        )
    ]
    ensure_edge(edges, resolved)


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
        prod["in_scope_of"] = scope
        prod["covers_releases"] = mod.reqalm_release_ids(data)


def load_snippet() -> dict:
    if not SNIPPET.is_file():
        print(f"error: missing snippet {SNIPPET}", file=sys.stderr)
        sys.exit(1)
    with SNIPPET.open("r", encoding="utf-8") as f:
        return yaml.load(f)


def apply_snippet(data, snippet: dict) -> None:
    lines = data.setdefault("requirement_lines", [])
    versions = data.setdefault("requirement_versions", [])
    edges = data.setdefault("edges", [])

    for ln in snippet.get("requirement_lines") or []:
        upsert_line(lines, dict(ln))

    for ver in snippet.get("requirement_versions") or []:
        upsert_version(versions, dict(ver))

    ver_uids = {v["uid"] for v in versions if v.get("uid")}

    for raw in snippet.get("edges") or []:
        resolved = dict(raw)
        resolved["from"] = resolve_endpoint(data, str(raw["from"]), ver_uids=ver_uids)
        resolved["to"] = resolve_endpoint(data, str(raw["to"]), ver_uids=ver_uids)
        replace_snippet_edge(edges, raw, resolved)


CAP_STMT = (
    "Seed-only: Cyber attachments and Figma design-link requirement set in dogfood.yaml "
    "(ARCH-ATTACH-*, ARCH-FIGMA-*, CAP-ATTACH-*, CAP-FIGMA-LINK) with conforms_to, refines, uses, "
    "and satisfies edges applied from fixtures/cyber-attach-figma-snippet.yaml. Regenerates out/ and "
    "HANDOFF.md. No application runtime changes; does not ship any release."
)

CAP_ARTIFACTS = [
    f"{REPO}/docs/design/seed/dogfood.yaml",
    f"{REPO}/docs/design/seed/fixtures/cyber-attach-figma-snippet.yaml",
    f"{REPO}/docs/design/seed/scripts/patch_attach_figma_seed_release.py",
    f"{REPO}/docs/design/HANDOFF.md",
]

SNIPPET_BASES = frozenset(
    ln["base_uid"]
    for ln in (yaml.load(SNIPPET.read_text(encoding="utf-8")) or {}).get("requirement_lines") or []
    if ln.get("base_uid")
)


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
                f"Seed-only on main {BASE_MAIN[:12]}…; applies Cyber 2026-10-09 attachments-figma mapping. "
                "Parallel Catalogs UI / Contracts API PRs may merge first; whichever lands later ships releases."
            ),
        ),
    )


def upsert(seq, key, item):
    cur = find(seq, key, item[key])
    if cur is None:
        seq.append(deepcopy(item))
        return
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v


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


def main() -> None:
    snippet = load_snippet()
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    apply_snippet(data, snippet)
    verify_snippet_targets(data, snippet)
    upsert_this_release(data)
    refresh_product_contract_scope(data)

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(
        f"Patched dogfood.yaml: {len(SNIPPET_BASES)} Cyber attach/figma lines, "
        f"{len(snippet.get('edges') or [])} edges, {REL} / {CAP} (planned)"
    )


if __name__ == "__main__":
    main()
