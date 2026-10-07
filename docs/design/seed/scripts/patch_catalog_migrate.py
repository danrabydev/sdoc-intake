#!/usr/bin/env python3
"""Encode locked migrate-to-imprint decision into dogfood.yaml.

Adds:
  H10              — user action: Migrate to new catalog imprint
  ARCH-CAT-MIGRATE — architecture: preview mandatory; .N for locked; in-place drafts after accept

Wires uses/refines to ARCH-CAT-DRIFT / ARCH-CAT-REACT / ARCH-CAT-IMPORT / ARCH-CAT-PIN /
ARCH-CAT-FREEZE / ARCH-VER-SUCC / H03 / H10. Idempotent.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("error: PyYAML required", file=sys.stderr)
    sys.exit(1)

SEED_DIR = Path(__file__).resolve().parent.parent
NIST_IMPRINT_ID = "nist-800-53@rev5-dogfood-20261006"

SEC_META = {
    "catalog_ref": "REQAML-SEC-CATALOG",
    "verification_note": (
        "Catalog steward gates; standard catalogs imprint-published read-only. "
        "AC-3/CM-5 aligned. Pins are (imprint_id, item_uid). Migrate requires "
        "preview accept + Steward/Security gate; audited."
    ),
}

H10_STMT = (
    "An Author or Security steward migrates ConformsTo pins to a new catalog imprint "
    "(whole imprint) or a single catalog item at a chosen hierarchy scope: requirement "
    "version, section (line subtree), document, project, or client. ReqAML always runs a "
    "mandatory dry-run preview of the UID/item diff classified as editorial | normative | "
    "withdrawn | renumbered before any apply — there is no silent auto-retarget. Apply "
    "requires Steward/Security gate and is audited (actor, scope, imprint_from/to, accept)."
)

MIGRATE_STMT = (
    "Migrate-to-imprint apply rules (locked decision): (1) Preview is mandatory — classify "
    "each affected pin's item change as editorial | normative | withdrawn | renumbered; the "
    "operator must accept before apply (dry-run; no silent apply). (2) Locked/frozen "
    "requirement versions — those referenced by contract in_scope_of or release delivers, or "
    "otherwise non-draft — migrate only by minting successor .N versions that ConformsTo the "
    "new (imprint_id, item_uid); never rewrite the frozen version in place. (3) Draft / "
    "unlocked versions may retarget the pin in place after preview accept (still no auto "
    "without accept). (4) Steward/Security gates apply; migration is audited. Aligns with "
    "catalog_imprints, conforms_to.catalog_imprint_id, and catalog_drift "
    "(ARCH-CAT-DRIFT / ARCH-CAT-REACT / H03)."
)

SEC_CAT_STMT = (
    "Catalogs provide standard and project templates. Standard catalogs (NIST/STIG) are "
    "versioned as imprints; project REQAML-SEC-* entries are steward-mutable until imprint "
    "publish. Stewardship, browse, reference, copy, imprint publish, import-diff, drift "
    "review, migrate-to-imprint (preview + apply), and pin semantics live here."
)


def upsert_line(lines: list, line: dict, after_base: str) -> bool:
    """Insert or replace by base_uid. Returns True if newly inserted."""
    bu = line["base_uid"]
    for i, existing in enumerate(lines):
        if existing.get("base_uid") == bu:
            lines[i] = line
            return False
    for i, existing in enumerate(lines):
        if existing.get("base_uid") == after_base:
            lines.insert(i + 1, line)
            return True
    lines.append(line)
    return True


def upsert_version(versions: list, ver: dict, after_uid: str) -> bool:
    uid = ver["uid"]
    for i, existing in enumerate(versions):
        if existing.get("uid") == uid:
            versions[i] = ver
            return False
    for i, existing in enumerate(versions):
        if existing.get("uid") == after_uid:
            versions.insert(i + 1, ver)
            return True
    versions.append(ver)
    return True


def ensure_edge(edges: list, frm: str, to: str, kind: str, imprint: str | None = None) -> bool:
    for e in edges:
        if e.get("from") == frm and e.get("to") == to and e.get("kind") == kind:
            if imprint and e.get("catalog_imprint_id") != imprint:
                e["catalog_imprint_id"] = imprint
            return False
    edge = {"from": frm, "to": to, "kind": kind}
    if imprint:
        edge["catalog_imprint_id"] = imprint
    edges.append(edge)
    return True


def apply(data: dict) -> tuple[int, int, int]:
    lines = data.setdefault("requirement_lines", [])
    versions = data.setdefault("requirement_versions", [])
    edges = data.setdefault("edges", [])
    nl = nv = ne = 0

    # H10 after H09
    h10_line = {
        "base_uid": "H10",
        "project_id": "reqaml",
        "parent": "SEC-CAT",
        "kind": "requirement",
        "title": "Migrate to new catalog imprint",
    }
    if upsert_line(lines, h10_line, "H09"):
        nl += 1

    h10_ver = {
        "uid": "H10",
        "base_uid": "H10",
        "version_n": 0,
        "status": "active",
        "statement": H10_STMT,
        "priority": 55,
        "iteration": "iter-r2",
        "rbac_op": "catalog:imprint:migrate",
        "security": dict(SEC_META),
    }
    if upsert_version(versions, h10_ver, "H09"):
        nv += 1

    # ARCH-CAT-MIGRATE after ARCH-CAT-SCOPE (or H10 if SCOPE missing)
    migrate_line = {
        "base_uid": "ARCH-CAT-MIGRATE",
        "project_id": "reqaml",
        "parent": "H10",
        "kind": "requirement",
        "title": "Migrate pins: preview, .N for locked, in-place drafts",
    }
    after = "ARCH-CAT-SCOPE"
    if not any(x.get("base_uid") == after for x in lines):
        after = "H10"
    if upsert_line(lines, migrate_line, after):
        nl += 1

    migrate_ver = {
        "uid": "ARCH-CAT-MIGRATE",
        "base_uid": "ARCH-CAT-MIGRATE",
        "version_n": 0,
        "status": "active",
        "statement": MIGRATE_STMT,
        "priority": 55,
        "iteration": "iter-r2",
        "rbac_op": "catalog:imprint:migrate:apply",
        "security": dict(SEC_META),
    }
    after_v = "ARCH-CAT-SCOPE" if any(v.get("uid") == "ARCH-CAT-SCOPE" for v in versions) else "H10"
    if upsert_version(versions, migrate_ver, after_v):
        nv += 1

    # Refresh SEC-CAT statement
    for ver in versions:
        if ver.get("uid") == "SEC-CAT":
            ver["statement"] = SEC_CAT_STMT
            break

    edge_specs = [
        # semantic
        ("ARCH-CAT-MIGRATE", "H10", "refines", None),
        ("ARCH-CAT-MIGRATE", "ARCH-CAT-DRIFT", "uses", None),
        ("ARCH-CAT-MIGRATE", "ARCH-CAT-REACT", "uses", None),
        ("ARCH-CAT-MIGRATE", "ARCH-CAT-IMPORT", "uses", None),
        ("ARCH-CAT-MIGRATE", "ARCH-CAT-PIN", "uses", None),
        ("ARCH-CAT-MIGRATE", "ARCH-CAT-FREEZE", "uses", None),
        ("ARCH-CAT-MIGRATE", "ARCH-VER-SUCC", "uses", None),
        ("ARCH-CAT-MIGRATE", "H03", "uses", None),
        ("H10", "ARCH-CAT-REACT", "uses", None),
        ("H10", "H03", "uses", None),
        # conforms
        ("H10", "AC-3", "conforms_to", NIST_IMPRINT_ID),
        ("H10", "CM-5", "conforms_to", NIST_IMPRINT_ID),
        ("H10", "AU-2", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-MIGRATE", "AC-3", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-MIGRATE", "CM-5", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-MIGRATE", "AU-2", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-MIGRATE", "AU-12", "conforms_to", NIST_IMPRINT_ID),
    ]
    for frm, to, kind, imp in edge_specs:
        if ensure_edge(edges, frm, to, kind, imp):
            ne += 1

    return nl, nv, ne


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", default=str(SEED_DIR / "dogfood.yaml"))
    ap.add_argument("--out", dest="outfile", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    infile = Path(args.infile)
    outfile = Path(args.outfile) if args.outfile else infile

    data = yaml.safe_load(infile.read_text(encoding="utf-8"))
    bl, bv, be = (
        len(data.get("requirement_lines") or []),
        len(data.get("requirement_versions") or []),
        len(data.get("edges") or []),
    )
    nl, nv, ne = apply(data)
    print(f"lines: {bl} → {len(data['requirement_lines'])} (+{nl} new)")
    print(f"versions: {bv} → {len(data['requirement_versions'])} (+{nv} new)")
    print(f"edges: {be} → {len(data['edges'])} (+{ne} new)")
    print("UIDs: H10, ARCH-CAT-MIGRATE")

    if args.dry_run:
        print("dry-run: not writing")
        return 0

    with outfile.open("w", encoding="utf-8") as f:
        yaml.dump(
            data,
            f,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
            width=100,
        )
    print(f"wrote {outfile}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
