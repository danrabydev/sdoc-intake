#!/usr/bin/env python3
"""Patch guardrails: managed-from uids exclude line base_uids; protected edges stable."""
from __future__ import annotations

import importlib.util
import unittest
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML

SCRIPT = Path(__file__).resolve().parent / "patch_attach_figma_seed_release.py"
SNIPPET = Path(__file__).resolve().parent.parent / "fixtures" / "cyber-attach-figma-snippet.yaml"
DOGFOOD = Path(__file__).resolve().parent.parent / "dogfood.yaml"
KEY_SCOPE = "ARCH-KEY-SCOPE"


def _load_module():
    spec = importlib.util.spec_from_file_location("patch_attach_figma_seed_release", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


class PatchAttachFigmaSeedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mod = _load_module()
        yaml = YAML()
        with SNIPPET.open("r", encoding="utf-8") as f:
            cls.snippet = yaml.load(f)

    def test_managed_from_excludes_key_scope_base_uid(self) -> None:
        managed = self.mod.snippet_managed_from_uids(self.snippet)
        self.assertIn("ARCH-KEY-SCOPE.1", managed)
        self.assertNotIn(KEY_SCOPE, managed)

    def test_assert_protected_edges_unchanged_rejects_removal(self) -> None:
        managed = {"ARCH-KEY-SCOPE.1"}
        before = {("OTHER", "M03", "uses", "")}
        after = []
        with self.assertRaises(RuntimeError):
            self.mod.assert_protected_edges_unchanged(before, after, managed)

    def test_apply_snippet_twice_keeps_key_scope_v0_outbound(self) -> None:
        yaml = YAML()
        with DOGFOOD.open("r", encoding="utf-8") as f:
            data = yaml.load(f)
        v0_keys = lambda edges: {
            self.mod.edge_key(e) for e in edges if e.get("from") == KEY_SCOPE
        }
        before = v0_keys(data.get("edges") or [])
        self.assertEqual(len(before), 6, "dogfood must ship six ARCH-KEY-SCOPE v0 outbound edges")
        self.mod.apply_snippet(data, self.snippet)
        mid = v0_keys(data.get("edges") or [])
        self.assertEqual(mid, before)
        self.mod.apply_snippet(data, self.snippet)
        after = v0_keys(data.get("edges") or [])
        self.assertEqual(after, before)


if __name__ == "__main__":
    unittest.main()
