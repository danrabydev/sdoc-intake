#!/usr/bin/env python3
"""Ship rel-r1-mfa-qr (PR #30); add rel-r1-relations-api / CAP-RELATIONS-API. Idempotent."""
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
MFA_QR_MERGE = "c8668b924ba4804e32f4d364aa0d343af60e9f83"
CAP_MFA_QR = "CAP-MFA-QR"
REL_MFA_QR = "rel-r1-mfa-qr"
CAP = "CAP-RELATIONS-API"
REL = "rel-r1-relations-api"

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


def ship_mfa_qr_release(data) -> None:
    rel = find(data.get("releases"), "id", REL_MFA_QR)
    if rel:
        rel["status"] = "shipped"
        rel["shipped_on"] = SHIPPED_DATE
        rel["notes"] = (
            f"PR #30 merged to main as {MFA_QR_MERGE} on {SHIPPED_DATE}. "
            "MFA enrollment QR on sign-in card (client-side otpauth QR + setup key fallback)."
        )
    ver = find(data.get("requirement_versions"), "uid", CAP_MFA_QR)
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "IA-2")
        ver["status"] = "active"
        ver["verification_outcome"] = "pass"
        ver["security"] = {
            "catalog_ref": catalog_ref,
            "verification_note": f"Shipped with MFA enrollment QR PR #30 (merge {MFA_QR_MERGE}).",
        }


STMT = (
    "Grant-scoped read-only relations API: GET /api/v1/projects/:projectId/requirements/:id/relations "
    "returns incoming and outgoing trace links grouped by kind (conforms_to, uses, satisfies, refines). "
    "Each link resolves the peer end with id, title, kind, and type for in-project lines and readable "
    "catalog controls without N+1 calls; cross-project and unreadable catalog peers return a non-revealing "
    "restricted stub. Dogfood seed loader persists trace_edges plus catalog imprint labels for ConformsTo pins."
)
ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/db/migrations/009_trace_edges.sql",
    f"{REPO}/apps/reqalm/src/seed/load-dogfood.ts",
    f"{REPO}/apps/reqalm/src/seed/catalog-labels.ts",
    f"{REPO}/apps/reqalm/src/modules/requirements/requirements-relations.ts",
    f"{REPO}/apps/reqalm/openapi/openapi.yaml",
    f"{REPO}/docs/design/seed/scripts/patch_relations_api_release.py",
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    ship_mfa_qr_release(data)

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-EDGE",
            kind="capability",
            title="Read requirement relations (trace links API)",
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
            security={"catalog_ref": "AC-3", "verification_note": "Planned until relations read API PR merges."},
            statement_hash=statement_hash(STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-relations-api",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for requirement relations read API PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP]
    for to in ("C08", "E06", "ARCH-API-RBAC", "CAP-READ-REQS", "CAP-SVC-OPERATION-ROUTE"):
        ensure_edge(data["edges"], {"from": CAP, "to": to, "kind": "satisfies"})
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
            name="R1 — requirement relations read API",
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP],
            cyber_gate=False,
            notes="Read-only relations endpoint + trace_edges seed load; browse UI graph deferred.",
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print("Patched dogfood.yaml: shipped rel-r1-mfa-qr, rel-r1-relations-api / CAP-RELATIONS-API")


if __name__ == "__main__":
    main()
