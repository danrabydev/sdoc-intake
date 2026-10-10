#!/usr/bin/env python3
"""Baseline outbound edge preservation (@ main BASE_MAIN). Shared with seed patch scripts."""
from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML

SEED = Path(__file__).resolve().parent.parent
REPO_ROOT = SEED.parent.parent
BASE_MAIN = "d54c5a67235fd56e49bdbc2a939dce89ff5a4f36"
FIXTURE = SEED / "fixtures" / "dogfood-baseline-outbound-edges.json"


def canonical_edge(edge: dict) -> dict:
    """Stable edge record: every field present on the baseline edge, sorted keys."""
    return {k: deepcopy(edge[k]) for k in sorted(edge.keys())}


def edge_fingerprint(edge: dict) -> str:
    return json.dumps(canonical_edge(edge), sort_keys=True, default=str)


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


def baseline_outbound_edges(baseline) -> list[dict]:
    uids = baseline_version_uids(baseline)
    return [canonical_edge(e) for e in baseline.get("edges") or [] if str(e.get("from") or "") in uids]


def load_baseline_outbound_fixture() -> tuple[set[str], list[dict]]:
    if not FIXTURE.is_file():
        raise FileNotFoundError(f"missing baseline fixture {FIXTURE}")
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    if payload.get("baseline_main") != BASE_MAIN:
        raise ValueError(
            f"baseline fixture main mismatch: {payload.get('baseline_main')!r} != {BASE_MAIN!r}"
        )
    version_uids = {str(u) for u in payload.get("version_uids") or []}
    edges = [canonical_edge(e) for e in payload.get("edges") or []]
    if not version_uids:
        version_uids = {str(e["from"]) for e in edges}
    return version_uids, edges


def _record_fingerprint(record: dict) -> str:
    return json.dumps({k: deepcopy(record[k]) for k in sorted(record.keys())}, sort_keys=True, default=str)


def validate_baseline_records_preserved(
    data,
    *,
    allow_version_uids: frozenset[str] | None = None,
    allow_release_ids: frozenset[str] | None = None,
) -> None:
    """Every baseline version/release row must match main @ BASE_MAIN unless allow-listed."""
    allow_version_uids = allow_version_uids or frozenset()
    allow_release_ids = allow_release_ids or frozenset()
    baseline = load_baseline_dogfood()
    changed: list[str] = []
    for ver in baseline.get("requirement_versions") or []:
        uid = str(ver.get("uid") or "")
        if not uid or uid in allow_version_uids:
            continue
        cur = next((v for v in data.get("requirement_versions") or [] if str(v.get("uid") or "") == uid), None)
        if cur is None:
            changed.append(f"version {uid} missing")
            continue
        if _record_fingerprint(cur) != _record_fingerprint(ver):
            changed.append(f"version {uid} mutated")
    for rel in baseline.get("releases") or []:
        rid = str(rel.get("id") or "")
        if not rid or rid in allow_release_ids:
            continue
        cur = next((r for r in data.get("releases") or [] if str(r.get("id") or "") == rid), None)
        if cur is None:
            changed.append(f"release {rid} missing")
            continue
        if _record_fingerprint(cur) != _record_fingerprint(rel):
            changed.append(f"release {rid} mutated")
    if changed:
        sample = changed[:5]
        raise SystemExit(
            f"baseline record preservation failed: {len(changed)} row(s) changed @ {BASE_MAIN[:12]} (sample: {sample})"
        )


def validate_baseline_edges_preserved(
    data,
    *,
    required: list[dict] | None = None,
    version_uids: set[str] | None = None,
) -> None:
    """Every outbound edge from a baseline version uid must still exist with all fields unchanged."""
    if required is None or version_uids is None:
        version_uids, required = load_baseline_outbound_fixture()
    req_counter = Counter(edge_fingerprint(e) for e in required)
    present = [
        canonical_edge(e)
        for e in data.get("edges") or []
        if str(e.get("from") or "") in version_uids
    ]
    pres_counter = Counter(edge_fingerprint(e) for e in present)
    missing = req_counter - pres_counter
    if missing:
        sample_fps = list(missing.keys())[:3]
        sample = [json.loads(fp) for fp in sample_fps]
        raise SystemExit(
            f"baseline edge preservation failed: {sum(missing.values())} outbound edge(s) missing "
            f"or changed (sample: {sample})"
        )


def write_baseline_outbound_fixture() -> int:
    baseline = load_baseline_dogfood()
    version_uids = sorted(baseline_version_uids(baseline))
    edges = baseline_outbound_edges(baseline)
    edges.sort(key=edge_fingerprint)
    payload = {
        "baseline_main": BASE_MAIN,
        "version_uids": version_uids,
        "edge_count": len(edges),
        "edges": edges,
    }
    FIXTURE.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {FIXTURE} ({len(edges)} outbound edges @ {BASE_MAIN[:12]})")
    return len(edges)


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
