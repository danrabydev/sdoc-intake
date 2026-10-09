#!/usr/bin/env python3
"""Ship rel-r1-lf-endings (PR #35); add rel-r1-browse-ui-relations / CAP-BROWSE-UI-RELATIONS. Idempotent."""
from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
SHIPPED_DATE = "2026-10-09"
LF_ENDINGS_MERGE = "80909c1e47a141780f054e506a73b6ad60946f3a"  # PR #35 merge sha (confirm before push)

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
    for e in edges:
        if (e.get("from"), e.get("to"), e.get("kind")) == (edge.get("from"), edge.get("to"), edge.get("kind")):
            return 0
    edges.append(edge)
    return 1


CAP_LF = "CAP-DEVENV-LF-ENDINGS"
REL_LF = "rel-r1-lf-endings"
LF_STMT = (
    "Repository line endings are enforced for the Compose dev stack: a root .gitattributes keeps shell entrypoints "
    "and Docker/Compose context files as LF in Git so Linux containers never see a bash\\r shebang when Windows "
    "Git checks out with core.autocrlf=true. Documented recovery re-normalizes an existing Windows working tree "
    "after pulling the fix."
)
LF_ARTIFACTS = [
    f"{REPO}/.gitattributes",
    f"{REPO}/docker/app-entrypoint.sh",
    f"{REPO}/docker/peripherals/entrypoint.sh",
    f"{REPO}/docker/peripherals/healthcheck.sh",
    f"{REPO}/docker/peripherals/openbao-init.sh",
    f"{REPO}/docker/peripherals/wait-and-init-openbao.sh",
    f"{REPO}/README.md",
    f"{REPO}/docs/design/seed/scripts/patch_lf_endings_release.py",
]

CAP_UI = "CAP-BROWSE-UI-RELATIONS"
UI_STMT = (
    "Read-only Relationships panel on the requirement detail browse screen: loads "
    "GET /api/v1/projects/:projectId/requirements/:id/relations and renders outgoing and incoming "
    "links grouped by kind. Requirement peers navigate to detail; catalog conforms_to peers show as "
    "non-navigating chips with imprint label; trace_suspect shows needs re-check; restricted peers "
    "show a muted stub with no peer id. Empty, loading, and error states included."
)
UI_ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/web/public/browse.js",
    f"{REPO}/apps/reqalm/src/web/public/browse-core.js",
    f"{REPO}/apps/reqalm/src/web/public/browse-dom.js",
    f"{REPO}/apps/reqalm/src/web/public/browse-relations.js",
    f"{REPO}/apps/reqalm/src/web/public/styles.css",
    f"{REPO}/apps/reqalm/src/web/browse-ui.test.ts",
    f"{REPO}/docs/design/seed/scripts/patch_browse_ui_relations_release.py",
]


def ship_lf_endings(data) -> None:
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP_LF,
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
            uid=CAP_LF,
            base_uid=CAP_LF,
            version_n=0,
            status="active",
            statement=LF_STMT,
            priority=10,
            iteration="iter-r1",
            security={
                "catalog_ref": "CM-2",
                "verification_note": f"Shipped with Git LF line endings PR #35 (merge {LF_ENDINGS_MERGE}).",
            },
            statement_hash=statement_hash(LF_STMT),
            grooming_state="detailed",
            verification_outcome="pass",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-lf-endings",
            subject_kind="CapabilityLine",
            base_uid=CAP_LF,
            status="unapproved",
            by=None,
            at=None,
            notes=f"LF endings shipped in PR #35 (merge {LF_ENDINGS_MERGE}); formal approval record not filed in seed.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP_LF]
    for to in ("ARCH-DEVENV-CLONE", "ARCH-DEVENV-COMPOSE", "ARCH-DEPLOY-MINIMAL", "ARCH-DEPLOY-PERIPHERALS"):
        ensure_edge(data["edges"], {"from": CAP_LF, "to": to, "kind": "satisfies"})
    arts = data.setdefault("capability_artifacts", [])
    data["capability_artifacts"] = [a for a in arts if a.get("requirement_version_uid") != CAP_LF]
    for uri in LF_ARTIFACTS:
        data["capability_artifacts"].append({"requirement_version_uid": CAP_LF, "kind": "other", "uri": uri})
    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=REL_LF,
            project_id="reqalm",
            name="R1 — Git LF line endings (Compose entrypoints)",
            planned_on=SHIPPED_DATE,
            shipped_on=SHIPPED_DATE,
            status="shipped",
            delivers=[CAP_LF],
            cyber_gate=False,
            notes=(
                f"PR #35 merged to main as {LF_ENDINGS_MERGE} on {SHIPPED_DATE}. "
                "Root .gitattributes + Windows checkout re-normalize docs; fixes bash\\r in Docker on Windows."
            ),
        ),
    )


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    ship_lf_endings(data)

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP_UI,
            project_id="reqalm",
            parent="SEC-CP",
            kind="capability",
            title="Browse requirement relationships UI (read-only)",
        ),
    )
    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid=CAP_UI,
            base_uid=CAP_UI,
            version_n=0,
            status="draft",
            statement=UI_STMT,
            priority=10,
            iteration="iter-r1",
            security={"catalog_ref": "CM-2", "verification_note": "Planned until relationships browse UI PR merges."},
            statement_hash=statement_hash(UI_STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-browse-ui-relations",
            subject_kind="CapabilityLine",
            base_uid=CAP_UI,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for relationships browse UI PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP_UI]
    for to in ("C08", "D06", "ARCH-UI", "ARCH-UI-GUARD", "CAP-RELATIONS-API", "CAP-BROWSE-UI-REQS"):
        ensure_edge(data["edges"], {"from": CAP_UI, "to": to, "kind": "satisfies"})
    arts = data.setdefault("capability_artifacts", [])
    data["capability_artifacts"] = [a for a in arts if a.get("requirement_version_uid") != CAP_UI]
    for uri in UI_ARTIFACTS:
        data["capability_artifacts"].append({"requirement_version_uid": CAP_UI, "kind": "other", "uri": uri})

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id="rel-r1-browse-ui-relations",
            project_id="reqalm",
            name="R1 — browse requirement relationships UI (read-only)",
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP_UI],
            cyber_gate=False,
            notes="Relationships panel on requirement detail; two-column graph view deferred.",
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(f"Patched dogfood.yaml: shipped {REL_LF}, rel-r1-browse-ui-relations / {CAP_UI}")


if __name__ == "__main__":
    main()
