#!/usr/bin/env python3
"""Baseline outbound edge preservation (@ main BASE_MAIN). Shared with seed patch scripts."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from ruamel.yaml import YAML

SEED = Path(__file__).resolve().parent.parent
REPO_ROOT = SEED.parent.parent
BASE_MAIN = "56bfc4d6a9fe04559ccddae636ec4052d84ae907"
FIXTURE = SEED / "fixtures" / "dogfood-baseline-outbound-edges.json"


def edge_key(edge: dict) -> tuple[str, str, str, str]:
    return (
        str(edge.get("from") or ""),
        str(edge.get("to") or ""),
        str(edge.get("kind") or ""),
        str(edge.get("catalog_imprint_id") or ""),
    )


def load_baseline_dogfood():
    raw = subprocess.check_output(
        ["git", "show", f"{BASE_MAIN}:docs/design/seed/dogfood.yaml"],
        cwd=REPO_ROOT,
    )
    y = YAML()
    y.preserve_quotes = True
    return y.load(raw)


def baseline_version_uids(baseline) -> set[str]:
    return {str(v["uid"]) for v in baseline.get("requirement_versions") or [] if v.get("uid")}


def baseline_outbound_edge_keys(baseline) -> set[tuple[str, str, str, str]]:
    uids = baseline_version_uids(baseline)
    return {edge_key(e) for e in baseline.get("edges") or [] if str(e.get("from") or "") in uids}


def load_baseline_outbound_fixture() -> set[tuple[str, str, str, str]]:
    if not FIXTURE.is_file():
        raise FileNotFoundError(f"missing baseline fixture {FIXTURE}")
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    if payload.get("baseline_main") != BASE_MAIN:
        raise ValueError(
            f"baseline fixture main mismatch: {payload.get('baseline_main')!r} != {BASE_MAIN!r}"
        )
    keys: set[tuple[str, str, str, str]] = set()
    for row in payload.get("edges") or []:
        keys.add(
            (
                str(row[0]),
                str(row[1]),
                str(row[2]),
                str(row[3]) if len(row) > 3 else "",
            )
        )
    return keys


def validate_baseline_edges_preserved(data, *, required: set[tuple[str, str, str, str]] | None = None) -> None:
    """Every outbound edge from a baseline version uid must still exist unchanged."""
    need = required if required is not None else load_baseline_outbound_fixture()
    present = {edge_key(e) for e in data.get("edges") or []}
    missing = need - present
    if missing:
        sample = sorted(missing)[:5]
        raise SystemExit(
            f"baseline edge preservation failed: {len(missing)} outbound edge(s) missing "
            f"or changed (sample: {sample})"
        )


def write_baseline_outbound_fixture() -> int:
    baseline = load_baseline_dogfood()
    keys = sorted(baseline_outbound_edge_keys(baseline))
    payload = {
        "baseline_main": BASE_MAIN,
        "edge_count": len(keys),
        "edges": [[a, b, c, d] for a, b, c, d in keys],
    }
    FIXTURE.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {FIXTURE} ({len(keys)} outbound edges @ {BASE_MAIN[:12]})")
    return len(keys)


def main(argv: list[str] | None = None) -> None:
    args = argv if argv is not None else sys.argv[1:]
    if args == ["write-fixture"]:
        write_baseline_outbound_fixture()
        return
    if args:
        raise SystemExit(f"usage: {Path(__file__).name} [write-fixture]")
    y = YAML()
    y.preserve_quotes = True
    data = y.load((SEED / "dogfood.yaml").open("r", encoding="utf-8"))
    validate_baseline_edges_preserved(data)
    print("baseline edge preservation ok")


if __name__ == "__main__":
    main()
