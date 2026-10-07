#!/usr/bin/env python3
"""Encode locked catalog-imprint versioning into dogfood.yaml.

- Adds catalog_imprints for NIST + STIG pointing at existing sdoc_path files
- Pins all conforms_to edges with catalog_imprint_id (keeps to: as item UID)
- Expands H03/H06/SEC-CAT statements; adds ARCH-CAT-* architecture requirements
- Does not drop edges. Idempotent on re-run for imprint pin + ARCH-CAT UIDs.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("error: PyYAML required", file=sys.stderr)
    sys.exit(1)

SEED_DIR = Path(__file__).resolve().parent.parent

NIST_IMPRINT_ID = "nist-800-53@rev5-dogfood-20261006"
STIG_IMPRINT_ID = "asd-stig@v6r4"

NIST_UID_RE = re.compile(r"^[A-Z]{1,4}-\d+(?:\.\d+)?$")
STIG_UID_RE = re.compile(r"^V-\d+$")

SEC_META = {
    "catalog_ref": "REQAML-SEC-CATALOG",
    "verification_note": (
        "Catalog steward gates; standard catalogs imprint-published read-only. "
        "AC-3/CM-5 aligned. Pins are (imprint_id, item_uid)."
    ),
}


def imprint_for_item(uid: str) -> str | None:
    if STIG_UID_RE.match(uid):
        return STIG_IMPRINT_ID
    if NIST_UID_RE.match(uid):
        return NIST_IMPRINT_ID
    return None


def ensure_imprints(data: dict) -> None:
    imprints = [
        {
            "id": NIST_IMPRINT_ID,
            "catalog_id": "cat-nist-global",
            "library_revision": "rev5",
            "import_identity": "dogfood-20261006",
            "sdoc_path": "catalog/nist-800-53.sdoc",
            "published_at": "2026-10-06T00:00:00-04:00",
            "status": "published",
            "notes": (
                "Dogfood NIST SP 800-53 Rev5 imprint. Item UIDs (AC-3, IA-2, …) are "
                "stable within this imprint. Published item rows are not rewritten in place; "
                "a new import yields a new imprint id."
            ),
        },
        {
            "id": STIG_IMPRINT_ID,
            "catalog_id": "cat-stig-asd-v6r4",
            "library_revision": "v6r4",
            "import_identity": "v6r4",
            "sdoc_path": "catalog/asd-stig-v6r4.sdoc",
            "published_at": "2025-10-01T00:00:00-04:00",
            "status": "published",
            "notes": (
                "DISA ASD STIG V6R4 imprint. Item UIDs (V-222536, …) are stable within "
                "this imprint. No in-place rewrite of published rule rows."
            ),
        },
    ]
    data["catalog_imprints"] = imprints

    # Update standard catalog notes to point at imprints
    for cat in data.get("catalogs") or []:
        if cat.get("id") == "cat-nist-global":
            cat["notes"] = (
                "Authoritative control text and UIDs live in catalog/nist-800-53.sdoc "
                f"(imprint {NIST_IMPRINT_ID}). YAML does not hold NIST library text. "
                "Product ConformsTo pins are (catalog_imprint_id, item_uid) e.g. "
                f"({NIST_IMPRINT_ID}, AC-3). Do not rewrite published imprint rows in place."
            )
            cat["current_imprint_id"] = NIST_IMPRINT_ID
        elif cat.get("id") == "cat-stig-asd-v6r4":
            cat["notes"] = (
                "Authoritative rule text and UIDs live in catalog/asd-stig-v6r4.sdoc "
                f"(imprint {STIG_IMPRINT_ID}). Product ConformsTo pins are "
                f"(catalog_imprint_id, item_uid) e.g. ({STIG_IMPRINT_ID}, V-222536)."
            )
            cat["current_imprint_id"] = STIG_IMPRINT_ID
        elif cat.get("id") == "cat-reqaml-security":
            cat["notes"] = (
                "Project catalog (REQAML-SEC-*): steward-mutable without an imprint until "
                "publish. Standards always require imprint publish (H03 / ARCH-CAT-SCOPE)."
            )


def pin_conforms_to(data: dict) -> tuple[int, int]:
    pinned = 0
    missing = 0
    for e in data.get("edges") or []:
        if e.get("kind") != "conforms_to":
            continue
        to = e.get("to") or ""
        imp = imprint_for_item(to)
        if not imp:
            missing += 1
            continue
        if e.get("catalog_imprint_id") != imp:
            e["catalog_imprint_id"] = imp
            pinned += 1
        else:
            pinned += 1  # already correct
    return pinned, missing


def upsert_line(lines: list, line: dict, after_base: str) -> None:
    bu = line["base_uid"]
    for i, existing in enumerate(lines):
        if existing.get("base_uid") == bu:
            lines[i] = line
            return
    # insert after after_base
    for i, existing in enumerate(lines):
        if existing.get("base_uid") == after_base:
            lines.insert(i + 1, line)
            return
    lines.append(line)


def upsert_version(versions: list, ver: dict, after_uid: str) -> None:
    uid = ver["uid"]
    for i, existing in enumerate(versions):
        if existing.get("uid") == uid:
            # preserve unrelated fields; replace statement/meta from ver
            versions[i] = ver
            return
    for i, existing in enumerate(versions):
        if existing.get("uid") == after_uid:
            versions.insert(i + 1, ver)
            return
    versions.append(ver)


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


def expand_statements(data: dict) -> None:
    updates = {
        "SEC-CAT": (
            "Catalogs provide standard and project templates. Standard catalogs (NIST/STIG) "
            "are versioned as imprints; project REQAML-SEC-* entries are steward-mutable "
            "until imprint publish. Stewardship, browse, reference, copy, imprint publish, "
            "import-diff, drift review, and pin semantics live here."
        ),
        "H03": (
            "A Catalog steward publishes a catalog imprint (library revision + import identity), "
            f"e.g. {NIST_IMPRINT_ID} or {STIG_IMPRINT_ID}. ReqAML freezes item rows for that "
            "imprint — published catalog item rows are never rewritten in place; a later import "
            "creates a new imprint. Standard catalogs (is_standard) always require imprint "
            "publish before ConformsTo pins may target them. Project catalogs (REQAML-SEC-*) "
            "may stay steward-mutable without an imprint until the steward publishes one. "
            "Publish is steward-only and audited (actor, catalog_id, imprint_id)."
        ),
        "H06": (
            "An Author references a standard catalog item from a requirement version without "
            "copying control text into the project tree (Northline). ReqAML stores a ConformsTo "
            "pin as (catalog_imprint_id, item_uid) — edges resolve through the imprint, not a "
            "floating global UID alone. security.catalog_ref may mirror the item_uid for browse."
        ),
    }
    for ver in data.get("requirement_versions") or []:
        uid = ver.get("uid")
        if uid in updates:
            ver["statement"] = updates[uid]
            if uid in ("H03", "H06"):
                ver["security"] = dict(SEC_META)


def add_arch_cat(data: dict) -> tuple[int, int, int]:
    """Add ARCH-CAT-* lines/versions/edges. Returns (new_lines, new_vers, new_edges)."""
    lines = data.setdefault("requirement_lines", [])
    versions = data.setdefault("requirement_versions", [])
    edges = data.setdefault("edges", [])

    arch_defs = [
        (
            "ARCH-CAT-IMPRINT",
            "Catalog imprint model",
            "H03",
            (
                "Standard catalogs are versioned as imprints: each imprint binds a "
                "library_revision and import_identity (e.g. nist-800-53@rev5-<import>, "
                "asd-stig@v6r4). Item UIDs (AC-3, V-222536) are stable within an imprint. "
                "Published imprint item rows are never rewritten in place; a new import "
                "yields a new imprint."
            ),
            "catalog:imprint:model",
            20,
            "iter-r0",
        ),
        (
            "ARCH-CAT-PIN",
            "ConformsTo pin is (imprint_id, item_uid)",
            "ARCH-CAT-IMPRINT",
            (
                "ConformsTo edges resolve through the imprint. Pin shape is "
                "(catalog_imprint_id, item_uid): YAML keeps to: as the stable item UID "
                "(AC-3, V-222536) and catalog_imprint_id naming the imprint. Resolution "
                "does not use a floating global UID alone."
            ),
            "catalog:imprint:pin",
            20,
            "iter-r0",
        ),
        (
            "ARCH-CAT-IMPORT",
            "Import imprint diffs; no auto-retarget",
            "ARCH-CAT-IMPRINT",
            (
                "When a steward imports a new imprint of a standard catalog, ReqAML diffs "
                "items by UID against the prior imprint and classifies each change as "
                "editorial | normative | withdrawn | renumbered (new UID). Live ConformsTo "
                "pins are NOT auto-retargeted to the new imprint."
            ),
            "catalog:imprint:import",
            55,
            "iter-r2",
        ),
        (
            "ARCH-CAT-DRIFT",
            "Catalog-drift flag on affected versions",
            "ARCH-CAT-IMPORT",
            (
                "After an import diff, ReqAML marks affected requirement versions with a "
                "first-class catalog_drift field (status/flag, change_class, prior/new "
                "imprint refs) so Author/Security review UIs can queue them for action."
            ),
            "catalog:imprint:drift",
            55,
            "iter-r2",
        ),
        (
            "ARCH-CAT-REACT",
            "Drift review: successor, grandfather, or withdraw",
            "ARCH-CAT-DRIFT",
            (
                "Author or Security reviews catalog_drift and chooses: (a) mint a successor "
                ".N that ConformsTo the new imprint item (optional review work item), "
                "(b) keep the grandfathered pin on the prior imprint until a contract allows "
                "a bump, or (c) withdraw conformance if the control was withdrawn/gone."
            ),
            "catalog:imprint:review",
            55,
            "iter-r2",
        ),
        (
            "ARCH-CAT-FREEZE",
            "Contracts/releases keep historical ConformsTo pins",
            "ARCH-CAT-PIN",
            (
                "Contracts and releases are not changed automatically on catalog import. "
                "They already pin requirement version UIDs; those versions retain their "
                "historical ConformsTo pins (imprint_id, item_uid) for historical compliance."
            ),
            "catalog:imprint:freeze",
            25,
            "iter-r0",
        ),
        (
            "ARCH-CAT-SCOPE",
            "Project vs standard catalog imprint rules",
            "H03",
            (
                "Project catalogs (REQAML-SEC-*) are steward-mutable without an imprint until "
                "publish. Standard catalogs (is_standard) always require imprint publish "
                "(H03) before pins; stewards cannot mutate published standard imprint rows "
                "in place (FIX-DENY-STEWARD-STANDARD)."
            ),
            "catalog:imprint:scope",
            40,
            "iter-r1",
        ),
    ]

    existing_bases = {ln.get("base_uid") for ln in lines}
    existing_uids = {v.get("uid") for v in versions}
    new_lines = new_vers = 0

    # Insert order: after H09 for lines that parent to H03; chain parents as defined.
    # Place all ARCH-CAT-* after H09 in declaration order.
    after = "H09"
    for bu, title, parent, stmt, rbac, prio, it in arch_defs:
        line = {
            "base_uid": bu,
            "project_id": "reqaml",
            "parent": parent if parent.startswith("ARCH-CAT") or parent.startswith("H") else "SEC-CAT",
            "kind": "requirement",
            "title": title,
        }
        # parents H03 / ARCH-CAT-* are under SEC-CAT tree
        if bu not in existing_bases:
            upsert_line(lines, line, after)
            new_lines += 1
            after = bu
            existing_bases.add(bu)
        else:
            upsert_line(lines, line, after)
            after = bu

        ver = {
            "uid": bu,
            "base_uid": bu,
            "version_n": 0,
            "status": "active",
            "statement": stmt,
            "priority": prio,
            "iteration": it,
            "rbac_op": rbac,
            "security": dict(SEC_META),
        }
        if bu not in existing_uids:
            upsert_version(versions, ver, "H09")
            new_vers += 1
            existing_uids.add(bu)
        else:
            upsert_version(versions, ver, "H09")

    # Semantic edges among ARCH-CAT / H*
    edge_specs = [
        ("ARCH-CAT-IMPRINT", "H03", "refines", None),
        ("ARCH-CAT-PIN", "H06", "refines", None),
        ("ARCH-CAT-PIN", "ARCH-CAT-IMPRINT", "uses", None),
        ("ARCH-CAT-IMPORT", "H03", "uses", None),
        ("ARCH-CAT-IMPORT", "ARCH-CAT-IMPRINT", "uses", None),
        ("ARCH-CAT-DRIFT", "ARCH-CAT-IMPORT", "uses", None),
        ("ARCH-CAT-REACT", "ARCH-CAT-DRIFT", "uses", None),
        ("ARCH-CAT-REACT", "ARCH-CAT-PIN", "uses", None),
        ("ARCH-CAT-REACT", "ARCH-VER-SUCC", "uses", None),
        ("ARCH-CAT-FREEZE", "ARCH-CAT-PIN", "uses", None),
        ("ARCH-CAT-FREEZE", "ARCH-RELEASE-FREEZE", "uses", None),
        ("ARCH-CAT-FREEZE", "ARCH-CONTRACT", "uses", None),
        ("ARCH-CAT-SCOPE", "H01", "refines", None),
        ("ARCH-CAT-SCOPE", "H03", "refines", None),
        # catalog conformance
        ("ARCH-CAT-IMPRINT", "AC-3", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-IMPRINT", "CM-5", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-PIN", "AC-3", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-PIN", "CM-5", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-IMPORT", "CM-5", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-IMPORT", "AU-2", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-DRIFT", "AU-2", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-DRIFT", "AU-3", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-REACT", "AC-3", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-REACT", "CM-5", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-FREEZE", "AU-12", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-SCOPE", "AC-3", "conforms_to", NIST_IMPRINT_ID),
        ("ARCH-CAT-SCOPE", "CM-5", "conforms_to", NIST_IMPRINT_ID),
        ("H03", "AC-3", "conforms_to", NIST_IMPRINT_ID),
        ("H03", "CM-5", "conforms_to", NIST_IMPRINT_ID),
    ]

    new_edges = 0
    for frm, to, kind, imp in edge_specs:
        if ensure_edge(edges, frm, to, kind, imp):
            new_edges += 1

    return new_lines, new_vers, new_edges


def add_sample_drift(data: dict) -> None:
    """Optional dogfood: one version flagged for catalog-drift review UI (illustrative)."""
    # Prefer a FIX fixture if present; else skip.
    target = None
    for ver in data.get("requirement_versions") or []:
        if ver.get("uid") == "FIX-ALLOW-STEWARD-UPDATE":
            target = ver
            break
    if not target:
        return
    # Only set if absent so re-runs don't clobber intentional clears
    if target.get("catalog_drift"):
        return
    # Illustrative: no live second imprint yet — status none documents the field shape.
    # Leave unset for FIX; instead document via ARCH-CAT-DRIFT statement only.
    return


def bump_schema(data: dict) -> None:
    data["schema_version"] = "2026-10-07"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", default=str(SEED_DIR / "dogfood.yaml"))
    ap.add_argument("--out", dest="outfile", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    infile = Path(args.infile)
    outfile = Path(args.outfile) if args.outfile else infile

    data = yaml.safe_load(infile.read_text(encoding="utf-8"))
    before_edges = len(data.get("edges") or [])
    before_ct = sum(1 for e in data.get("edges") or [] if e.get("kind") == "conforms_to")
    before_lines = len(data.get("requirement_lines") or [])
    before_vers = len(data.get("requirement_versions") or [])

    bump_schema(data)
    ensure_imprints(data)
    pinned, missing = pin_conforms_to(data)
    expand_statements(data)
    nl, nv, ne = add_arch_cat(data)
    # Re-pin in case new edges were added without imprint
    pinned2, missing2 = pin_conforms_to(data)
    add_sample_drift(data)

    after_edges = len(data.get("edges") or [])
    after_ct = sum(1 for e in data.get("edges") or [] if e.get("kind") == "conforms_to")
    after_pinned = sum(
        1
        for e in data.get("edges") or []
        if e.get("kind") == "conforms_to" and e.get("catalog_imprint_id")
    )

    print(f"schema_version → {data.get('schema_version')}")
    print(f"catalog_imprints: {len(data.get('catalog_imprints') or [])}")
    print(f"lines: {before_lines} → {len(data.get('requirement_lines') or [])} (+{nl})")
    print(f"versions: {before_vers} → {len(data.get('requirement_versions') or [])} (+{nv})")
    print(f"edges: {before_edges} → {after_edges} (+{ne} new semantic/conforms)")
    print(f"conforms_to: {before_ct} → {after_ct}")
    print(f"conforms_to with catalog_imprint_id: {after_pinned} (missing imprint map: {missing2})")

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
