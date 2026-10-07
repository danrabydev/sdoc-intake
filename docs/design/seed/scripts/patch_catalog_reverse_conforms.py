#!/usr/bin/env python3
"""Idempotent overlay: add Child ROLE ConformsTo on catalog .sdoc nodes.

Product requirements already emit Parent ROLE ConformsTo → catalog UIDs.
This script mirrors reverse links onto NIST/STIG catalog nodes so the StrictDoc
graph is bidirectional (like contract InScopeOf membership).

Preserves control STATEMENT text; only touches GRAMMAR RELATIONS and per-node
RELATIONS blocks. Re-run after re-copying catalogs from sdoc-intake.

Uses Child + ConformsTo (not Parent) so dual-declare with product Parent
ConformsTo needs the idempotent many_to_many_set.create_link patch (present on
this box) or export may assert. Pass --no-reverse to skip (product Parent only).
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

try:
    import yaml
except ImportError:
    print("error: PyYAML required", file=sys.stderr)
    sys.exit(1)

SEED_DIR = Path(__file__).resolve().parent.parent

CHILD_CONFORMS_GRAMMAR = """  - TYPE: Child
    ROLE: ConformsTo
"""


def load_conforms_edges(yaml_path: Path) -> dict[str, list[str]]:
    """catalog_uid → sorted list of product version UIDs that ConformsTo it."""
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    rev: dict[str, set[str]] = defaultdict(set)
    for e in data.get("edges") or []:
        if e.get("kind") != "conforms_to":
            continue
        frm, to = e.get("from"), e.get("to")
        if frm and to:
            rev[to].add(frm)
    return {k: sorted(v) for k, v in rev.items()}


def ensure_child_conforms_grammar(text: str) -> str:
    """Insert Child ROLE ConformsTo into REQUIREMENT RELATIONS grammar if missing."""
    if re.search(r"- TYPE: Child\n\s+ROLE: ConformsTo", text):
        return text
    # After Parent ROLE ConformsTo block in grammar
    pat = re.compile(
        r"(  - TYPE: Parent\n    ROLE: ConformsTo\n)",
    )
    m = pat.search(text)
    if not m:
        # Append before end of RELATIONS / next ELEMENTS or blank after grammar
        # Fallback: after last ROLE: ConformsTo (Parent)
        pat2 = re.compile(r"(    ROLE: ConformsTo\n)")
        m2 = pat2.search(text)
        if not m2:
            print("warning: could not find ConformsTo in grammar", file=sys.stderr)
            return text
        return text[: m2.end()] + CHILD_CONFORMS_GRAMMAR + text[m2.end() :]
    return text[: m.end()] + CHILD_CONFORMS_GRAMMAR + text[m.end() :]


def strip_existing_child_conforms(block: str) -> str:
    """Remove prior Child ConformsTo entries from a RELATIONS block body."""
    # Remove lines matching Child + VALUE + ROLE ConformsTo triples
    lines = block.splitlines(keepends=True)
    out: list[str] = []
    i = 0
    while i < len(lines):
        if (
            lines[i].strip() == "- TYPE: Child"
            and i + 2 < len(lines)
            and lines[i + 1].lstrip().startswith("VALUE:")
            and lines[i + 2].strip() == "ROLE: ConformsTo"
        ):
            i += 3
            continue
        out.append(lines[i])
        i += 1
    return "".join(out)


def patch_requirement_node(node_text: str, children: list[str]) -> str:
    """Add/replace Child ConformsTo RELATIONS on a single [REQUIREMENT] block."""
    if not children:
        # Strip any prior reverse links if no product edges
        if "RELATIONS:" in node_text:
            # rare for stock catalogs
            pass
        return node_text

    rel_lines = []
    for uid in children:
        rel_lines.append("- TYPE: Child")
        rel_lines.append(f"  VALUE: {uid}")
        rel_lines.append("  ROLE: ConformsTo")
    rel_body = "\n".join(rel_lines) + "\n"

    if re.search(r"^RELATIONS:\n", node_text, re.M):
        # Extend existing RELATIONS
        def repl(m: re.Match[str]) -> str:
            head = m.group(1)
            body = strip_existing_child_conforms(m.group(2))
            # body may be empty or have other relations
            if body and not body.endswith("\n"):
                body += "\n"
            return head + body + rel_body

        # RELATIONS until next blank line before [REQUIREMENT] / [[ or EOF within node
        new_text, n = re.subn(
            r"(RELATIONS:\n)((?:^- .*\n(?:  .*\n)*)*)",
            repl,
            node_text,
            count=1,
            flags=re.M,
        )
        if n:
            return new_text

    # No RELATIONS yet — insert before trailing blank at end of node
    # Node ends at last non-empty content; append RELATIONS
    return node_text.rstrip() + "\nRELATIONS:\n" + rel_body + "\n"


def split_requirements(text: str) -> list[tuple[str, str]]:
    """Split document into (prefix_or_uid, chunk) where chunk is [REQUIREMENT]..."""
    parts = re.split(r"(?=^\[REQUIREMENT\]\n)", text, flags=re.M)
    return parts


def patch_sdoc(path: Path, reverse: dict[str, list[str]], dry_run: bool = False) -> tuple[int, int]:
    text = path.read_text(encoding="utf-8")
    text = ensure_child_conforms_grammar(text)

    parts = split_requirements(text)
    patched_nodes = 0
    link_count = 0
    out_parts: list[str] = []
    for part in parts:
        if not part.startswith("[REQUIREMENT]"):
            out_parts.append(part)
            continue
        m = re.search(r"^UID: (.+)$", part, re.M)
        if not m:
            out_parts.append(part)
            continue
        uid = m.group(1).strip()
        children = reverse.get(uid) or []
        if children:
            new_part = patch_requirement_node(part, children)
            if new_part != part:
                patched_nodes += 1
            link_count += len(children)
            out_parts.append(new_part)
        else:
            # Ensure we strip stale reverse links if any
            if "ROLE: ConformsTo" in part and "- TYPE: Child" in part:
                out_parts.append(patch_requirement_node(part, []))
            else:
                out_parts.append(part)

    new_text = "".join(out_parts)
    if not dry_run and new_text != path.read_text(encoding="utf-8"):
        path.write_text(new_text, encoding="utf-8")
    return patched_nodes, link_count


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--yaml", default=str(SEED_DIR / "dogfood.yaml"))
    ap.add_argument(
        "--catalog",
        action="append",
        dest="catalogs",
        help="Catalog .sdoc path (repeatable). Default: seed/catalog/*.sdoc",
    )
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--no-reverse",
        action="store_true",
        help="Do nothing (document option for Parent-only exports)",
    )
    args = ap.parse_args()

    if args.no_reverse:
        print(" --no-reverse: skipping catalog Child ConformsTo overlay")
        return 0

    reverse = load_conforms_edges(Path(args.yaml))
    print(f"catalog targets with ≥1 ConformsTo: {len(reverse)}")
    print(f"total reverse links: {sum(len(v) for v in reverse.values())}")

    catalogs = [Path(p) for p in (args.catalogs or [])]
    if not catalogs:
        catalogs = sorted((SEED_DIR / "catalog").glob("*.sdoc"))

    for path in catalogs:
        nodes, links = patch_sdoc(path, reverse, dry_run=args.dry_run)
        print(f"{'[dry-run] ' if args.dry_run else ''}{path.name}: patched_nodes={nodes} reverse_links={links}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
