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
        managed = self.mod.fixture_version_uids(self.snippet)
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
        self.mod.apply_cyber_fixtures(data, self.snippet)
        mid = v0_keys(data.get("edges") or [])
        self.assertEqual(mid, before)
        self.mod.apply_cyber_fixtures(data, self.snippet)
        after = v0_keys(data.get("edges") or [])
        self.assertEqual(after, before)


    def test_validate_baseline_edges_fails_when_rbac_refines_removed(self) -> None:
        baseline_mod = self.mod._baseline_edges_module()
        version_uids, required = baseline_mod.load_baseline_outbound_fixture()
        target_fp = baseline_mod.edge_fingerprint(
            {"from": "ARCH-API-RBAC.1", "to": "ARCH-API-RBAC", "kind": "refines"}
        )
        self.assertTrue(any(baseline_mod.edge_fingerprint(e) == target_fp for e in required))
        y = YAML()
        with self.mod.DOGFOOD.open("r", encoding="utf-8") as f:
            data = y.load(f)
        data["edges"] = [
            e
            for e in data.get("edges") or []
            if baseline_mod.edge_fingerprint(e) != target_fp
        ]
        with self.assertRaises(SystemExit):
            baseline_mod.validate_baseline_edges_preserved(
                data, required=required, version_uids=version_uids
            )

    def test_validate_baseline_edges_fails_when_trace_suspect_flipped(self) -> None:
        baseline_mod = self.mod._baseline_edges_module()
        version_uids, required = baseline_mod.load_baseline_outbound_fixture()
        suspect = next(e for e in required if e.get("trace_suspect") is True)
        y = YAML()
        with self.mod.DOGFOOD.open("r", encoding="utf-8") as f:
            data = y.load(f)
        fp = baseline_mod.edge_fingerprint(suspect)
        for e in data.get("edges") or []:
            if baseline_mod.edge_fingerprint(e) == fp:
                e["trace_suspect"] = not e.get("trace_suspect", False)
                break
        else:
            self.fail("suspect baseline edge not found in dogfood")
        with self.assertRaises(SystemExit):
            baseline_mod.validate_baseline_edges_preserved(
                data, required=required, version_uids=version_uids
            )


if __name__ == "__main__":
    unittest.main()
