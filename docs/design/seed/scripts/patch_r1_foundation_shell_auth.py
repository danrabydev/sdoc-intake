#!/usr/bin/env python3
"""R1 release: UI frame + internal auth (rel-r1-foundation-shell-auth).

Idempotent. Does NOT git commit. Run yaml_to_strictdoc.py --validate afterwards.

Usage:
  python3 patch_r1_foundation_shell_auth.py --pr-url 'https://github.com/.../pull/N'
"""
from __future__ import annotations

import argparse
import hashlib
from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
NIST = "nist-800-53@rev5-dogfood-20261006"
REPO = "../../.."
PR12_SHA = "67131da"
PR12_URL = "https://github.com/danrabydev/sdoc-intake/pull/12"

# Evidence: Dan verified Docker smoke through 44a727a; follow-up commits add devenv:init/MFA/agent/BFF hardening.
# Cloud agent re-runs unit/typecheck/build/seed --validate (no Docker in agent VM).
EVIDENCE = (
    "Dan local Docker 2026-10-07 through 44a727a + PR #13 follow-up: `pnpm devenv:init`, app bound 127.0.0.1, "
    "`pnpm devenv:smoke` (hostports overlay) incl. auth-flow-smoke (server-side OAuth handoffs, PKCE S256, "
    "privileged sam-security MFA, agent client_credentials, upstream connectors 401 without auth, refresh "
    "rotation/reuse family revoke, RFC7009 refresh+access revoke, invalid handoff refused, lockout + username "
    "normalize, Reader RBAC 403, wrong audience 401 at MCP), production refused dev accounts/keys; "
    "`@reqaml/app` test 22/22, typecheck and monorepo build pass; seed yaml_to_strictdoc --validate pass"
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
    for x in seq:
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


def cap_version(spec, *, status, verification_outcome, iteration, grooming):
    v = cm(
        uid=spec["uid"],
        base_uid=spec["uid"],
        version_n=0,
        status=status,
        statement=spec["statement"],
        priority=10,
        iteration=iteration,
        security={"catalog_ref": spec["security"][0], "verification_note": spec["security"][1]},
        statement_hash=statement_hash(spec["statement"]),
        grooming_state=grooming,
    )
    if verification_outcome:
        v["verification_outcome"] = verification_outcome
    return v


DELIVERED = [
    dict(
        uid="CAP-UI-FRAME",
        parent="SEC-UI",
        title="UI frame: app shell, layout, guarded routes",
        statement=(
            "The Web UI frame served by the web role: top navigation, client-scoped sidebar chrome, and route guards "
            "that send unauthenticated users to the internal-AS sign-in flow and keep `/app/*` behind a valid API-audience "
            "session via HttpOnly SameSite=Lax cookies (BFF) with CSRF on sign-out; API clients use bearer tokens. "
            "Sign-out revokes refresh tokens via RFC 7009. "
            "Acceptance: unauthenticated `/app` redirects to login; authenticated shell renders `/api/v1/me` grants."
        ),
        satisfies=["ARCH-UI", "ARCH-UI-GUARD"],
        security=("AC-3", f"AC-3 guard enforcement. Verified: {EVIDENCE}; headless Chrome: `/` and `/app` "
                  "redirect to sign-in, dev account casey-reader reaches `/app` at localhost:3000 and 127.0.0.1:3000."),
        artifacts=[
            ("other", "apps/reqaml/src/web/public/app.js"),
            ("other", "apps/reqaml/src/web/public/styles.css"),
        ],
    ),
    dict(
        uid="CAP-OAUTH-AS",
        parent="SEC-IA",
        title="Internal OAuth 2.1 authorization server",
        statement=(
            "ReqAML's internal OAuth 2.1 AS in the API role is the single token issuer for Web UI, API, and MCP: "
            "authorization code + PKCE S256 only, RFC 8414 AS metadata, RFC 9728 protected-resource metadata for API and MCP, "
            "RFC 8707 resource indicators with audience-bound access tokens, refresh-token rotation with reuse detection "
            "(family revocation), RFC 7009 revocation, pre-registered clients, dynamic client registration disabled by default. "
            "Acceptance: auth-flow-smoke covers AS01 beds (PKCE, refresh/reuse, revoke, wrong audience)."
        ),
        satisfies=[
            "ARCH-AUTH-AS", "ARCH-AUTH-PKCE", "ARCH-AUTH-METADATA", "ARCH-AUTH-AUDIENCE",
            "ARCH-AUTH-REFRESH", "ARCH-AUTH-REVOKE", "ARCH-AUTH-CLIENTREG",
            "ARCH-AUTH-MCP-REQUIRED", "ARCH-AUTH-PROFILE",
        ],
        security=("IA-2", f"IA-2 / SC-23 OAuth beds. Verified: {EVIDENCE}."),
        artifacts=[
            ("other", "apps/reqaml/src/auth/routes.ts"),
            ("other", "apps/reqaml/src/auth/oauth-service.ts"),
            ("other", "scripts/auth-flow-smoke.mjs"),
        ],
    ),
    dict(
        uid="CAP-CRED-STORE",
        parent="SEC-SEC",
        title="Credential store: Argon2id, lockout, MFA, hashed tokens",
        statement=(
            "Local credentials use Argon2id password hashes (legacy dev SHA-256 re-hashed on login), throttling/lockout "
            "after repeated failures, TOTP MFA for privileged roles (wrapped MFA secrets via KeyProvider), server-side "
            "refresh token hashes, and lockout audit events. "
            "Acceptance: auth-flow-smoke lockout bed; privileged MFA login (sam-security) after `pnpm devenv:mfa` or first-login enrollment."
        ),
        satisfies=[
            "ARCH-AUTH-LOCAL.1", "ARCH-CRED", "ARCH-CRED-HASH", "ARCH-CRED-POLICY",
            "ARCH-CRED-LOCKOUT", "ARCH-CRED-MFA", "ARCH-CRED-TOKENS",
        ],
        security=("IA-5", f"IA-5 / AC-7 credential controls. Verified: {EVIDENCE}; TOTP secrets envelope-wrapped; "
                  "replay of the same code within its window rejected."),
        artifacts=[
            ("other", "apps/reqaml/src/credential/password.ts"),
            ("other", "apps/reqaml/src/credential/lockout.ts"),
            ("other", "apps/reqaml/src/credential/mfa.ts"),
        ],
    ),
    dict(
        uid="CAP-KEY-ENVELOPE",
        parent="SEC-SEC",
        title="KeyProvider envelope encryption and JWKS signing keys",
        statement=(
            "OpenBao Transit wraps signing private keys and MFA secrets (envelope encryption). ES256 signing keys are "
            "published at `/oauth/jwks` with rotation support (retired keys remain during overlap window). Production "
            "startup fails closed when dev-marked OpenBao is configured (existing prod self-check). "
            "Acceptance: JWKS endpoint serves active keys; token issue uses KeyProvider-wrapped private key. "
            "Production follow-up: FIPS-validated modules and OpenBao Transit-sign (signing in HSM) — R1 uses "
            "Transit-wrapped extractable ES256 private keys in the app process."
        ),
        satisfies=[
            "ARCH-KEY", "ARCH-KEY-PROVIDER", "ARCH-KEY-SCOPE", "ARCH-KEY-JWKS",
            "ARCH-KEY-LIFECYCLE", "ARCH-KEY-FAILCLOSED",
        ],
        security=("SC-12", f"SC-12 / SC-28(3). Verified: {EVIDENCE}; `/oauth/jwks` serves Transit-wrapped ES256. "
                  "FIPS/Transit-sign deferred."),
        artifacts=[
            ("other", "apps/reqaml/src/key/provider.ts"),
            ("other", "apps/reqaml/src/key/signing.ts"),
        ],
    ),
    dict(
        uid="CAP-AUTH-AUDIT",
        parent="SEC-AUDIT",
        title="Authentication audit events (append-only)",
        statement=(
            "Authentication events are appended to `auth_audit_events`: local login success/failure, lockout, MFA verify, "
            "token issue/refresh/reuse/revoke, DCR deny, and RBAC deny samples. "
            "Acceptance: auth-flow-smoke exercises login, refresh reuse, revoke, lockout, and RBAC deny paths."
        ),
        satisfies=["ARCH-CRED-AUDIT"],
        security=("AU-2", f"AU-2 / AU-3 / AU-12. Verified: {EVIDENCE}; auth_audit_events rows observed for "
                  "login success/failure, lockout, token issue/refresh/reuse/revoke, DCR deny and RBAC deny."),
        artifacts=[("other", "apps/reqaml/src/audit/auth-audit.ts")],
    ),
    dict(
        uid="CAP-RBAC",
        parent="SEC-IA",
        title="RBAC enforcement on API mutations",
        statement=(
            "API routes enforce project-grant derived permissions (CAP-RBAC matrix subset). "
            "`POST /api/v1/projects/:projectId/grants` requires `grant:manage`; Readers receive 403 with audit. "
            "MCP `/mcp` requires MCP-audience tokens. "
            "Acceptance: auth-flow-smoke RBAC deny for casey-reader."
        ),
        satisfies=["ARCH-API-RBAC"],
        security=("AC-3", f"AC-3 enforcement. Verified: {EVIDENCE}."),
        artifacts=[
            ("other", "apps/reqaml/src/rbac/enforce.ts"),
            ("other", "apps/reqaml/src/http/server.ts"),
        ],
    ),
    dict(
        uid="CAP-AUTH-UPSTREAM-SEAM",
        parent="SEC-IA",
        title="Pluggable upstream IdP connector seam (stub)",
        statement=(
            "Upstream federation is not fully implemented in R1; the `UpstreamConnector` interface and "
            "`upstream_connectors` table plus read-only listing API document the extension point without token passthrough. "
            "OIDC/SAML RP implementations and home-realm discovery are deferred."
        ),
        satisfies=["ARCH-AUTH-UPSTREAM-CONNECTOR"],
        security=("IA-8", "Seam only — no live federation in R1. Verified by code review + typecheck."),
        artifacts=[("other", "apps/reqaml/src/auth/upstream-connector.ts")],
    ),
    dict(
        uid="CAP-DEVENV-INIT",
        parent="SEC-DEVENV",
        title="Idempotent devenv:init secrets CLI",
        statement=(
            "`pnpm devenv:init` writes per-developer random secrets to gitignored `.reqaml/devenv.env` and merges "
            "root `.env` for Compose (Postgres password, dev account password, session/agent secrets). Reruns preserve "
            "values unless `--rotate`. No fixed default passwords in the repo."
        ),
        satisfies=["ARCH-DEVENV-SECRETS", "ARCH-DEVENV-IDENTITY.1"],
        security=("IA-5", f"IA-5 dev credential hygiene. Verified: {EVIDENCE}."),
        artifacts=[("other", "scripts/devenv-init.mjs"), ("other", ".env.example")],
    ),
    dict(
        uid="CAP-MFA-ENROLL",
        parent="SEC-IA",
        title="TOTP MFA enrollment (UI + devenv:mfa CLI)",
        statement=(
            "Privileged roles require MFA in all modes. First login can return `mfa_enrollment_required` with otpauth URI; "
            "`pnpm devenv:mfa <identity-id>` enrolls dev users (or prints QR/URI). TOTP secrets are envelope-encrypted; "
            "replay within the TOTP window is rejected."
        ),
        satisfies=["ARCH-CRED-MFA"],
        security=("IA-2", f"IA-2 MFA enrollment. Verified: {EVIDENCE}."),
        artifacts=[
            ("other", "apps/reqaml/src/auth/mfa-enroll.ts"),
            ("other", "apps/reqaml/src/cli/enroll-mfa.ts"),
        ],
    ),
    dict(
        uid="CAP-AGENT-ACCESS",
        parent="SEC-IA",
        title="Dev agent OAuth client_credentials tokens",
        statement=(
            "`pnpm devenv:agent-token --agent <name> --role <role>` mints short-lived audience-bound tokens via "
            "registered `reqaml-agent-dev` client_credentials (not a backdoor password). Agent name and optional "
            "acting-for are recorded on token issue and RBAC mutation audit."
        ),
        satisfies=["ARCH-AUTH-AGENT-ATTRIBUTION"],
        security=("IA-2", f"IA-2 agent attribution. Verified: {EVIDENCE}."),
        artifacts=[
            ("other", "scripts/devenv-agent-token.mjs"),
            ("other", "apps/reqaml/src/auth/agent-auth.ts"),
        ],
    ),
    dict(
        uid="CAP-AUTH-HARDEN",
        parent="SEC-IA",
        title="Auth hardening: handoffs, BFF session, throttle, prod issuer",
        statement=(
            "Server-side OAuth login handoffs (no browser-trusted redirect_uri), HttpOnly web session cookies with CSRF, "
            "per-IP throttle alongside account lockout, prod REQAML_ISSUER_URL self-check, trustProxy off by default, "
            "auth on upstream connector listing, auth code redaction in logs, hashed unknown-usernames on failure audit, "
            "JWT signature verify before access-token revocation, normalized usernames."
        ),
        satisfies=["ARCH-AUTH-AS", "ARCH-CRED-LOCKOUT"],
        security=("SC-23", f"SC-23 session/OAuth hardening. Verified: {EVIDENCE}."),
        artifacts=[
            ("other", "apps/reqaml/src/auth/handoff.ts"),
            ("other", "apps/reqaml/src/auth/web-session.ts"),
            ("other", "apps/reqaml/src/credential/ip-throttle.ts"),
            ("other", "apps/reqaml/src/db/migrations/004_devenv_hardening.sql"),
        ],
    ),
]

# Fully met in R1 (only these on rel-r1-foundation-shell-auth delivers when it ships).
R1_FULL = [
    "ARCH-BUILD-FOUNDATION",
    "ARCH-AUTH-AS", "ARCH-AUTH-PKCE", "ARCH-AUTH-METADATA", "ARCH-AUTH-AUDIENCE",
    "ARCH-AUTH-REFRESH", "ARCH-AUTH-REVOKE", "ARCH-AUTH-CLIENTREG", "ARCH-AUTH-LOCAL.1",
    "ARCH-AUTH-PROFILE", "ARCH-AUTH-MCP-REQUIRED", "ARCH-AUTH-AGENT-ATTRIBUTION",
    "ARCH-AUTH-UPSTREAM-CONNECTOR",
    "ARCH-CRED", "ARCH-CRED-HASH", "ARCH-CRED-POLICY", "ARCH-CRED-LOCKOUT",
    "ARCH-CRED-MFA", "ARCH-CRED-TOKENS", "ARCH-CRED-AUDIT",
    "ARCH-KEY", "ARCH-KEY-PROVIDER", "ARCH-KEY-SCOPE", "ARCH-KEY-JWKS",
    "ARCH-KEY-LIFECYCLE", "ARCH-KEY-FAILCLOSED",
    "ARCH-API-RBAC", "ARCH-UI-GUARD", "ARCH-DEVENV-IDENTITY.1",
    "CAP-UI-FRAME", "CAP-OAUTH-AS", "CAP-CRED-STORE", "CAP-KEY-ENVELOPE",
    "CAP-AUTH-AUDIT", "CAP-RBAC", "CAP-AUTH-UPSTREAM-SEAM",
    "CAP-DEVENV-INIT", "CAP-MFA-ENROLL", "CAP-AGENT-ACCESS", "CAP-AUTH-HARDEN",
]

# Deferred platform/auth items — tracked on a later planned release, not R1 delivers.
R1_DEFERRED = [
    "ARCH-AUTH-FEDERATION",
    "ARCH-AUTH-LOCAL-BREAKGLASS",
    "ARCH-AUTH-CLAIM-MAP",
    "ARCH-AUTH-UPSTREAM-REVOKE",
    "ARCH-CRED-SESSION",
    "ARCH-CRED-REAUTH",
    "ARCH-KEY-CUSTODIAN",
    "ARCH-KEY-BREAKGLASS",
    "ARCH-KEY-FIPS",
    "ARCH-DEPLOY-MINIMAL",
    "ARCH-DEPLOY-PERIPHERALS",
    "ARCH-DEVENV-COMPOSE.1",
    "ARCH-API-LAYERS",
]

R1_DEFERRED_RELEASE = "rel-r1-platform-followups"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pr-url", required=True, help="Draft/merge PR URL for rel-r1-foundation-shell-auth")
    args = ap.parse_args()

    data = yaml.load(DOGFOOD)
    lines, versions, edges, arts = (
        data["requirement_lines"],
        data["requirement_versions"],
        data["edges"],
        data["capability_artifacts"],
    )
    uids = {v["uid"] for v in versions}

    for spec in DELIVERED:
        upsert(
            lines,
            "base_uid",
            cm(
                base_uid=spec["uid"],
                project_id="reqaml",
                parent=spec["parent"],
                kind="capability",
                title=spec["title"],
            ),
        )
        upsert(
            versions,
            "uid",
            cap_version(
                spec,
                status="active",
                verification_outcome="pass",
                iteration="iter-r1",
                grooming="detailed",
            ),
        )
        uids.add(spec["uid"])
        for t in spec["satisfies"]:
            assert t in uids, (spec["uid"], t)
            if not any(
                e.get("from") == spec["uid"] and e.get("to") == t and e.get("kind") == "satisfies"
                for e in edges
            ):
                edges.append(cm(**{"from": spec["uid"], "to": t, "kind": "satisfies"}))
        ref = spec["security"][0]
        if "-" in ref and not ref.startswith("REQAML-"):
            if not any(
                e.get("from") == spec["uid"] and e.get("to") == ref for e in edges
            ):
                edges.append(
                    cm(
                        **{
                            "from": spec["uid"],
                            "to": ref,
                            "kind": "conforms_to",
                            "catalog_imprint_id": NIST,
                        }
                    )
                )
        for kind, path in spec["artifacts"]:
            uri = path if path.startswith("../") else f"{REPO}/{path}"
            if not any(
                a.get("requirement_version_uid") == spec["uid"] and a.get("uri") == uri for a in arts
            ):
                arts.append(cm(requirement_version_uid=spec["uid"], kind=kind, uri=uri))

    pr12 = find(data["releases"], "id", "rel-pr12-devenv-foundation")
    assert pr12
    pr12["status"] = "shipped"
    pr12["shipped_on"] = "2026-10-07"
    pr12["notes"] = (
        f"One PR = one release. {PR12_URL} merged to main as {PR12_SHA} on 2026-10-07. "
        "pnpm monorepo, one Dockerfile, 2-container Compose (app + peripherals: Postgres + OpenBao), "
        "app shell, /health liveness, /ready live peripheral checks, startup backoff, production self-check "
        "refusing dev keys/accounts, `pnpm devenv:smoke` (CI manual-only)."
    )

    r1 = find(data["releases"], "id", "rel-r1-foundation-shell-auth")
    assert r1
    r1["name"] = "R1 — foundation shell + internal auth"
    r1["status"] = "planned"
    r1["planned_on"] = "2026-10-07"
    r1["delivers"] = sorted(R1_FULL, key=lambda x: (x.startswith("CAP"), x))
    r1["notes"] = (
        f"One PR = one release. {args.pr_url} (planned until merge). "
        "Built: UI frame (BFF session cookies), internal OAuth 2.1 AS with server-side handoffs, Argon2id + MFA "
        "enrollment, agent client_credentials, KeyProvider JWKS (Transit-wrapped ES256; FIPS/Transit-sign follow-up), "
        "RBAC, auth audit, upstream connector seam, `pnpm devenv:init` / MFA / agent-token CLIs. "
        f"Verified: {EVIDENCE}. "
        f"Deferred items moved to {R1_DEFERRED_RELEASE} (federation, break-glass, full step-up session UX, FIPS, etc.)."
    )

    follow = find(data["releases"], "id", R1_DEFERRED_RELEASE)
    if follow is None:
        data["releases"].append(
            cm(
                id=R1_DEFERRED_RELEASE,
                project_id="reqaml",
                name="R1 platform follow-ups (deferred from foundation PR)",
                planned_on="2026-11-30",
                shipped_on=None,
                status="planned",
                delivers=sorted(R1_DEFERRED, key=lambda x: (x.startswith("CAP"), x)),
                cyber_gate=False,
                notes=(
                    "Architecture requirements intentionally not claimed by rel-r1-foundation-shell-auth. "
                    "Includes federation SSO, break-glass, claim mapping, upstream revoke propagation, "
                    "full HttpOnly session/step-up product UX beyond R1 BFF, key custodian UI, FIPS/Transit-sign, "
                    "production deploy split, full API layering, hsm-test Compose profile."
                ),
            )
        )
    else:
        follow["delivers"] = sorted(R1_DEFERRED, key=lambda x: (x.startswith("CAP"), x))
        follow["status"] = "planned"

    yaml.dump(data, DOGFOOD)
    print(f"patched dogfood.yaml for R1 + shipped PR12 ({PR12_SHA})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
