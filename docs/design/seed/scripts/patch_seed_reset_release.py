#!/usr/bin/env python3
"""Ship rel-r1-route-helper and add rel-r1-seed-reset (this PR).

Idempotent. Does NOT git commit. Run yaml_to_strictdoc.py --validate afterwards.
"""
from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
MERGE_ROUTE_HELPER = "ecbd68b"
SHIPPED_ROUTE_HELPER = "2026-10-08"

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 1200
yaml.indent(mapping=2, sequence=2, offset=0)


def cm(**kw):
    m = CommentedMap()
    for k, v in kw.items():
        m[k] = v
    return m


def statement_hash(text: str) -> str:
    canon = "\n".join(line.rstrip() for line in text.strip().replace("\r\n", "\n").split("\n"))
    return "sha256:" + hashlib.sha256(canon.encode("utf-8")).hexdigest()


def find(seq, key, val):
    for x in seq or []:
        if x.get(key) == val:
            return x
    return None


def upsert(seq, key, item):
    cur = find(seq, key, item[key])
    if cur is None:
        seq.append(item)
        return 1
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
    return 0


def ensure_edge(edges, edge):
    key = (edge.get("from"), edge.get("to"), edge.get("kind"), edge.get("catalog_imprint_id"))
    for e in edges:
        if (e.get("from"), e.get("to"), e.get("kind"), e.get("catalog_imprint_id")) == key:
            return 0
    edges.append(edge)
    return 1


ROUTE_HELPER_CAPS = [
    "CAP-SVC-OPERATION-ROUTE",
    "CAP-SVC-BUSINESS-ROUTE-AUDIT",
    "CAP-SVC-PROBLEM-JSON",
]

SEED_RESET_CAPS = [
    (
        "CAP-DEVENV-SEED-RESET",
        "Dev-only dogfood seed reset (pnpm devenv:seed:reset)",
        "Development-only command `pnpm devenv:seed:reset --confirm` wipes ReqALM project fixture rows "
        "(requirement lines/versions, releases and delivers) and reloads them from docs/design/seed/dogfood.yaml "
        "in one transaction, preserving identities, grants, sessions/MFA, OpenBao keys, and append-only audit_events. "
        "Refuses production markers and runs only with explicit --confirm after printing a delete/load plan. "
        "Records one business audit event with load counts. Idempotent second run yields identical DB contents.",
        [("ARCH-DEVENV-SEED", "satisfies"), ("FIX-ALLOW-DEVENV-SEED-IDEMPOTENT", "satisfies")],
        [
            f"{REPO}/apps/reqalm/src/seed/seed-reset.ts",
            f"{REPO}/apps/reqalm/src/cli/seed-reset.ts",
            f"{REPO}/apps/reqalm/src/seed/seed-reset.test.ts",
        ],
    ),
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    rel_rh = find(data.get("releases"), "id", "rel-r1-route-helper")
    if rel_rh and rel_rh.get("status") != "shipped":
        rel_rh["status"] = "shipped"
        rel_rh["shipped_on"] = SHIPPED_ROUTE_HELPER
        rel_rh["notes"] = (
            f"One PR = one release. https://github.com/danrabydev/sdoc-intake/pull/19 merged to main as "
            f"{MERGE_ROUTE_HELPER} on {SHIPPED_ROUTE_HELPER}. Verified locally: tests, typecheck, build; "
            "defineOperationRoute pipeline + route-security audit."
        )
    for cap in ROUTE_HELPER_CAPS:
        ver = find(data.get("requirement_versions"), "uid", cap)
        if ver and ver.get("status") == "draft":
            ver["status"] = "active"
            ver["verification_outcome"] = "pass"

    edges = data.setdefault("edges", [])
    arts = data.setdefault("capability_artifacts", [])
    deliver_uids = []

    for cap_uid, title, stmt, satisfies, artifact_paths in SEED_RESET_CAPS:
        base = cap_uid.replace("CAP-", "").lower().replace("_", "-")
        upsert(
            data.setdefault("requirement_lines", []),
            "base_uid",
            cm(base_uid=cap_uid, project_id="reqalm", parent="SEC-DEVENV", kind="capability", title=title),
        )
        upsert(
            data.setdefault("requirement_versions", []),
            "uid",
            cm(
                uid=cap_uid,
                base_uid=cap_uid,
                version_n=0,
                status="draft",
                statement=stmt,
                priority=10,
                iteration="iter-r1",
                security={
                    "catalog_ref": "CM-2",
                    "verification_note": "Planned until seed-reset PR merges and is verified locally.",
                },
                statement_hash=statement_hash(stmt),
                grooming_state="detailed",
            ),
        )
        upsert(
            data.setdefault("approval_records", []),
            "id",
            cm(
                id=f"ar-{base}",
                subject_kind="CapabilityLine",
                base_uid=cap_uid,
                status="unapproved",
                by=None,
                at=None,
                notes="Planned for seed-reset PR; approve once merged and verified.",
                approved_version_uid=None,
                approved_statement_hash=None,
            ),
        )
        for to, kind in satisfies:
            ensure_edge(edges, {"from": cap_uid, "to": to, "kind": kind})
        for uri in artifact_paths:
            if not any(a.get("requirement_version_uid") == cap_uid and a.get("uri") == uri for a in arts):
                arts.append({"requirement_version_uid": cap_uid, "kind": "other", "uri": uri})
        deliver_uids.append(cap_uid)

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id="rel-r1-seed-reset",
            project_id="reqalm",
            name="R1 — dev dogfood seed reset (pnpm devenv:seed:reset)",
            planned_on="2026-10-08",
            shipped_on=None,
            status="planned",
            delivers=deliver_uids,
            cyber_gate=False,
            notes=(
                "One PR = one release. Dev-only wipe+reload of project fixture rows from dogfood.yaml "
                "without docker compose down -v. Planned until merged; flip to shipped at merge sha."
            ),
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)

    print("Patched dogfood.yaml: shipped rel-r1-route-helper, added rel-r1-seed-reset")


if __name__ == "__main__":
    main()
