#!/usr/bin/env python3
"""Ship rel-r1-relations-api (PR #31, merge cb8a8c9); add rel-r1-lf-endings / CAP-DEVENV-LF-ENDINGS (this PR).

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
PLANNED = "2026-10-09"
RELATIONS_SHIPPED = "2026-10-09"
RELATIONS_MERGE_SHA = "cb8a8c97895b651c8f25ce660482e7e5e7ae4454"
CAP_RELATIONS = "CAP-RELATIONS-API"
REL_RELATIONS = "rel-r1-relations-api"
CAP = "CAP-DEVENV-LF-ENDINGS"
REL = "rel-r1-lf-endings"
NIST = "nist-800-53@rev5-dogfood-20261006"

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


def ship_relations_api(data) -> None:
    rel = find(data.get("releases"), "id", REL_RELATIONS)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = RELATIONS_SHIPPED
        rel["notes"] = (
            f"PR #31 merged to main as {RELATIONS_MERGE_SHA} on {RELATIONS_SHIPPED}. "
            "Read-only relations endpoint + trace_edges seed load; browse UI graph deferred."
        )

    ver = find(data.get("requirement_versions"), "uid", CAP_RELATIONS)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "AC-3")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {
            "catalog_ref": catalog_ref,
            "verification_note": (
                f"Shipped with requirement relations read API PR #31 (merge {RELATIONS_MERGE_SHA})."
            ),
        }

    ar = find(data.get("approval_records"), "id", "ar-relations-api")
    if ar:
        ar["status"] = "unapproved"
        ar["notes"] = (
            f"Capability active with verification pass after PR #31 merge {RELATIONS_MERGE_SHA}; "
            "formal approval record not filed in seed."
        )
        ar["approved_version_uid"] = None
        ar["approved_statement_hash"] = None


STMT = (
    "Repository line endings are enforced for the Compose dev stack: a root .gitattributes keeps shell entrypoints "
    "and Docker/Compose context files as LF in Git so Linux containers never see a bash\\r shebang when Windows "
    "Git checks out with core.autocrlf=true. Documented recovery re-normalizes an existing Windows working tree "
    "after pulling the fix."
)
ARTIFACTS = [
    f"{REPO}/.gitattributes",
    f"{REPO}/docker/app-entrypoint.sh",
    f"{REPO}/docker/peripherals/entrypoint.sh",
    f"{REPO}/docker/peripherals/healthcheck.sh",
    f"{REPO}/docker/peripherals/openbao-init.sh",
    f"{REPO}/docker/peripherals/wait-and-init-openbao.sh",
    f"{REPO}/README.md",
    f"{REPO}/docs/design/seed/scripts/patch_lf_endings_release.py",
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    ship_relations_api(data)

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="ARCH-DEVENV-COMPOSE",
            kind="capability",
            title="Git LF line endings for Compose entrypoints",
        ),
    )
    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid=CAP,
            base_uid=CAP,
            version_n=0,
            status="draft",
            statement=STMT,
            priority=10,
            iteration="iter-r1",
            security={
                "catalog_ref": "CM-2",
                "verification_note": "Planned until .gitattributes + dev docs PR merges; verify docker compose up on Windows checkout.",
            },
            statement_hash=statement_hash(STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-lf-endings",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for Git LF / Docker entrypoint line-ending PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP]
    for to in ("ARCH-DEVENV-CLONE", "ARCH-DEVENV-COMPOSE.1", "ARCH-DEPLOY-MINIMAL", "ARCH-DEPLOY-PERIPHERALS"):
        ensure_edge(data["edges"], {"from": CAP, "to": to, "kind": "satisfies"})
    ensure_edge(
        data["edges"],
        {"from": CAP, "to": "CM-2", "kind": "conforms_to", "catalog_imprint_id": NIST},
    )

    arts = data.setdefault("capability_artifacts", [])
    data["capability_artifacts"] = [a for a in arts if a.get("requirement_version_uid") != CAP]
    for uri in ARTIFACTS:
        data["capability_artifacts"].append({"requirement_version_uid": CAP, "kind": "other", "uri": uri})

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=REL,
            project_id="reqalm",
            name="R1 — Git LF line endings (Compose entrypoints)",
            planned_on=PLANNED,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes="Root .gitattributes + Windows checkout re-normalize docs; fixes bash\\r in Docker on Windows.",
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(f"Patched dogfood.yaml: shipped {REL_RELATIONS}, {REL} / {CAP}")


if __name__ == "__main__":
    main()
