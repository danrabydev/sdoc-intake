#!/usr/bin/env python3
"""Ship rel-r1-test-hygiene and add rel-r1-rename-reqalm (this PR).

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
MERGE_SHA = "6c74731f522a01dfcd667e19d087cb59a1022a17"
EVIDENCE_HYGIENE = (
    "Verified: 2026-10-07 cloud agent VM (no Docker): offline `pnpm test` 39/39 + 209/209; "
    "`pnpm typecheck` pass; prod build/image has no test code; `pnpm devenv:smoke` passed under "
    "project sdoc-intake-dev (maintainer Docker)."
)
EVIDENCE_RENAME = (
    "Verified 2026-10-07: offline `pnpm test` 39/39 + 209/209, `pnpm typecheck`, `pnpm build` pass; "
    "seed yaml_to_strictdoc --validate pass. Local Docker in-place upgrade of a PR #15 dev stack (same "
    "volumes): `pnpm devenv:init` moved .reqaml/ + REQAML_* to .reqalm/ + REQALM_* with byte-identical "
    "secret values; migration 005 renamed OAuth client ids, the project id and seeded grant ids; /ready "
    "green, 0 restarts; the existing dev password and sam-security MFA secret still sign in; UI says "
    "ReqALM; `pnpm devenv:smoke` pass."
)

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


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    # --- Ship rel-r1-test-hygiene ---
    rel_hygiene = find(data.get("releases"), "id", "rel-r1-test-hygiene")
    if rel_hygiene:
        rel_hygiene["status"] = "shipped"
        rel_hygiene["shipped_on"] = "2026-10-07"
        rel_hygiene["notes"] = (
            f"One PR = one release. https://github.com/danrabydev/sdoc-intake/pull/15 merged to main as "
            f"{MERGE_SHA} on 2026-10-07. {EVIDENCE_HYGIENE}"
        )

    for cap_uid in (
        "CAP-TEST-PROD-BUILD-EXCLUDE",
        "CAP-TEST-AUTH-HYGIENE",
        "CAP-DEVENV-SMOKE-COMPOSE-ISOLATION",
    ):
        ver = find(data.get("requirement_versions"), "uid", cap_uid)
        if ver:
            ver["status"] = "active"
            ver["verification_outcome"] = "pass"
        ar_id = {
            "CAP-TEST-PROD-BUILD-EXCLUDE": "ar-cap-test-prod-build-exclude",
            "CAP-TEST-AUTH-HYGIENE": "ar-cap-test-auth-hygiene",
            "CAP-DEVENV-SMOKE-COMPOSE-ISOLATION": "ar-cap-devenv-smoke-compose-isolation",
        }[cap_uid]
        ar = find(data.get("approval_records"), "id", ar_id)
        if ar:
            ar["notes"] = (
                "Delivered in PR #15; solution approval (ARCH-CAP-APPROVE) pending Dan at merge review."
            )

    # --- Add rename release + capability ---
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid="CAP-RENAME-REQALM",
            project_id="reqalm",
            parent="SEC-BUILD",
            kind="capability",
            title="Product name correction: ReqALM (ALM, not AML)",
        ),
    )

    stmt = (
        "Repository, runtime identifiers, OAuth client IDs, env vars, and dogfood seed use the product name "
        "ReqALM (requirements + application lifecycle management). Persisted identifiers keep the legacy "
        "ReqAML spelling where renaming would orphan existing data: Compose volume names (reqaml-pg, "
        "reqaml-openbao, reqaml-secrets), OpenBao Transit key names (reqaml-kek, reqaml-dek-*) and an existing "
        "Postgres role/database. Existing dev stacks upgrade in place: migration 005 renames OAuth client ids, "
        "the project id and seeded grant ids, and `pnpm devenv:init` migrates .reqaml/ and REQAML_* names "
        "keeping secret values. Active requirement statements keep historical ReqAML prose until a content "
        "successor."
    )
    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid="CAP-RENAME-REQALM",
            base_uid="CAP-RENAME-REQALM",
            version_n=0,
            status="draft",
            statement=stmt,
            priority=10,
            iteration="iter-r1",
            security={
                "catalog_ref": "CM-2",
                "verification_note": EVIDENCE_RENAME,
            },
            statement_hash=statement_hash(stmt),
            grooming_state="detailed",
        ),
    )

    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-cap-rename-reqalm",
            subject_kind="CapabilityLine",
            base_uid="CAP-RENAME-REQALM",
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for rename PR; approve as solution once merged and verified.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )

    edges = data.setdefault("edges", [])
    ensure_edge(
        edges,
        {"from": "CAP-RENAME-REQALM", "to": "ARCH-BUILD-FOUNDATION", "kind": "satisfies"},
    )

    arts = data.setdefault("capability_artifacts", [])
    if not any(
        a.get("requirement_version_uid") == "CAP-RENAME-REQALM" and a.get("uri", "").endswith("README.md")
        for a in arts
    ):
        arts.append(
            {
                "requirement_version_uid": "CAP-RENAME-REQALM",
                "kind": "other",
                "uri": f"{REPO}/README.md",
            }
        )

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id="rel-r1-rename-reqalm",
            project_id="reqalm",
            name="R1 — product rename ReqALM",
            planned_on="2026-10-07",
            shipped_on=None,
            status="planned",
            delivers=["CAP-RENAME-REQALM"],
            cyber_gate=False,
            notes=(
                "One PR = one release. https://github.com/danrabydev/sdoc-intake/pull/16 (planned until merge). "
                f"{EVIDENCE_RENAME}"
            ),
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)

    print("Patched dogfood.yaml: shipped rel-r1-test-hygiene, added rel-r1-rename-reqalm / CAP-RENAME-REQALM")


if __name__ == "__main__":
    main()
