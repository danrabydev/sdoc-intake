#!/usr/bin/env python3
"""ReqAML seed: convert dogfood YAML → StrictDoc .sdoc (interchange only)."""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path
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

STATUS_MAP = {
    "draft": "Draft",
    "active": "Active",
    "obsolete": "Obsolete",
    "withdrawn": "Withdrawn",
}


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
        if status not in ("draft", "active", "obsolete", "withdrawn"):
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

    for edge in data.get("edges") or []:
        for side in ("from", "to"):
            u = edge.get(side)
            if u not in ver_uids:
                errs.append(f"edge {edge}: {side} {u!r} not a version uid")
        if edge.get("kind") not in ("refines", "conforms_to", "uses", "satisfies"):
            errs.append(f"edge {edge}: invalid kind")

    for c in data.get("contracts") or []:
        for u in c.get("in_scope_of") or []:
            if u not in ver_uids:
                errs.append(f"contract {c.get('name')}: in_scope_of {u!r} not a version uid")

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


def pick_version(versions_by_base: dict[str, list[dict]], base_uid: str) -> dict | None:
    vers = versions_by_base.get(base_uid) or []
    if not vers:
        return None
    # Prefer active, else highest version_n
    active = [v for v in vers if v.get("status") == "active"]
    pool = active or vers
    return max(pool, key=lambda v: int(v.get("version_n") or 0))


def build_children(lines: list[dict]) -> dict[str | None, list[dict]]:
    children: dict[str | None, list[dict]] = defaultdict(list)
    for ln in lines:
        parent = ln.get("parent")
        children[parent].append(ln)
    return children


def emit_node(
    ln: dict,
    children: dict[str | None, list[dict]],
    versions_by_base: dict[str, list[dict]],
    edges_by_uid: dict[str, list[dict]],
    contract_membership: dict[str, list[str]],
    release_membership: dict[str, list[str]],
    indent_level: int,
) -> list[str]:
    """Emit SECTION or REQUIREMENT for a line, then recurse."""
    out: list[str] = []
    base = ln["base_uid"]
    kind = ln["kind"]
    title = ln.get("title") or base
    ver = pick_version(versions_by_base, base)

    if kind == "section":
        out.append("[SECTION]")
        out.append(f"UID: {base}")
        out.append(f"TITLE: {title}")
        if ver and ver.get("statement"):
            out.append("STATEMENT: >>>")
            out.append(escape_sdoc_text(ver["statement"]).rstrip())
            out.append("<<<")
        meta = [f"KIND: section", f"LEVEL: {indent_level}"]
        if ver:
            meta.append(f"VERSION_UID: {ver.get('uid')}")
            meta.append(f"STATUS: {ver.get('status')}")
        out.append(comment_block(meta).rstrip())
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
                    indent_level + 1,
                )
            )
        out.append("[/SECTION]")
        out.append("")
        return out

    # requirement | control | capability | release_node → [REQUIREMENT]
    uid = (ver or {}).get("uid") or base
    status = STATUS_MAP.get((ver or {}).get("status", "draft"), "Draft")
    stmt = (ver or {}).get("statement") or title

    out.append("[REQUIREMENT]")
    out.append(f"UID: {uid}")
    out.append(f"STATUS: {status}")
    out.append(f"TITLE: {title}")
    out.append("STATEMENT: >>>")
    out.append(escape_sdoc_text(stmt).rstrip())
    out.append("<<<")

    cmt: list[str] = [f"KIND: {kind}", f"BASE_UID: {base}", f"VERSION_N: {(ver or {}).get('version_n', 0)}"]
    if ver and ver.get("rbac_op"):
        cmt.append(f"rbac_op: {ver['rbac_op']}")
    if ver and ver.get("priority") is not None:
        cmt.append(f"priority: {ver['priority']}")
    if ver and ver.get("iteration"):
        cmt.append(f"iteration: {ver['iteration']}")
    sec = (ver or {}).get("security") or {}
    if sec.get("catalog_ref"):
        cmt.append(f"security.catalog_ref: {sec['catalog_ref']}")
    if sec.get("verification_note"):
        cmt.append(f"security.verification_note: {sec['verification_note']}")
    for e in edges_by_uid.get(uid, []):
        cmt.append(f"edge: {e['kind']} → {e['to']}" if e.get("from") == uid else f"edge: ← {e['kind']} from {e['from']}")
    # Also edges where this is the target (already covered above with from check — fix)
    for e in edges_by_uid.get(f"to:{uid}", []):
        cmt.append(f"edge: ← {e['kind']} from {e['from']}")
    for name in contract_membership.get(uid, []):
        cmt.append(f"in_scope_of_contract: {name}")
    for name in release_membership.get(uid, []):
        cmt.append(f"delivered_by_release: {name}")
    out.append(comment_block(cmt).rstrip())
    out.append("")

    # Nest children under a SECTION wrapper so tree survives without RELATIONS
    kids = children.get(base, [])
    if kids:
        out.append("[SECTION]")
        out.append(f"UID: {base}-CHILDREN")
        out.append(f"TITLE: Children of {base}")
        out.append(
            comment_block(
                [
                    "KIND: section",
                    f"Synthetic nesting for StrictDoc interchange; parent line is {base}",
                ]
            ).rstrip()
        )
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
                    indent_level + 1,
                )
            )
        out.append("[/SECTION]")
        out.append("")

    return out


