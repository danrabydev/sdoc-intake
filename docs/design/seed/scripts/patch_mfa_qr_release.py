#!/usr/bin/env python3
"""Ship rel-r1-browse-ui-tree (PR #29); add rel-r1-mfa-qr / CAP-MFA-QR. Idempotent."""
from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
SHIPPED_DATE = "2026-10-08"
BROWSE_UI_TREE_MERGE = "ecf5d539cdcb7da35c9469b7e8e5794240de44f9"
CAP_TREE = "CAP-BROWSE-UI-TREE"
REL_TREE = "rel-r1-browse-ui-tree"
CAP_QR = "CAP-MFA-QR"
REL_QR = "rel-r1-mfa-qr"
CAP_MFA_ENROLL = "CAP-MFA-ENROLL"

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


def ship_release_preserve_notes(data, rel_id: str) -> int:
    rel = find(data.get("releases"), "id", rel_id)
    flips = 0
    if rel:
        if rel.get("status") != "shipped":
            flips += 1
        rel["status"] = "shipped"
        if not rel.get("shipped_on"):
            flips += 1
            rel["shipped_on"] = SHIPPED_DATE
    return flips


def activate_capability_preserve_catalog(data, uid: str, verification_note: str) -> int:
    ver = find(data.get("requirement_versions"), "uid", uid)
    flips = 0
    if ver:
        catalog_ref = (ver.get("security") or {}).get("catalog_ref", "CM-2")
        if ver.get("status") != "active":
            flips += 1
        ver["status"] = "active"
        if ver.get("verification_outcome") != "pass":
            flips += 1
        ver["verification_outcome"] = "pass"
        ver["security"] = {"catalog_ref": catalog_ref, "verification_note": verification_note}
    return flips


QR_STMT = (
    "MFA enrollment on the sign-in card renders a scannable QR code for the otpauth URI locally in the browser "
    "(vendored MIT qr-min matrix encoder to SVG; no external QR service or network fetch). Setup key and manual "
    "otpauth URI remain visible for copy/paste. Enrollment JSON responses use Cache-Control: no-store; QR markup is "
    "removed from the DOM after successful enrollment. Accessible name on the QR image; CSP-safe (same-origin module, "
    "DOM-built SVG, no inline handlers)."
)
QR_ARTIFACTS = [
    f"{REPO}/apps/reqalm/src/web/public/mfa-enroll-ui.js",
    f"{REPO}/apps/reqalm/src/web/public/vendor/qr-min.js",
    f"{REPO}/apps/reqalm/src/web/public/app.js",
    f"{REPO}/apps/reqalm/src/web/public/styles.css",
    f"{REPO}/apps/reqalm/src/web/mfa-enroll-ui.test.ts",
    f"{REPO}/apps/reqalm/src/auth/routes.ts",
    f"{REPO}/docs/design/seed/scripts/patch_mfa_qr_release.py",
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    flips = 0
    flips += ship_release_preserve_notes(data, REL_TREE)
    flips += activate_capability_preserve_catalog(
        data,
        CAP_TREE,
        f"Shipped with requirements tree browse UI PR #29 (merge {BROWSE_UI_TREE_MERGE}).",
    )

    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP_QR,
            project_id="reqalm",
            parent="SEC-IA",
            kind="capability",
            title="MFA enrollment QR code (sign-in UI)",
        ),
    )
    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid=CAP_QR,
            base_uid=CAP_QR,
            version_n=0,
            status="draft",
            statement=QR_STMT,
            priority=10,
            iteration="iter-r1",
            security={"catalog_ref": "IA-2", "verification_note": "Planned until MFA enrollment QR PR merges."},
            statement_hash=statement_hash(QR_STMT),
            grooming_state="detailed",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-mfa-qr",
            subject_kind="CapabilityLine",
            base_uid=CAP_QR,
            status="unapproved",
            by=None,
            at=None,
            notes="Planned for MFA enrollment QR PR.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    edges = data.setdefault("edges", [])
    data["edges"] = [e for e in edges if e.get("from") != CAP_QR]
    for to in (CAP_MFA_ENROLL, "ARCH-CRED-MFA", "ARCH-UI-GUARD"):
        ensure_edge(data["edges"], {"from": CAP_QR, "to": to, "kind": "satisfies"})
    arts = data.setdefault("capability_artifacts", [])
    data["capability_artifacts"] = [a for a in arts if a.get("requirement_version_uid") != CAP_QR]
    for uri in QR_ARTIFACTS:
        data["capability_artifacts"].append({"requirement_version_uid": CAP_QR, "kind": "other", "uri": uri})

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=REL_QR,
            project_id="reqalm",
            name="R1 — MFA enrollment QR (sign-in UI)",
            planned_on=SHIPPED_DATE,
            shipped_on=None,
            status="planned",
            delivers=[CAP_QR],
            cyber_gate=False,
            notes="Client-side QR for otpauth URI on MFA enrollment; setup key fallback retained.",
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    if flips:
        assert flips == 4, f"expected 4 capability/release flips on first run, got {flips}"
    print("Patched dogfood.yaml: shipped rel-r1-browse-ui-tree, rel-r1-mfa-qr / CAP-MFA-QR")


if __name__ == "__main__":
    main()
