#!/usr/bin/env python3
"""Local accounts optional + MCP OAuth mandatory + settled upstream-identity reqs (2026-10-07).

Dan (on open question §5, 2026-10-07): "We don't have to [have local accounts], but we will
need an oauth method for mcp integrations. That may pass through the user's provider, but
that has to be thought about. It's not always that simple... but could be."

Encodes:
  * ARCH-AUTH-LOCAL.1 (content successor): local accounts are an auth-profile capability, off by
    default in production; A01's "no local password store" stays the default posture (A01 NOT minted).
  * ARCH-AUTH-PROFILE, ARCH-AUTH-MCP-REQUIRED, ARCH-AUTH-LOCAL-BREAKGLASS.
  * Settled upstream-identity reqs only: ARCH-AUTH-UPSTREAM-CONNECTOR, ARCH-AUTH-CLAIM-MAP,
    ARCH-AUTH-UPSTREAM-REVOKE, ARCH-AUTH-AGENT-ATTRIBUTION. Unsettled options live in
    docs/design/auth/mcp-upstream-identity.md and roles/open-questions.md §5.
  * FIX beds + audit samples + foundation release delivers.

Apply AFTER patch_auth_foundation_encode.py (this script reconciles its output). Idempotent.
Does NOT git commit.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from patch_auth_foundation_encode import (  # noqa: E402
    DOGFOOD, FIX, NIST, STIG, cm, ensure_edge, find, line, sec, upsert, ver, yaml,
)

LINES = [
    line("ARCH-AUTH-PROFILE", "ARCH-AUTH-AS", "requirement", "Auth profile: identity mode and local-account setting per deployment"),
    line("ARCH-AUTH-MCP-REQUIRED", "ARCH-AUTH-AS", "requirement", "Internal AS is mandatory for MCP in every identity mode"),
    line("ARCH-AUTH-LOCAL-BREAKGLASS", "ARCH-AUTH-LOCAL", "requirement", "Break-glass local recovery admin (profile-enabled, MFA, dual control)"),
    line("ARCH-AUTH-UPSTREAM-CONNECTOR", "ARCH-AUTH-FEDERATION", "requirement", "Pluggable upstream IdP connector per client tenant"),
    line("ARCH-AUTH-CLAIM-MAP", "ARCH-AUTH-FEDERATION", "requirement", "Upstream claim-to-identity/grant mapping is explicit, tenant-bounded config"),
    line("ARCH-AUTH-UPSTREAM-REVOKE", "ARCH-AUTH-FEDERATION", "requirement", "Upstream session end and revocation are honored"),
    line("ARCH-AUTH-AGENT-ATTRIBUTION", "ARCH-AUTH-AS", "requirement", "Agent (MCP) actions attributed to the human subject and OAuth client"),
    line("FIX-DENY-LOCAL-LOGIN-PROFILE-OFF", "SEC-FIX", "requirement", "Local login denied/absent when profile disables local accounts"),
    line("FIX-ALLOW-BREAKGLASS-LOCAL-ADMIN", "SEC-FIX", "requirement", "Break-glass local admin allowed only when enabled, with MFA, recovery-scoped"),
    line("FIX-ALLOW-MCP-OAUTH-FEDERATED-ONLY", "SEC-FIX", "requirement", "MCP OAuth works with local accounts disabled (federated-only)"),
    line("FIX-DENY-UPSTREAM-LOGOUT-PROPAGATED", "SEC-FIX", "requirement", "Upstream back-channel logout revokes ReqALM sessions and MCP tokens"),
    line("FIX-DENY-CROSS-TENANT-CONNECTOR", "SEC-FIX", "requirement", "Client A's IdP connector cannot establish client B access"),
    line("FIX-ALLOW-AGENT-ATTRIBUTION", "SEC-FIX", "requirement", "MCP mutation audit names human subject + OAuth client"),
]

LOCAL1 = ver("ARCH-AUTH-LOCAL.1",
    "Local password accounts are an optional capability of the auth profile (ARCH-AUTH-PROFILE), not a baseline. The setting local_accounts takes one of three values: "
    "disabled (default for every production profile), breakglass_only (only ARCH-AUTH-LOCAL-BREAKGLASS accounts), or enabled (a profile that explicitly opts in). "
    "The development profile uses enabled with seeded dev accounts (ARCH-DEVENV-IDENTITY.1). "
    "With disabled: no local credential records exist, the local login route and form are absent, and sign-in is federated only. This keeps A01 / CAP-SSO / REQALM-SEC-SSO ('no local password store; MFA at the IdP') as the default production posture, so A01 is not minted. "
    "Where local accounts are enabled, they bind to the same identity rows and grants as federated identities, every local credential is subject to ARCH-CRED-*, account lifecycle is automated and audited, and unnecessary or built-in accounts are disabled. "
    "The internal AS and OAuth for MCP are required whatever this setting is (ARCH-AUTH-MCP-REQUIRED).",
    base="ARCH-AUTH-LOCAL", n=1, priority=10, rbac_op="auth:local:signin, identity:account:manage",
    security=sec("AC-2", "AC-2 account management; CM-7 local accounts off by default; ASD V-222407 / V-222412 / V-222661."),
    grooming_state="detailed", mint_kind="content")

V = [
    ver("ARCH-AUTH-PROFILE",
        "Each deployment has an auth profile that sets identity_mode (federated, local, or hybrid), local_accounts (disabled, breakglass_only, or enabled; see ARCH-AUTH-LOCAL.1), and the security presets (ARCH-CRED-POLICY / ARCH-CRED-MFA / ARCH-CRED-SESSION / ARCH-KEY-FIPS). "
        "Production defaults: identity_mode=federated, local_accounts=disabled. "
        "The profile is deployment configuration validated at startup, not a runtime toggle. A production profile that enables local accounts must name the reason and is logged at startup and in the audit trail. "
        "A dev profile (dev seed, dev KeyProvider) is refused in production. Whether a client tenant may override the deployment profile is an open question.",
        priority=10, rbac_op="auth:policy:configure",
        security=sec("CM-6", "CM-6 configuration settings; CM-7 least functionality (local accounts off by default)."), grooming_state="detailed"),
    ver("ARCH-AUTH-MCP-REQUIRED",
        "OAuth 2.1 through the internal AS (ARCH-AUTH-AS) is mandatory for MCP in every identity mode: federated, local, or hybrid. "
        "MCP hosts always authorize at the internal AS (ARCH-AUTH-PKCE / ARCH-AUTH-METADATA), and the MCP server accepts only internal-AS tokens whose audience is the MCP resource (ARCH-AUTH-AUDIENCE). "
        "How the user authenticates behind the AS (upstream IdP, or a local account where the profile allows it) never changes the MCP credential. "
        "Upstream provider tokens are never accepted by the MCP server and never forwarded by it. If an MCP tool must call an upstream provider's own APIs, the mechanism (token exchange vs stored upstream grants) is an open design choice (docs/design/auth/mcp-upstream-identity.md), but the AS token remains the MCP credential.",
        priority=5, rbac_op="auth:oauth:authorize, mcp:session:create",
        security=sec("IA-2", "IA-2 / IA-8; SC-23 audience-bound session authenticity; MCP authorization spec (no token passthrough)."), grooming_state="detailed"),
    ver("ARCH-AUTH-LOCAL-BREAKGLASS",
        "When the auth profile sets local_accounts=breakglass_only or enabled, a deployment may configure break-glass local recovery admin accounts for when the upstream IdP or its connector is unavailable or misconfigured. "
        "These accounts are created only from deployment configuration, never through self-service or the dev seed. Their credentials are long random secrets held under split knowledge and dual control, the same custody model as ARCH-KEY-BREAKGLASS. "
        "MFA is always required (ARCH-CRED-MFA), and sessions use the admin idle and absolute timeouts (ARCH-CRED-SESSION). Privileges are limited to recovery operations (restore an upstream connector or admin grants), with no requirement-content access. "
        "Every use raises an alert, is audited (ARCH-CRED-AUDIT), and is reviewed, and the credential is rotated after use. "
        "Break-glass accounts are protected from removal or disabling except by the documented process, and are exercised on a schedule.",
        priority=15, rbac_op="auth:breakglass:signin, auth:connector:configure",
        security=sec("AC-2.2", "AC-2(2) emergency accounts; IA-2(1) MFA; AU-2; ASD V-222410 / V-222523."), grooming_state="detailed"),
    ver("ARCH-AUTH-UPSTREAM-CONNECTOR",
        "Upstream identity providers attach through a pluggable connector interface (built in: OIDC RP and SAML 2.0 SP; other protocols through additional connectors). Each connector is registered to exactly one client tenant (client_id). "
        "Its client secrets and signing or decryption keys are stored under the key store (ARCH-KEY-SCOPE). "
        "A connector's assertions can only establish sessions for identities linked within that tenant (A06): a subject from client A's connector never obtains grants in client B, and cross-tenant access goes through ReqALM grants, not the connector. "
        "Connector configuration is managed by Client admin, needs step-up (ARCH-CRED-REAUTH), and is audited. "
        "How many connectors a tenant may have, how one is selected (home-realm discovery), and which non-OIDC/SAML protocols are supported are open questions (docs/design/auth/mcp-upstream-identity.md).",
        priority=10, rbac_op="auth:connector:configure",
        security=sec("IA-8", "IA-8 non-organizational users / federation; AC-3 tenant isolation; ASD V-222559 / V-222560."), grooming_state="detailed"),
    ver("ARCH-AUTH-CLAIM-MAP",
        "Mapping from upstream claims or attributes (sub/NameID, email, groups, amr/acr) to ReqALM identity, and optionally to grants, is explicit per-connector configuration. It is versioned, step-up gated, and audited, and is never implicit trust in upstream attributes. "
        "The identity key is the upstream issuer plus subject, never email alone. "
        "A mapping can never grant beyond its connector's tenant and never grants deployment-scoped roles (for example, Key custodian). "
        "Whether upstream groups may provision or deprovision ReqALM grants automatically is an open question. Until it is decided, grants come only from ReqALM grant records (A07 / A08), and upstream claims establish identity and MFA evidence only.",
        priority=10, rbac_op="auth:connector:configure",
        security=sec("AC-2", "AC-2 account management; AC-6 least privilege; AU-2."), grooming_state="detailed"),
    ver("ARCH-AUTH-UPSTREAM-REVOKE",
        "Upstream session end and revocation are honored. On an upstream back-channel logout (OIDC Back-Channel Logout or SAML SLO) where the connector supports it, the AS ends the linked ReqALM sessions and revokes their token families, including MCP refresh tokens. "
        "Each connector sets a maximum upstream authentication age; ReqALM refresh and session lifetimes never extend access past it without upstream re-authentication. An identity disabled or unlinked in ReqALM (A06 / A08) loses all sessions and tokens immediately. "
        "Revocation-propagation events are audited. Handling for IdPs without back-channel logout (polling, SCIM deprovisioning) is an open question, bounded meanwhile by the maximum authentication age.",
        priority=10, rbac_op="auth:oauth:revoke",
        security=sec("AC-12", "AC-12 session termination; AC-2(3); ASD V-222549 / V-222391."), grooming_state="detailed"),
    ver("ARCH-AUTH-AGENT-ATTRIBUTION",
        "Every action taken through MCP is attributed in audit to the human subject who authorized the MCP host (token sub), together with the OAuth client_id of the MCP host, the token id (jti), and source=mcp. "
        "There is no shared or elevated agent principal: an agent acts with the delegating user's grants under RBAC (MC01.1 / MC03). "
        "Attribution for headless or agent-only clients that act without a delegating human (client credentials, device flow) is an open question. Until it is decided, such clients are not supported.",
        priority=10, rbac_op="audit:write",
        security=sec("AU-3", "AU-3 content of audit records; AU-10 non-repudiation; ASD V-222438."), grooming_state="detailed"),
]

V += [
    ver("FIX-DENY-LOCAL-LOGIN-PROFILE-OFF", FIX + "Production auth profile with local_accounts=disabled: the local login route returns 404 (absent) and the AS sign-in page offers only the configured upstream connector(s). "
        "Seeding or creating a local credential is refused. The inspection oracle finds no local credential rows, so A01 'no local password store' holds.",
        rbac_op="auth:local:signin", security=sec("CM-7", "Pairs ARCH-AUTH-LOCAL.1 / ARCH-AUTH-PROFILE.")),
    ver("FIX-ALLOW-BREAKGLASS-LOCAL-ADMIN", FIX + "Profile local_accounts=breakglass_only with the upstream IdP connector down. A configured break-glass admin signs in with password + MFA and restores the connector (auth:connector:configure) → 200. "
        "An alert fires, audit rows are written, and the session uses the admin timeouts. Negative cases in the same bed: the break-glass account without MFA → denied; a requirement-content operation from that session → 403; an ordinary (non-break-glass) local login → denied.",
        priority=15, rbac_op="auth:breakglass:signin, auth:connector:configure", security=sec("AC-2.2", "Pairs ARCH-AUTH-LOCAL-BREAKGLASS.")),
    ver("FIX-ALLOW-MCP-OAUTH-FEDERATED-ONLY", FIX + "Profile identity_mode=federated, local_accounts=disabled. An MCP host (as alex-author) completes discovery and authorize at the internal AS, the AS brokers to the upstream connector, and returns an aud=MCP token. "
        "update_draft then succeeds, showing MCP OAuth does not depend on local accounts.",
        rbac_op="auth:oauth:authorize, requirement:version:update_draft", security=sec("IA-2", "Pairs ARCH-AUTH-MCP-REQUIRED.")),
    ver("FIX-DENY-UPSTREAM-LOGOUT-PROPAGATED", FIX + "dan has a UI session and an MCP refresh token, both from the upstream connector. The upstream IdP sends a back-channel logout for oidc:dan-raby, and the AS ends the sessions and revokes both token families. "
        "The next MCP refresh → invalid_grant and the UI call → 401. An audit row records the propagation.",
        priority=15, rbac_op="auth:oauth:revoke", security=sec("AC-12", "Pairs ARCH-AUTH-UPSTREAM-REVOKE.")),
    ver("FIX-DENY-CROSS-TENANT-CONNECTOR", FIX + "A valid assertion from raby-family's connector for a subject with no identity linked in other-family, used to sign in to other-family → no session for other-family. "
        "No identity is linked or created there, no grants are loaded, and the attempt is audited.",
        priority=15, rbac_op="auth:signin", security=sec("AC-3", "Pairs ARCH-AUTH-UPSTREAM-CONNECTOR / ARCH-CP-SCOPE.")),
    ver("FIX-ALLOW-AGENT-ATTRIBUTION", FIX + "MCP update_draft by alex-author through MCP host client cursor-mcp → the audit row has identity_id=alex-author, oauth_client_id=cursor-mcp, jti, and source=mcp. There is no agent-only principal.",
        priority=15, rbac_op="requirement:version:update_draft", security=sec("AU-3", "Pairs ARCH-AUTH-AGENT-ATTRIBUTION.")),
]

REL = [
    ("ARCH-AUTH-LOCAL.1", "ARCH-AUTH-AS", "refines"), ("ARCH-AUTH-LOCAL.1", "ARCH-CRED", "uses"),
    ("ARCH-AUTH-LOCAL.1", "ARCH-AUTH-PROFILE", "uses"), ("ARCH-AUTH-LOCAL.1", "A01", "refines"),
    ("ARCH-AUTH-LOCAL.1", "ARCH-AUTH-LOCAL", "refines"),
    ("ARCH-AUTH-PROFILE", "ARCH-AUTH-AS", "refines"), ("ARCH-AUTH-PROFILE", "A01", "refines"),
    ("ARCH-AUTH-PROFILE", "ARCH-CRED-POLICY", "uses"), ("ARCH-AUTH-PROFILE", "ARCH-KEY-FIPS", "uses"),
    ("ARCH-AUTH-PROFILE", "ARCH-DEVENV-IDENTITY.1", "uses"),
    ("ARCH-AUTH-MCP-REQUIRED", "ARCH-AUTH-AS", "refines"), ("ARCH-AUTH-MCP-REQUIRED", "MC01.1", "refines"),
    ("ARCH-AUTH-MCP-REQUIRED", "CAP-MCP-DESK", "refines"), ("ARCH-AUTH-MCP-REQUIRED", "ARCH-AUTH-AUDIENCE", "uses"),
    ("ARCH-AUTH-MCP-REQUIRED", "ARCH-AUTH-PROFILE", "uses"),
    ("ARCH-AUTH-LOCAL-BREAKGLASS", "ARCH-AUTH-LOCAL.1", "refines"), ("ARCH-AUTH-LOCAL-BREAKGLASS", "ARCH-KEY-BREAKGLASS", "uses"),
    ("ARCH-AUTH-LOCAL-BREAKGLASS", "ARCH-CRED-MFA", "uses"), ("ARCH-AUTH-LOCAL-BREAKGLASS", "ARCH-CRED-SESSION", "uses"),
    ("ARCH-AUTH-LOCAL-BREAKGLASS", "ARCH-CRED-AUDIT", "uses"),
    ("ARCH-AUTH-UPSTREAM-CONNECTOR", "ARCH-AUTH-FEDERATION", "refines"), ("ARCH-AUTH-UPSTREAM-CONNECTOR", "ARCH-CP-SCOPE", "uses"),
    ("ARCH-AUTH-UPSTREAM-CONNECTOR", "ARCH-KEY-SCOPE", "uses"), ("ARCH-AUTH-UPSTREAM-CONNECTOR", "A06", "uses"),
    ("ARCH-AUTH-UPSTREAM-CONNECTOR", "ARCH-CRED-REAUTH", "uses"),
    ("ARCH-AUTH-CLAIM-MAP", "ARCH-AUTH-FEDERATION", "refines"), ("ARCH-AUTH-CLAIM-MAP", "ARCH-AUTH-UPSTREAM-CONNECTOR", "uses"),
    ("ARCH-AUTH-CLAIM-MAP", "A06", "uses"), ("ARCH-AUTH-CLAIM-MAP", "A07", "uses"), ("ARCH-AUTH-CLAIM-MAP", "ARCH-API-RBAC", "uses"),
    ("ARCH-AUTH-UPSTREAM-REVOKE", "ARCH-AUTH-FEDERATION", "refines"), ("ARCH-AUTH-UPSTREAM-REVOKE", "ARCH-AUTH-REVOKE", "refines"),
    ("ARCH-AUTH-UPSTREAM-REVOKE", "ARCH-CRED-SESSION", "uses"), ("ARCH-AUTH-UPSTREAM-REVOKE", "A08", "uses"),
    ("ARCH-AUTH-AGENT-ATTRIBUTION", "ARCH-CRED-AUDIT", "refines"), ("ARCH-AUTH-AGENT-ATTRIBUTION", "ARCH-AUTH-MCP-REQUIRED", "uses"),
    ("ARCH-AUTH-AGENT-ATTRIBUTION", "MC02", "uses"), ("ARCH-AUTH-AGENT-ATTRIBUTION", "ARCH-OTEL", "uses"),
    ("FIX-DENY-LOCAL-LOGIN-PROFILE-OFF", "ARCH-AUTH-LOCAL.1", "uses"), ("FIX-DENY-LOCAL-LOGIN-PROFILE-OFF", "ARCH-AUTH-PROFILE", "uses"),
    ("FIX-DENY-LOCAL-LOGIN-PROFILE-OFF", "A01", "uses"),
    ("FIX-ALLOW-BREAKGLASS-LOCAL-ADMIN", "ARCH-AUTH-LOCAL-BREAKGLASS", "uses"), ("FIX-ALLOW-BREAKGLASS-LOCAL-ADMIN", "ARCH-CRED-MFA", "uses"),
    ("FIX-ALLOW-MCP-OAUTH-FEDERATED-ONLY", "ARCH-AUTH-MCP-REQUIRED", "uses"), ("FIX-ALLOW-MCP-OAUTH-FEDERATED-ONLY", "ARCH-AUTH-FEDERATION", "uses"),
    ("FIX-DENY-UPSTREAM-LOGOUT-PROPAGATED", "ARCH-AUTH-UPSTREAM-REVOKE", "uses"),
    ("FIX-DENY-CROSS-TENANT-CONNECTOR", "ARCH-AUTH-UPSTREAM-CONNECTOR", "uses"), ("FIX-DENY-CROSS-TENANT-CONNECTOR", "ARCH-CP-SCOPE", "uses"),
    ("FIX-ALLOW-AGENT-ATTRIBUTION", "ARCH-AUTH-AGENT-ATTRIBUTION", "uses"), ("FIX-ALLOW-AGENT-ATTRIBUTION", "MC02", "uses"),
    ("ARCH-BUILD-FOUNDATION", "ARCH-AUTH-MCP-REQUIRED", "uses"), ("ARCH-BUILD-FOUNDATION", "ARCH-AUTH-PROFILE", "uses"),
]


def n(*ids):
    return [(i, NIST) for i in ids]


def s(*ids):
    return [(i, STIG) for i in ids]


CONF = {
    "ARCH-AUTH-LOCAL.1": n("AC-2", "IA-2", "CM-7") + s("V-222407", "V-222412", "V-222661"),
    "ARCH-AUTH-PROFILE": n("CM-6", "CM-7", "IA-2"),
    "ARCH-AUTH-MCP-REQUIRED": n("IA-2", "IA-8", "SC-23", "AC-3") + s("V-222522"),
    "ARCH-AUTH-LOCAL-BREAKGLASS": n("AC-2.2", "IA-2.1", "AU-2", "AC-5") + s("V-222410", "V-222523", "V-222390"),
    "ARCH-AUTH-UPSTREAM-CONNECTOR": n("IA-8", "IA-2", "AC-3") + s("V-222400", "V-222401", "V-222403", "V-222404", "V-222559", "V-222560"),
    "ARCH-AUTH-CLAIM-MAP": n("AC-2", "AC-6", "AU-2"),
    "ARCH-AUTH-UPSTREAM-REVOKE": n("AC-12", "AC-2.3", "SC-23") + s("V-222549", "V-222391"),
    "ARCH-AUTH-AGENT-ATTRIBUTION": n("AU-3", "AU-10", "IA-2") + s("V-222438", "V-222441"),
    "FIX-DENY-LOCAL-LOGIN-PROFILE-OFF": n("CM-7"),
    "FIX-ALLOW-BREAKGLASS-LOCAL-ADMIN": n("AC-2.2", "IA-2.1") + s("V-222410"),
    "FIX-ALLOW-MCP-OAUTH-FEDERATED-ONLY": n("IA-2", "IA-8"),
    "FIX-DENY-UPSTREAM-LOGOUT-PROPAGATED": n("AC-12") + s("V-222549"),
    "FIX-DENY-CROSS-TENANT-CONNECTOR": n("AC-3", "IA-8"),
    "FIX-ALLOW-AGENT-ATTRIBUTION": n("AU-3", "AU-10") + s("V-222438"),
}


def ae(id_, at, who, action, outcome, status, notes, client="raby-family", project="reqalm", **extra):
    return cm(id=id_, at=at, identity_id=who, client_id=client, project_id=project, action=action,
              outcome=outcome, http_status=status, notes=notes, **extra)


AUDIT = [
    ae("ae-mcp-update-draft-attrib", "2026-10-07T15:30:00-04:00", "alex-author", "requirement:version:update_draft", "allow", 200,
       "FIX-ALLOW-AGENT-ATTRIBUTION sample row: agent action attributed to the human subject + MCP host client.",
       oauth_client_id="cursor-mcp", source="mcp"),
    ae("ae-deny-local-login-profile-off", "2026-10-07T15:35:00-04:00", "pat-client-admin", "auth:local:signin", "deny", 404,
       "FIX-DENY-LOCAL-LOGIN-PROFILE-OFF sample row: production profile local_accounts=disabled; local route absent (attempted username recorded, not authenticated).", client=None, project=None),
    ae("ae-upstream-logout-dan", "2026-10-07T15:40:00-04:00", "dan", "auth:upstream:logout", "allow", 200,
       "FIX-DENY-UPSTREAM-LOGOUT-PROPAGATED sample row: back-channel logout from raby-family connector; UI session + MCP token families revoked.", project=None),
]

NEW_DELIVERS = ["ARCH-AUTH-PROFILE", "ARCH-AUTH-MCP-REQUIRED", "ARCH-AUTH-LOCAL-BREAKGLASS",
                "ARCH-AUTH-UPSTREAM-CONNECTOR", "ARCH-AUTH-CLAIM-MAP", "ARCH-AUTH-UPSTREAM-REVOKE", "ARCH-AUTH-AGENT-ATTRIBUTION"]


def main() -> int:
    data = yaml.load(DOGFOOD)
    lines, versions, edges = data["requirement_lines"], data["requirement_versions"], data["edges"]
    n_lines = sum(upsert(lines, "base_uid", ln) for ln in LINES)
    find(lines, "base_uid", "ARCH-AUTH-LOCAL")["title"] = "Local accounts: optional per auth profile (off by default in production)"
    n_vers = sum(upsert(versions, "uid", v) for v in V)

    # Content successor ARCH-AUTH-LOCAL -> .1 (no ApprovalRecord on this line -> nothing to clear).
    prior = find(versions, "uid", "ARCH-AUTH-LOCAL")
    n_vers += upsert(versions, "uid", LOCAL1)
    prior["status"] = "superseded"
    dead = {v["uid"] for v in versions if v.get("status") in ("superseded", "withdrawn")}
    for e in edges:
        if e.get("to") == "ARCH-AUTH-LOCAL" and e.get("kind") in ("uses", "refines", "satisfies") \
                and e.get("from") not in dead and e.get("from") != "ARCH-AUTH-LOCAL.1":
            e["to"] = "ARCH-AUTH-LOCAL.1"
    seen, dedup = set(), []
    for e in edges:
        k = (e.get("from"), e.get("to"), e.get("kind"), e.get("catalog_imprint_id"))
        if k not in seen:
            seen.add(k)
            dedup.append(e)
    edges[:] = dedup

    uids = {v["uid"] for v in versions}
    n_edges = 0
    for f, t, k in REL:
        assert f in uids and t in uids, (f, t)
        n_edges += ensure_edge(edges, cm(**{"from": f, "to": t, "kind": k}))
    for f, items in CONF.items():
        for item, imp in items:
            n_edges += ensure_edge(edges, cm(**{"from": f, "to": item, "kind": "conforms_to", "catalog_imprint_id": imp}))

    for a in AUDIT:
        upsert(data["audit_events"], "id", a)

    arts = data["capability_artifacts"]
    for uid, uri in [("ARCH-AUTH-FEDERATION", "../auth/mcp-upstream-identity.md"),
                     ("ARCH-AUTH-MCP-REQUIRED", "../auth/mcp-upstream-identity.md"),
                     ("ARCH-AUTH-UPSTREAM-REVOKE", "../c4/sequences/AS03-federated-sso-via-as.puml"),
                     ("ARCH-AUTH-MCP-REQUIRED", "../c4/sequences/AS04-mcp-upstream-api-access.puml")]:
        if not any(a.get("requirement_version_uid") == uid and a.get("uri") == uri for a in arts):
            arts.append(cm(requirement_version_uid=uid, kind="other", uri=uri))

    rel = find(data["releases"], "id", "rel-r1-foundation-shell-auth")
    out = []
    for u in list(rel["delivers"]) + NEW_DELIVERS:
        u = "ARCH-AUTH-LOCAL.1" if u == "ARCH-AUTH-LOCAL" else u
        if u not in out:
            out.append(u)
    for u in out:
        assert u in uids, u
    rel["delivers"] = out

    yaml.dump(data, DOGFOOD)
    print(f"patched: new_lines={n_lines} new_versions={n_vers} new_edges={n_edges} "
          f"total_lines={len(lines)} total_versions={len(versions)} total_edges={len(edges)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