def write_requirements_sdoc(data: dict[str, Any], path: Path) -> tuple[int, int]:
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

    contract_membership: dict[str, list[str]] = defaultdict(list)
    for c in data.get("contracts") or []:
        for u in c.get("in_scope_of") or []:
            contract_membership[u].append(c.get("name") or c.get("id"))

    release_membership: dict[str, list[str]] = defaultdict(list)
    for r in data.get("releases") or []:
        for u in r.get("delivers") or []:
            release_membership[u].append(r.get("name") or r.get("id"))

    children = build_children(lines)
    roots = children.get(None, [])

    parts: list[str] = []
    parts.append("[DOCUMENT]")
    parts.append(f"TITLE: {project.get('name', 'ReqAML')} — Requirements")
    parts.append(f"UID: {project.get('id', 'reqaml')}-requirements")
    parts.append(
        comment_block(
            [
                f"client: {client.get('name')} ({client.get('id')})",
                f"project: {project.get('name')} ({project.get('id')})",
                "ReqAML dogfood export — StrictDoc interchange only",
                f"schema_version: {data.get('schema_version')}",
            ]
        ).rstrip()
    )
    parts.append("")

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
            1,
        )
        parts.extend(chunk)
        # rough counts from kinds
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

    parts: list[str] = []
    parts.append("[DOCUMENT]")
    parts.append(f"TITLE: {project.get('name', 'ReqAML')} — Contracts & Releases")
    parts.append(f"UID: {project.get('id', 'reqaml')}-contracts-releases")
    parts.append(
        comment_block(
            [
                f"client: {client.get('name')} ({client.get('id')})",
                f"project: {project.get('name')} ({project.get('id')})",
                "Junction entities exported as REQUIREMENTs with COMMENT UID lists",
                "Contracts/releases are not tree parents in ReqAML",
            ]
        ).rstrip()
    )
    parts.append("")

    parts.append("[SECTION]")
    parts.append("UID: SEC-CONTRACTS-EXPORT")
    parts.append("TITLE: Contracts")
    parts.append("")

    for c in contracts:
        parts.append("[REQUIREMENT]")
        parts.append(f"UID: CONTRACT-{c.get('id')}")
        parts.append(f"STATUS: {STATUS_MAP.get(c.get('status', 'draft'), c.get('status', 'Draft').title())}")
        parts.append(f"TITLE: Contract {c.get('name')}")
        parts.append("STATEMENT: >>>")
        parts.append(
            f"ReqAML contract overlay `{c.get('name')}` "
            f"(status={c.get('status')}, starts_on={c.get('starts_on')}). "
            "Links requirement versions via in_scope_of; not a tree parent."
        )
        parts.append("<<<")
        uids = c.get("in_scope_of") or []
        cmt = [
            "KIND: contract",
            f"contract_id: {c.get('id')}",
            f"client_id: {c.get('client_id')}",
            f"project_id: {c.get('project_id')}",
            "in_scope_of:",
        ] + [f"  - {u}" for u in uids]
        parts.append(comment_block(cmt).rstrip())
        parts.append("")

    parts.append("[/SECTION]")
    parts.append("")

    parts.append("[SECTION]")
    parts.append("UID: SEC-RELEASES-EXPORT")
    parts.append("TITLE: Releases")
    parts.append("")

    for r in releases:
        status_raw = r.get("status", "planned")
        status = "Active" if status_raw == "shipped" else "Draft"
        parts.append("[REQUIREMENT]")
        parts.append(f"UID: RELEASE-{r.get('id')}")
        parts.append(f"STATUS: {status}")
        parts.append(f"TITLE: Release {r.get('name')}")
        parts.append("STATEMENT: >>>")
        parts.append(
            f"ReqAML release `{r.get('name')}` "
            f"(status={status_raw}, planned_on={r.get('planned_on')}). "
            "delivers is a snapshot of requirement version UIDs."
        )
        parts.append("<<<")
        uids = r.get("delivers") or []
        cmt = [
            "KIND: release",
            f"release_id: {r.get('id')}",
            f"project_id: {r.get('project_id')}",
            f"shipped_on: {r.get('shipped_on')}",
            "delivers:",
        ] + [f"  - {u}" for u in uids]
        parts.append(comment_block(cmt).rstrip())
        parts.append("")

    parts.append("[/SECTION]")
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

    body = f"""# ReqAML StrictDoc export manifest

Generated from dogfood YAML. StrictDoc is **interchange only**.

## Source

- Client: `{client.get('name')}` (`{client.get('id')}`)
- Project: `{project.get('name')}` (`{project.get('id')}`)
- schema_version: `{data.get('schema_version')}`

## Emitted files

| File | Description |
|------|-------------|
| `{req_path.name}` | Sections + requirements / controls / capabilities |
| `{cr_path.name}` | Contracts & releases as REQUIREMENTs with COMMENT UID lists |

## Counts (YAML)

| Entity | Count |
|--------|------:|
| requirement_lines | {len(lines)} |
| requirement_versions | {len(versions)} |
| edges | {len(edges)} |
| contracts | {len(data.get('contracts') or [])} |
| releases | {len(data.get('releases') or [])} |
| catalogs | {len(data.get('catalogs') or [])} |
| identities | {len(data.get('identities') or [])} |
| project_grants | {len(data.get('project_grants') or [])} |

## Counts (exported .sdoc structure)

| Kind | Count |
|------|------:|
| section lines | {section_count} |
| non-section lines → REQUIREMENT | {req_count} |
| contracts | {contract_count} |
| releases | {release_count} |

## Grammar compromises

- `kind` stored in COMMENT (StrictDoc core grammar has no KIND field here).
- Edges, rbac_op, NIST/STIG notes, contract/release membership in COMMENT.
- Nested `[SECTION]…[/SECTION]` preserves tree; children of non-section lines use a synthetic `{{base}}-CHILDREN` section.
- Contracts/releases are a second document, not tree parents.
"""
    path.write_text(body, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="ReqAML YAML → StrictDoc .sdoc converter")
    parser.add_argument("--in", dest="infile", default=str(DEFAULT_IN), help="Input YAML path")
    parser.add_argument("--out", dest="outdir", default=str(DEFAULT_OUT), help="Output directory")
    parser.add_argument("--validate", action="store_true", help="Validate UID/parent rules before emit")
    args = parser.parse_args()

    infile = Path(args.infile)
    if not infile.is_absolute():
        # relative to CWD first, else seed/
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

    section_count, req_count = write_requirements_sdoc(data, req_path)
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
        f"edges={len(data.get('edges') or [])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
