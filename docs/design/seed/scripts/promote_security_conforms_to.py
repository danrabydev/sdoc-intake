#!/usr/bin/env python3
"""Promote security.verification_note / catalog_ref control IDs → conforms_to edges.

Only links to UIDs that exist in seed/catalog/*.sdoc (Northline: no invented controls).
Expands AU-2/3/12-style shorthand. REQAML-SEC-* stubs map to real NIST/STIG aliases
when the note has no bare AC-*/V-* IDs. Slims YAML catalogs stubs for NIST/STIG.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

try:
    import yaml
except ImportError:
    print("error: PyYAML required", file=sys.stderr)
    sys.exit(1)

SEED_DIR = Path(__file__).resolve().parent.parent
CATALOG_DIR = SEED_DIR / "catalog"

SLASH_FAMILY = re.compile(r"\b((?:AC|AU|IA|SC|CM|SI)-)(\d+)((?:/\d+)+)\b")
CTRL_RE = re.compile(r"\b((?:AC|AU|IA|SC|CM|SI)-\d+(?:\.\d+)?)\b")
STIG_RE = re.compile(r"\b(V-\d+)\b")
REQAML_RE = re.compile(r"\b(REQAML-SEC-[A-Z0-9-]+)\b")

# Project catalog stubs → real imported catalog UIDs (prefer AC-*/V-* over stubs).
SEC_ALIAS: dict[str, list[str]] = {
    "REQAML-SEC-SSO": ["IA-2", "AC-3", "V-222536"],
    "REQAML-SEC-SCOPE": ["AC-3"],
    "REQAML-SEC-RBAC": ["AC-2", "AC-6", "V-222429"],
    "REQAML-SEC-MCP": ["SC-8", "V-222567"],
    "REQAML-SEC-AUDIT": ["AU-2", "AU-3", "AU-12", "AU-6"],
    "REQAML-SEC-CATALOG": ["AC-3", "CM-5"],
}


NIST_IMPRINT_ID = "nist-800-53@rev5-dogfood-20261006"
STIG_IMPRINT_ID = "asd-stig@v6r4"


def imprint_for_item(uid: str) -> str | None:
    if uid.startswith("V-"):
        return STIG_IMPRINT_ID
    if uid[:1].isalpha() and "-" in uid:
        return NIST_IMPRINT_ID
    return None



def load_catalog_uids(catalog_dir: Path) -> set[str]:
    uids: set[str] = set()
    for path in sorted(catalog_dir.glob("*.sdoc")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("UID: "):
                uids.add(line[5:].strip())
    return uids


def extract_ids(text: str | None) -> set[str]:
    if not text:
        return set()

    def repl(m: re.Match[str]) -> str:
        prefix, first, rest = m.group(1), m.group(2), m.group(3)
        parts = [f"{prefix}{first}"]
        for p in rest.strip("/").split("/"):
            if p:
                parts.append(f"{prefix}{p}")
        return " ".join(parts)

    expanded = SLASH_FAMILY.sub(repl, text)
    found: set[str] = set()
    for m in CTRL_RE.finditer(expanded):
        found.add(m.group(1))
    for m in STIG_RE.finditer(expanded):
        found.add(m.group(1))
    for m in REQAML_RE.finditer(expanded):
        found.add(m.group(1))
    return found


def resolve_to_catalog(cid: str, catalog: set[str]) -> tuple[str | None, str | None]:
    """Return (target_uid, skip_reason). skip_reason set when not linkable."""
    if cid.startswith("REQAML-SEC-"):
        return None, "project-stub"
    norm = re.sub(r"\((\d+)\)", r".\1", cid)
    if norm in catalog:
        return norm, None
    parent = re.sub(r"\.\d+$", "", norm)
    if parent != norm and parent in catalog:
        return parent, f"subtype→{parent}"
    return None, "not-in-catalog"


def slim_catalogs(data: dict) -> dict:
    """Keep project REQAML-SEC catalog; replace NIST/STIG YAML stubs with pointers."""
    new_cats = []
    for cat in data.get("catalogs") or []:
        cid = cat.get("id")
        if cid == "cat-reqaml-security":
            new_cats.append(cat)
            continue
        if cid == "cat-nist-global":
            new_cats.append(
                {
                    "id": "cat-nist-global",
                    "scope": "global",
                    "client_id": None,
                    "project_id": None,
                    "title": "NIST SP 800-53 Rev5 (authoritative .sdoc)",
                    "is_standard": True,
                    "notes": (
                        "Authoritative control text and UIDs live in "
                        "catalog/nist-800-53.sdoc (and reqaml-strictdoc/input/catalog/). "
                        "YAML does not hold NIST library text. Product edges ConformsTo "
                        "bare UIDs such as AC-3, IA-2, AU-2."
                    ),
                    "entries": [],
                    "sdoc_path": "catalog/nist-800-53.sdoc",
                }
            )
            continue
        if cid == "cat-stig-asd-v6r4":
            new_cats.append(
                {
                    "id": "cat-stig-asd-v6r4",
                    "scope": "global",
                    "client_id": None,
                    "project_id": None,
                    "title": "DISA ASD STIG V6R4 (authoritative .sdoc)",
                    "is_standard": True,
                    "notes": (
                        "Authoritative rule text and UIDs live in "
                        "catalog/asd-stig-v6r4.sdoc. YAML stubs removed; product edges "
                        "ConformsTo bare V-* UIDs (e.g. V-222536)."
                    ),
                    "entries": [],
                    "sdoc_path": "catalog/asd-stig-v6r4.sdoc",
                }
            )
            continue
        new_cats.append(cat)
    data["catalogs"] = new_cats
    return data


def promote(data: dict, catalog: set[str]) -> dict:
    existing = {
        (e["from"], e["to"])
        for e in (data.get("edges") or [])
        if e.get("kind") == "conforms_to"
    }
    before = len(existing)
    added: list[tuple[str, str, str]] = []  # from, to, source
    skipped: list[tuple[str, str, str]] = []
    note_ids_promoted: set[str] = set()
    versions_touched: set[str] = set()

    for ver in data.get("requirement_versions") or []:
        uid = ver.get("uid")
        if not uid:
            continue
        sec = ver.get("security") or {}
        note = sec.get("verification_note") or ""
        cref = sec.get("catalog_ref") or ""
        found = extract_ids(note) | extract_ids(cref)
        if not found:
            continue

        # Collect real targets from note/ref
        targets: set[str] = set()
        for cid in found:
            target, reason = resolve_to_catalog(cid, catalog)
            if target:
                targets.add(target)
                if reason and reason.startswith("subtype"):
                    skipped.append((uid, cid, reason))
            elif reason == "project-stub":
                for alias in SEC_ALIAS.get(cid, []):
                    if alias in catalog:
                        targets.add(alias)
                        added_src = f"alias:{cid}"
                    else:
                        skipped.append((uid, alias, "alias-not-in-catalog"))
            elif reason:
                skipped.append((uid, cid, reason))

        # If only REQAML stubs (or aliases needed), ensure aliases applied
        reqaml_only = all(x.startswith("REQAML-SEC-") for x in found)
        if reqaml_only:
            for rid in found:
                for alias in SEC_ALIAS.get(rid, []):
                    if alias in catalog:
                        targets.add(alias)

        for target in sorted(targets):
            if (uid, target) in existing:
                continue
            edge = {"from": uid, "to": target, "kind": "conforms_to"}
            imp = imprint_for_item(target)
            if imp:
                edge["catalog_imprint_id"] = imp
            data.setdefault("edges", []).append(edge)
            existing.add((uid, target))
            src = "note/ref" if target in {
                resolve_to_catalog(c, catalog)[0]
                for c in found
                if resolve_to_catalog(c, catalog)[0]
            } else "alias"
            added.append((uid, target, src))
            note_ids_promoted.add(target)
            versions_touched.add(uid)

    stats = {
        "before": before,
        "after": len(existing),
        "added": len(added),
        "versions_touched": len(versions_touched),
        "unique_targets_added": len(note_ids_promoted),
        "skipped": len(skipped),
        "skipped_not_in_catalog": sorted(
            {s[1] for s in skipped if s[2] == "not-in-catalog"}
        ),
        "skipped_subtype": len([s for s in skipped if s[2].startswith("subtype")]),
        "added_by_src": dict(Counter(a[2] for a in added)),
    }
    return data, stats


class _LiteralStr(str):
    pass


def _represent_literal(dumper, data):
    if "\n" in data:
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", default=str(SEED_DIR / "dogfood.yaml"))
    ap.add_argument("--out", dest="outfile", default=None, help="Default: overwrite --in")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--catalog-dir", default=str(CATALOG_DIR))
    args = ap.parse_args()

    infile = Path(args.infile)
    outfile = Path(args.outfile) if args.outfile else infile
    catalog = load_catalog_uids(Path(args.catalog_dir))
    print(f"catalog UIDs loaded: {len(catalog)}")

    with infile.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)

    before_edges = len(data.get("edges") or [])
    before_ct = sum(1 for e in data.get("edges") or [] if e.get("kind") == "conforms_to")

    data, stats = promote(data, catalog)
    data = slim_catalogs(data)

    after_edges = len(data.get("edges") or [])
    after_ct = sum(1 for e in data.get("edges") or [] if e.get("kind") == "conforms_to")

    print(f"conforms_to: {before_ct} → {after_ct} (+{stats['added']})")
    print(f"edges total: {before_edges} → {after_edges}")
    print(f"versions gaining new conforms_to: {stats['versions_touched']}")
    print(f"unique catalog targets newly linked: {stats['unique_targets_added']}")
    print(f"skipped: {stats['skipped']} (subtype remaps={stats['skipped_subtype']})")
    print(f"not-in-catalog IDs: {stats['skipped_not_in_catalog']}")
    print(f"added_by_src: {stats['added_by_src']}")
    print(
        "catalogs slimmed: NIST/STIG entries=[] with sdoc_path pointers; "
        "cat-reqaml-security kept"
    )

    # Backfill catalog_imprint_id on any conforms_to still missing it.
    backfilled = 0
    for e in data.get("edges") or []:
        if e.get("kind") != "conforms_to":
            continue
        if e.get("catalog_imprint_id"):
            continue
        imp = imprint_for_item(e.get("to") or "")
        if imp:
            e["catalog_imprint_id"] = imp
            backfilled += 1
    print(f"catalog_imprint_id backfilled: {backfilled}")

    if args.dry_run:
        print("dry-run: not writing")
        return 0

    # Prefer block style similar to existing file; use default dump with width.
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
