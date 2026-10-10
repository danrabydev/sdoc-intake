#!/usr/bin/env python3
"""Validate dogfood baseline before/after workflow read PR (no release row edits).

Workflow fixture rows already live in dogfood.yaml; this script only checks idempotency guards.
Run: python3 patch_workflow_read_validate.py && python3 yaml_to_strictdoc.py --validate
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ruamel.yaml import YAML

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_baseline_edges import validate_baseline_edges_preserved  # noqa: E402

yaml = YAML()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--validate-baseline-edges",
        action="store_true",
        help="Load dogfood.yaml and verify baseline outbound edges preserved (no write)",
    )
    args = parser.parse_args()

    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    validate_baseline_edges_preserved(data)
    if args.validate_baseline_edges:
        print("baseline edge preservation ok")
        return
    print("workflow read seed validate ok (no dogfood.yaml mutations)")


if __name__ == "__main__":
    main()
