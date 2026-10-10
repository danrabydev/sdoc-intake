#!/usr/bin/env python3
"""Seed-only ReqALM honesty pass @ main 341330f: capability statuses/wording vs apps/reqalm/src.

Idempotent. Does not touch application code. Run:
  python3 patch_reqalm_honesty_seed.py && python3 yaml_to_strictdoc.py --validate
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

_SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPTS))
from seed_baseline_edges import (  # noqa: E402
    validate_baseline_edges_preserved,
    validate_baseline_records_preserved,
)

SEED = _SCRIPTS.parent
DOGFOOD = SEED / "dogfood.yaml"
REPO = "../../.."
EVIDENCE_MAIN = "341330fc8d43f2144193f1008503eacb7cfea903"
SHIPPED_DATE = "2026-10-10"
REL = "rel-r1-reqalm-honesty-seed"
CAP = "CAP-REQALM-HONESTY"

# Rows this patch may change vs baseline @ EVIDENCE_MAIN (Dan versioning + release notes only).
BASELINE_RECORD_ALLOW_VERSIONS = frozenset(
    {
        "CAP-SSO",
        "CAP-SSO.1",
        "CAP-SCOPED-VIEW",
        "CAP-SCOPED-VIEW.1",
        "CAP-RBAC",
        "CAP-RBAC.1",
        "ARCH-API-RBAC",
        "ARCH-API-RBAC.1",
        "CAP-UI-FRAME",
        "CAP-UI-FRAME.1",
        "CAP-UI-FRAME.2",
        "CAP-BROWSE-UI-CP",
        "CAP-BROWSE-UI-CP.1",
        "CAP-BROWSE-UI-CP.2",
        CAP,
    }
)
BASELINE_RECORD_ALLOW_RELEASES = frozenset({REL, "rel-r0-sequences"})

EXPECTED_LINES = 462
EXPECTED_VERSIONS = 496
EXPECTED_EDGES = 1966

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
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


def upsert_version(data, item) -> None:
    stmt = item.get("statement")
    if stmt and "statement_hash" not in item:
        item = dict(item)
        item["statement_hash"] = statement_hash(stmt)
    cur = find(data.get("requirement_versions"), "uid", item["uid"])
    if cur is None:
        data.setdefault("requirement_versions", []).append(deepcopy(item))
        return
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v


def upsert(seq, key, item):
    cur = find(seq, key, item[key])
    if cur is None:
        seq.append(deepcopy(item))
        return
    for k, v in item.items():
        cur[k] = deepcopy(v) if isinstance(v, (dict, list)) else v


def edge_key(edge):
    return (
        edge.get("from"),
        edge.get("to"),
        edge.get("kind"),
        edge.get("catalog_imprint_id"),
    )


def ensure_edge(edges, edge):
    for e in edges:
        if edge_key(e) == edge_key(edge):
            for k, v in edge.items():
                e[k] = deepcopy(v) if isinstance(v, (dict, list)) else v
            return 0
    edges.append(deepcopy(edge))
    return 1


def mint_content_n(
    data,
    base_uid: str,
    v0_statement: str,
    v0_hash: str,
    v1_statement: str,
    v1_verification_note: str,
    *,
    v1_verification_outcome: str | None = "pass",
    copy_edge_kinds: tuple[str, ...] = ("satisfies", "conforms_to"),
) -> None:
    tip = f"{base_uid}.1"
    existing_tip = find(data.get("requirement_versions"), "uid", tip)
    if existing_tip and existing_tip.get("status") == "active":
        existing_tip.setdefault("security", {})["verification_note"] = v1_verification_note
        if v1_verification_outcome is not None:
            existing_tip["verification_outcome"] = v1_verification_outcome
        elif "verification_outcome" in existing_tip:
            existing_tip.pop("verification_outcome")
        return
    v0 = find(data.get("requirement_versions"), "uid", base_uid)
    if not v0:
        return
    v0["statement"] = v0_statement
    v0["statement_hash"] = v0_hash
    v0["status"] = "superseded"
    tip = f"{base_uid}.1"
    ver = cm(
        uid=tip,
        base_uid=base_uid,
        version_n=1,
        status="active",
        statement=v1_statement,
        priority=v0.get("priority", 10),
        iteration=v0.get("iteration", "iter-r1"),
        security={
            "catalog_ref": (v0.get("security") or {}).get("catalog_ref", "AC-3"),
            "verification_note": v1_verification_note,
        },
        statement_hash=statement_hash(v1_statement),
        grooming_state="detailed",
        mint_kind="content",
    )
    if v1_verification_outcome is not None:
        ver["verification_outcome"] = v1_verification_outcome
    elif "verification_outcome" in ver:
        ver.pop("verification_outcome", None)
    if v0.get("rbac_op"):
        ver["rbac_op"] = v0["rbac_op"]
    upsert_version(data, ver)
    edges = data.setdefault("edges", [])
    ensure_edge(edges, {"from": tip, "to": base_uid, "kind": "refines"})
    for e in list(edges):
        if e.get("from") != base_uid or e.get("kind") not in copy_edge_kinds:
            continue
        copied = {k: v for k, v in e.items() if k in ("to", "kind", "catalog_imprint_id")}
        copied["from"] = tip
        ensure_edge(edges, copied)
    suspect_reason = f"target line content-succeeded; edge still on superseded .0 ({base_uid})"
    for e in edges:
        if e.get("to") != base_uid:
            continue
        if e.get("from") == tip and e.get("kind") == "refines":
            continue
        if not e.get("trace_suspect"):
            e["trace_suspect"] = True
            e["suspect_reason"] = suspect_reason


def mint_content_successor(
    data,
    tip_uid: str,
    new_statement: str,
    *,
    verification_note: str | None = None,
    verification_outcome: str | None = None,
    copy_kinds: tuple[str, ...] = ("satisfies", "conforms_to", "uses"),
) -> str:
    tip = find(data.get("requirement_versions"), "uid", tip_uid)
    if not tip:
        raise KeyError(f"missing version {tip_uid}")
    base_uid = tip["base_uid"]
    new_n = int(tip.get("version_n", 0)) + 1
    new_uid = f"{base_uid}.{new_n}"
    new_hash = statement_hash(new_statement)
    existing = find(data.get("requirement_versions"), "uid", new_uid)
    if (
        existing
        and existing.get("statement") == new_statement
        and existing.get("status") == "active"
        and tip.get("status") == "superseded"
    ):
        if verification_outcome is not None and existing.get("verification_outcome") != verification_outcome:
            existing["verification_outcome"] = verification_outcome
        return new_uid

    tip["status"] = "superseded"
    sec = deepcopy(tip.get("security") or {"catalog_ref": "CM-2"})
    if verification_note:
        sec["verification_note"] = verification_note
    ver = cm(
        uid=new_uid,
        base_uid=base_uid,
        version_n=new_n,
        status="active",
        statement=new_statement,
        priority=tip.get("priority", 10),
        iteration=tip.get("iteration", "iter-r1"),
        security=sec,
        statement_hash=new_hash,
        grooming_state=tip.get("grooming_state", "detailed"),
        mint_kind="content",
    )
    if verification_outcome is not None:
        ver["verification_outcome"] = verification_outcome
    elif tip.get("verification_outcome"):
        ver["verification_outcome"] = tip["verification_outcome"]
    upsert_version(data, ver)
    edges = data.setdefault("edges", [])
    ensure_edge(edges, {"from": new_uid, "to": tip_uid, "kind": "refines"})
    for e in list(edges):
        if e.get("from") != tip_uid or e.get("kind") not in copy_kinds:
            continue
        copied = {
            k: v
            for k, v in e.items()
            if k in ("to", "kind", "catalog_imprint_id", "inheritable", "trace_suspect", "suspect_reason")
        }
        copied["from"] = new_uid
        ensure_edge(edges, copied)
    return new_uid


R0_NOTE_SUFFIX = (
    "Delivered CAP-* packs here are R0 design/sequence artifacts (diagrams), not runtime verification — "
    "see CAP-SSO / CAP-SCOPED-VIEW honesty."
)

CAP_RBAC_V0_STMT = (
    "API routes enforce project-grant derived permissions (CAP-RBAC matrix subset). "
    "`POST /api/v1/projects/:projectId/grants` requires `grant:manage`; Readers receive 403 with audit. "
    "MCP `/mcp` requires MCP-audience tokens. Acceptance: auth-flow-smoke RBAC deny for casey-reader."
)
CAP_RBAC_V0_HASH = "sha256:07904dc523cccd3c24e8ab49deca0a2aa3cbaaf2882a8d8028c24eaf737ea60b"
CAP_RBAC_V1_STMT = (
    "Capability pack for API RBAC enforcement (subset of the full permission matrix). Shipped foundation "
    "covers OAuth routes, defineOperationRoute business reads, and auth-flow-smoke beds — not every ARCH-API-RBAC "
    "mutating operation. MCP and grant-management mutators remain planned in core-ALM."
)
CAP_UI_FRAME_V0_STMT = (
    "The Web UI frame served by the web role: top navigation, client-scoped sidebar chrome, and route guards that "
    "send unauthenticated users to the internal-AS sign-in flow and keep `/app/*` behind a valid API-audience session "
    "via HttpOnly SameSite=Lax cookies (BFF) with CSRF on sign-out; API clients use bearer tokens. Sign-out revokes "
    "refresh tokens via RFC 7009. Acceptance: unauthenticated `/app` redirects to login; authenticated shell renders "
    "`/api/v1/me` grants."
)
CAP_UI_FRAME_V0_HASH = "sha256:0828332feb654b6ef8c411828750b14e293b41e4400377cb3abf3d6c18aefde6"
CAP_UI_FRAME_V1_STMT = (
    "Web UI frame: navigation, client-scoped sidebar chrome, and route guards for /app/* via BFF session cookies "
    "and CSRF on cookie mutations. Partial: shell and sign-in work; not every ARCH-UI surface is implemented."
)
CAP_SSO_V0_STMT = (
    "Capability pack for federated SSO session establishment and teardown against the enterprise IdP.\n"
    "Covers sign-in and sign-out paths used by UI and MCP hosts. No local passwords; MFA and authenticator\n"
    "policy live at the IdP (NIST IA-2/IA-5, V-222536/542)."
)
CAP_SSO_V0_HASH = "sha256:090fad7f2a28d03f0eb0ea1684631e535ac2df550dc81596a7f1abb3cc271cb4"
CAP_SSO_V1_STMT = (
    "Capability pack for enterprise federated SSO session establishment and teardown (ARCH-AUTH-FEDERATION). "
    "R0 delivered sequence diagrams and requirements only; runtime today uses the internal OAuth AS with dev "
    "local accounts (ARCH-DEVENV-IDENTITY.1), not upstream IdP federation. MFA for production remains at the "
    "enterprise IdP when federation ships."
)
CAP_SCOPED_V0_STMT = (
    "Capability pack for selecting, clearing, and binding Client Scoped View on the server session.\n"
    "UI App providers consume the bound clientId for navigation guards. Scope change and clear are audited;\n"
    "server rejects cross-client resource access even if the client id appears in a forged request."
)
CAP_SCOPED_V0_HASH = "sha256:6d9d653098304d18fc6d61cd24753e12655075be1d43e5b64f6b6ae74150fe6c"
CAP_SCOPED_V1_STMT = (
    "Capability pack for Client Scoped View: select, clear, and bind clientId on the server session. "
    "Partial R1: grant-scoped browse APIs enforce project/client visibility; full A03/A04 UX and MCP parity "
    "remain in core-ALM. Scope changes shall be audited when mutating routes exist."
)
ARCH_API_RBAC_V0_STMT = (
    "Every mutating business operation checks project_grant (and steward grants where applicable) before\n"
    "writes. Denied calls return a consistent unauthorized/forbidden outcome and emit an audit event."
)
ARCH_API_RBAC_V0_HASH = "sha256:319f1dad1c8772a1cc5be6cc71b9a52630fd21601c5bac288a1b4b33eee3e8be"
ARCH_API_RBAC_V1_STMT = (
    "Every mutating business operation shall check project_grant (and steward grants where applicable) before "
    "writes. Denied calls return a consistent unauthorized/forbidden outcome and emit an audit event. "
    "CAP-RBAC documents the currently verified enforcement subset; this architecture requirement remains "
    "active until all mutators in scope ship."
)

CAP_BROWSE_UI_CP_V2_STMT = (
    "Read-only /app browse screens for grant-scoped clients and projects: paged clients list, client detail "
    "with projects, all-projects list with client name, and a project landing page linking into Requirements "
    "(list and tree), Releases, and Catalogs browse routes (no longer stubbed as coming next). Uses existing "
    "session/CSRF auth; API data rendered via safe DOM text only. Layout: Clients entry lists grant-scoped "
    "clients; row opens client detail with projects table; All projects lists cross-client projects with client "
    "name; project page shows navigation links into shipped browse surfaces. Header uses global Clients/Projects "
    "nav outside project tabs."
)


def restore_shipped_release_delivers(data) -> None:
    replacements = {
        "rel-r0-sequences": {
            "CAP-RBAC.1": "CAP-RBAC",
            "CAP-SSO.1": "CAP-SSO",
            "CAP-SCOPED-VIEW.1": "CAP-SCOPED-VIEW",
        },
        "rel-r1-foundation-shell-auth": {
            "CAP-RBAC.1": "CAP-RBAC",
            "CAP-UI-FRAME.1": "CAP-UI-FRAME",
            "CAP-UI-FRAME.2": "CAP-UI-FRAME",
            "ARCH-API-RBAC.1": "ARCH-API-RBAC",
        },
        "rel-r1-browse-ui-cp": {
            "CAP-BROWSE-UI-CP.1": "CAP-BROWSE-UI-CP",
            "CAP-BROWSE-UI-CP.2": "CAP-BROWSE-UI-CP",
        },
    }
    for rel_id, mapping in replacements.items():
        rel = find(data.get("releases"), "id", rel_id)
        if not rel:
            continue
        rel["delivers"] = [mapping.get(d, d) for d in (rel.get("delivers") or [])]


def ensure_r0_sequences_note(data) -> None:
    rel = find(data.get("releases"), "id", "rel-r0-sequences")
    if not rel:
        return
    notes = (rel.get("notes") or "").strip()
    if R0_NOTE_SUFFIX in notes:
        return
    rel["notes"] = f"{notes} {R0_NOTE_SUFFIX}".strip() if notes else R0_NOTE_SUFFIX


def retarget_edge(edges, *, frm: str, old_to: str, new_to: str, kind: str) -> None:
    edges[:] = [e for e in edges if not (e.get("from") == frm and e.get("to") == old_to and e.get("kind") == kind)]
    for e in edges:
        if e.get("from") == frm and e.get("to") == new_to and e.get("kind") == kind:
            e.pop("trace_suspect", None)
            e.pop("suspect_reason", None)
            return
    ensure_edge(edges, {"from": frm, "to": new_to, "kind": kind})


def fix_honesty_edge_targets(data) -> None:
    edges = data.setdefault("edges", [])
    retarget_edge(
        edges,
        frm="CAP-RBAC.1",
        old_to="ARCH-API-RBAC",
        new_to="ARCH-API-RBAC.1",
        kind="satisfies",
    )


def set_partial_pending(uid: str, note: str) -> None:
    ver = find(data.get("requirement_versions"), "uid", uid)
    if not ver:
        return
    ver["verification_outcome"] = "pending"
    ver.setdefault("security", {})["verification_note"] = note


def apply_honesty_mints(data) -> None:
    mint_content_n(
        data,
        "CAP-SSO",
        CAP_SSO_V0_STMT,
        CAP_SSO_V0_HASH,
        CAP_SSO_V1_STMT,
        "R0 design pack; federation not shipped — do not mark pass until ARCH-AUTH-FEDERATION delivers.",
        v1_verification_outcome=None,
    )
    mint_content_n(
        data,
        "CAP-SCOPED-VIEW",
        CAP_SCOPED_V0_STMT,
        CAP_SCOPED_V0_HASH,
        CAP_SCOPED_V1_STMT,
        "Partial: browse read scope shipped; full scoped-view mutate UX not complete.",
        v1_verification_outcome="pending",
    )
    mint_content_n(
        data,
        "CAP-RBAC",
        CAP_RBAC_V0_STMT,
        CAP_RBAC_V0_HASH,
        CAP_RBAC_V1_STMT,
        "Partial: foundation OAuth + defineOperationRoute read routes verified on PR #13/#17–#24; "
        "grant mutators and full matrix deferred to core-ALM.",
        v1_verification_outcome="pending",
    )
    mint_content_n(
        data,
        "ARCH-API-RBAC",
        ARCH_API_RBAC_V0_STMT,
        ARCH_API_RBAC_V0_HASH,
        ARCH_API_RBAC_V1_STMT,
        "Maps to ReqALM RBAC catalog item; .1 narrows honesty vs CAP-RBAC enforcement subset.",
        v1_verification_outcome=None,
    )
    frame2 = find(data.get("requirement_versions"), "uid", "CAP-UI-FRAME.2")
    if frame2 and frame2.get("status") == "active":
        set_partial_pending(
            "CAP-UI-FRAME.2",
            "Partial: header-only built shell per CAP-UI-FRAME.2; verification pending until full ARCH-UI surfaces ship.",
        )
    else:
        mint_content_n(
            data,
            "CAP-UI-FRAME",
            CAP_UI_FRAME_V0_STMT,
            CAP_UI_FRAME_V0_HASH,
            CAP_UI_FRAME_V1_STMT,
            "Partial: shell + guards verified on PR #13; full UI catalog still planned.",
            v1_verification_outcome="pending",
        )
    fix_honesty_edge_targets(data)

    mint_content_successor(
        data,
        "CAP-BROWSE-UI-CP.1",
        CAP_BROWSE_UI_CP_V2_STMT,
        verification_note="Honesty mint .2 @ main 341330f: project page links to shipped reqs/releases/catalogs browse.",
        verification_outcome="pass",
    )


def add_honesty_release(data) -> None:
    stmt = (
        "Documentation-only seed pass aligning CAP-SSO, CAP-SCOPED-VIEW, CAP-RBAC, CAP-UI-FRAME, ARCH-API-RBAC, "
        "R0 release notes, and browse-clients/projects UI wording with runtime on main @ 341330f (apps/reqalm/src). "
        "No application code changes."
    )
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid=CAP,
            project_id="reqalm",
            parent="SEC-GROOM",
            kind="capability",
            title="ReqALM seed honesty (capability status vs code)",
        ),
    )
    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid=CAP,
            base_uid=CAP,
            version_n=0,
            status="active",
            statement=stmt,
            priority=10,
            iteration="iter-r1",
            security={
                "catalog_ref": "CM-2",
                "verification_note": f"Shipped seed honesty PR documenting main @ {EVIDENCE_MAIN}.",
            },
            statement_hash=statement_hash(stmt),
            grooming_state="detailed",
            verification_outcome="pass",
        ),
    )
    upsert(
        data.setdefault("approval_records", []),
        "id",
        cm(
            id="ar-reqalm-honesty",
            subject_kind="CapabilityLine",
            base_uid=CAP,
            status="unapproved",
            by=None,
            at=None,
            notes=f"Seed-only honesty @ {EVIDENCE_MAIN[:12]}.",
            approved_version_uid=None,
            approved_statement_hash=None,
        ),
    )
    for uri in (
        f"{REPO}/docs/design/seed/dogfood.yaml",
        f"{REPO}/docs/design/seed/scripts/patch_reqalm_honesty_seed.py",
        f"{REPO}/docs/design/HANDOFF.md",
    ):
        arts = data.setdefault("capability_artifacts", [])
        if not any(a.get("requirement_version_uid") == CAP and a.get("uri") == uri for a in arts):
            arts.append({"requirement_version_uid": CAP, "kind": "other", "uri": uri})
    ensure_edge(data.setdefault("edges", []), {"from": CAP, "to": "K03", "kind": "satisfies"})
    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id=REL,
            project_id="reqalm",
            name="R1 — ReqALM seed honesty",
            planned_on=SHIPPED_DATE,
            shipped_on=SHIPPED_DATE,
            status="shipped",
            delivers=[CAP],
            cyber_gate=False,
            notes=(
                f"Seed-only honesty PR verified against application code on main @ {EVIDENCE_MAIN} "
                f"({SHIPPED_DATE}). Idempotent patch: patch_reqalm_honesty_seed.py."
            ),
        ),
    )


def apply_patch(data) -> None:
    apply_honesty_mints(data)
    ensure_r0_sequences_note(data)
    restore_shipped_release_delivers(data)
    ar_cp = find(data.get("approval_records"), "id", "ar-browse-ui-cp")
    if ar_cp and "Planned for browse UI PR" in (ar_cp.get("notes") or ""):
        ar_cp["notes"] = "Shipped with browse UI PR #23 (merge b5c7b5e9efd48de95e5e0ca5a71e23cb0a640f4a)."
    add_honesty_release(data)
    validate_baseline_records_preserved(
        data,
        allow_version_uids=BASELINE_RECORD_ALLOW_VERSIONS,
        allow_release_ids=BASELINE_RECORD_ALLOW_RELEASES,
    )
    validate_baseline_edges_preserved(data)


def main() -> None:
    global data
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--validate-baseline-edges",
        action="store_true",
        help="Load dogfood.yaml and verify baseline outbound edges preserved (no write)",
    )
    args = parser.parse_args()

    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    if args.validate_baseline_edges:
        validate_baseline_edges_preserved(data)
        print("baseline edge preservation ok")
        return

    apply_patch(data)

    lines = len(data.get("requirement_lines") or [])
    vers = len(data.get("requirement_versions") or [])
    edge_c = len(data.get("edges") or [])
    if (lines, vers, edge_c) != (EXPECTED_LINES, EXPECTED_VERSIONS, EXPECTED_EDGES):
        print(
            f"COUNT MISMATCH: lines={lines} (expected {EXPECTED_LINES}), "
            f"versions={vers} (expected {EXPECTED_VERSIONS}), edges={edge_c} (expected {EXPECTED_EDGES})",
            file=sys.stderr,
        )
        sys.exit(1)

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)
    print(
        f"Patched dogfood.yaml: honesty mints + {REL} / {CAP} @ {EVIDENCE_MAIN[:12]}, "
        f"lines={lines} versions={vers} edges={edge_c}"
    )


if __name__ == "__main__":
    main()
