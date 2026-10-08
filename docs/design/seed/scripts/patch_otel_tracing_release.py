#!/usr/bin/env python3
"""Ship rel-r1-service-foundation and add rel-r1-otel-tracing (this PR).

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
MERGE_SERVICE_FOUNDATION = "8f06a5887df8825eddbc5e04cc698248cde539d4"

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


SVC_CAPS = [
    "CAP-SVC-RESULT-ENVELOPE",
    "CAP-SVC-REQUEST-CONTEXT",
    "CAP-SVC-OPERATION-EXECUTOR",
    "CAP-SVC-AUDIT-APPEND",
    "CAP-SVC-STRUCTURED-LOG",
    "CAP-SVC-ROUTE-REGISTRY",
    "CAP-SVC-MODULE-BOOTSTRAP",
    "CAP-SVC-PROJECT-READ",
]

OTEL_CAPS = [
    (
        "CAP-OTEL-SDK-BOOTSTRAP",
        "OpenTelemetry SDK bootstrap (HTTP, Fastify, pg, undici)",
        "Register hook (sdk-trace-node tracer provider, OTLP/HTTP trace exporter only) loads before app modules; "
        "off by default with no SDK loaded; http, Fastify, pg and undici instrumentation shared with tests.",
        ["ARCH-OTEL-TRACE"],
        [
            f"{REPO}/apps/reqalm/src/telemetry/register.ts",
            f"{REPO}/apps/reqalm/src/telemetry/otel-env.ts",
            f"{REPO}/apps/reqalm/src/telemetry/instrumentations.ts",
            f"{REPO}/apps/reqalm/src/telemetry/tracing.ts",
        ],
    ),
    (
        "CAP-OTEL-W3C-CONTEXT",
        "W3C trace context and validated request id",
        "Continues traceparent; x-request-id validated (printable, ≤128) else UUID; trace_id on RequestContext and logs.",
        ["ARCH-OTEL-TRACE"],
        [
            f"{REPO}/apps/reqalm/src/telemetry/request-id.ts",
            f"{REPO}/apps/reqalm/src/core/request-context.ts",
        ],
    ),
    (
        "CAP-OTEL-OPERATION-SPANS",
        "Manual operation spans (runOperation)",
        "Operation span with RBAC/outcome attributes; error status on deny/error; no secrets in attributes.",
        ["ARCH-OTEL-TRACE"],
        [f"{REPO}/apps/reqalm/src/core/operation.ts"],
    ),
    (
        "CAP-OTEL-KEY-DEP",
        "OpenBao dependency spans (KeyProvider)",
        "KeyProvider calls emit key.* spans (dependency and purpose only; no key material or tokens) without "
        "changing the KeyProvider interface; the OpenBao HTTP calls are their undici-instrumented child spans.",
        ["ARCH-OTEL-TRACE"],
        [f"{REPO}/apps/reqalm/src/key/provider.ts", f"{REPO}/apps/reqalm/src/telemetry/key-provider-tracing.ts"],
    ),
    (
        "CAP-OTEL-AUDIT-TRACE",
        "Audit trace_id correlation",
        "Migration 007 adds audit_events.trace_id; runOperation writes trace_id on append-only audit rows.",
        ["ARCH-OTEL-TRACE"],
        [
            f"{REPO}/apps/reqalm/src/db/migrations/007_audit_trace_id.sql",
            f"{REPO}/apps/reqalm/src/audit/business-audit.ts",
        ],
    ),
    (
        "CAP-OTEL-EXPORT",
        "OTLP trace export (opt-in)",
        "OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_SERVICE_NAME; documented local collector binding.",
        ["ARCH-OTEL-TRACE"],
        [f"{REPO}/README.md"],
    ),
    (
        "CAP-OTEL-TEST-HARNESS",
        "In-process tracing tests (real pg + PGlite socket)",
        "otel-preload starts the test SDK with the production instrumentation list before pg is imported; "
        "real pg Pool over PGLiteSocketServer; in-memory exporter assertions.",
        ["ARCH-OTEL-TRACE"],
        [
            f"{REPO}/apps/reqalm/src/test/otel-preload.ts",
            f"{REPO}/apps/reqalm/src/test/otel-testing.ts",
            f"{REPO}/apps/reqalm/src/test/pglite-pool.ts",
            f"{REPO}/apps/reqalm/src/telemetry/otel-tracing.test.ts",
        ],
    ),
]


def main() -> None:
    with DOGFOOD.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    rel_sf = find(data.get("releases"), "id", "rel-r1-service-foundation")
    if rel_sf:
        rel_sf["status"] = "shipped"
        rel_sf["shipped_on"] = "2026-10-07"
        rel_sf["notes"] = (
            f"One PR = one release. https://github.com/danrabydev/sdoc-intake/pull/17 merged to main as "
            f"{MERGE_SERVICE_FOUNDATION} on 2026-10-07. Verified: in-process tests + typecheck + build."
        )
    for cap in SVC_CAPS:
        ver = find(data.get("requirement_versions"), "uid", cap)
        if ver and ver.get("status") == "draft":
            ver["status"] = "active"
            ver["verification_outcome"] = "pass"

    arch_stmt = (
        "Distributed tracing spans the HTTP route, service operation (runOperation), and dependencies "
        "(PostgreSQL via pg auto-instrumentation, OpenBao/undici fetch). W3C traceparent is continued on ingress. "
        "Structured logs and append-only audit_events carry trace_id for correlation. Span attributes never include "
        "secrets, tokens, or password material."
    )
    upsert(
        data.setdefault("requirement_lines", []),
        "base_uid",
        cm(
            base_uid="ARCH-OTEL-TRACE",
            project_id="reqalm",
            parent="SEC-API",
            kind="requirement",
            title="Distributed tracing (W3C, operation + dependency spans)",
        ),
    )
    upsert(
        data.setdefault("requirement_versions", []),
        "uid",
        cm(
            uid="ARCH-OTEL-TRACE",
            base_uid="ARCH-OTEL-TRACE",
            version_n=0,
            status="draft",
            statement=arch_stmt,
            priority=22,
            iteration="iter-r1",
            security={
                "catalog_ref": "AU-3",
                "verification_note": "Trace/log/audit correlation; OTLP traces export (not ARCH-OTEL audit-event export).",
            },
            statement_hash=statement_hash(arch_stmt),
            grooming_state="detailed",
        ),
    )
    ensure_edge(
        data.setdefault("edges", []),
        {"from": "ARCH-OTEL-TRACE", "to": "ARCH-OTEL", "kind": "uses"},
    )

    deliver_uids = []
    edges = data.setdefault("edges", [])
    arts = data.setdefault("capability_artifacts", [])

    for cap_uid, title, stmt, satisfies, artifact_paths in OTEL_CAPS:
        base = cap_uid.replace("CAP-", "").lower().replace("_", "-")
        upsert(
            data.setdefault("requirement_lines", []),
            "base_uid",
            cm(base_uid=cap_uid, project_id="reqalm", parent="SEC-API", kind="capability", title=title),
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
                security={"catalog_ref": "CM-2", "verification_note": "Planned until OTel tracing PR merges."},
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
                notes="Planned for OTel tracing PR; approve once merged and verified.",
                approved_version_uid=None,
                approved_statement_hash=None,
            ),
        )
        for to in satisfies:
            ensure_edge(edges, {"from": cap_uid, "to": to, "kind": "satisfies"})
        for uri in artifact_paths:
            if not any(a.get("requirement_version_uid") == cap_uid and a.get("uri") == uri for a in arts):
                arts.append({"requirement_version_uid": cap_uid, "kind": "other", "uri": uri})
        deliver_uids.append(cap_uid)

    upsert(
        data.setdefault("releases", []),
        "id",
        cm(
            id="rel-r1-otel-tracing",
            project_id="reqalm",
            name="R1 — OpenTelemetry tracing (W3C, operation + dependency spans)",
            planned_on="2026-10-07",
            shipped_on=None,
            status="planned",
            delivers=deliver_uids,
            cyber_gate=False,
            notes=(
                "One PR = one release. OTLP trace export (opt-in), W3C traceparent, operation spans, pg + undici "
                "auto-instrumentation, OpenBao dependency spans, audit_events.trace_id. Does not claim full ARCH-OTEL "
                "OTLP export of security audit events (traces only). Planned until merged; the next PR marks it shipped "
                "at the merge sha (same pattern as rel-r1-service-foundation)."
            ),
        ),
    )

    with DOGFOOD.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)

    print("Patched dogfood.yaml: shipped rel-r1-service-foundation, added ARCH-OTEL-TRACE + rel-r1-otel-tracing")


if __name__ == "__main__":
    main()
