#!/usr/bin/env python3
"""Encode the platform shell + authentication foundation slice (2026-10-07).

Dan (locked 2026-10-07):
  * "internal oauth? We will need that for mcp anyway ... start with the platform
    shell and authentication ... follow credential store controls."
  * "we probably need a secret store or key store ... for the encryption base"
  * OpenBao (Transit) = default KeyProvider for dev, suitable for prod; SoftHSM2
    optional for testing the PKCS#11 path; Vault (BUSL) / LocalStack KMS not defaults.
  * "run as few containers as possible, use a docker file and a single system to
    run as many peripherals as possible, where it makes sense."

Adds ARCH-AUTH-*, ARCH-CRED-*, ARCH-KEY-*, ARCH-DEPLOY-*, ARCH-DEVENV-KEYS,
SEC-BUILD / ARCH-BUILD-FOUNDATION, FIX-* beds, content successors (.1) for DEVENV
lines, Key custodian identity + platform grant, foundation planned release,
sample audit rows, capability artifacts. ConformsTo only real catalog UIDs.

Idempotent. Does NOT git commit.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

SEED = Path(__file__).resolve().parent.parent
DOGFOOD = SEED / "dogfood.yaml"
NIST = "nist-800-53@rev5-dogfood-20261006"
STIG = "asd-stig@v6r4"

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 1200
yaml.indent(mapping=2, sequence=2, offset=0)


def cm(**kw):
    m = CommentedMap()
    for k, v in kw.items():
        m[k] = v
    return m


def sec(ref, note):
    return {"catalog_ref": ref, "verification_note": note}


def line(bu, parent, kind, title):
    return cm(base_uid=bu, project_id="reqaml", parent=parent, kind=kind, title=title)


def ver(uid, statement, *, base=None, n=0, status="active", priority=10, iteration="iter-r1",
        rbac_op=None, security=None, **extra):
    m = cm(uid=uid, base_uid=base or uid, version_n=n, status=status, statement=statement)
    if priority is not None:
        m["priority"] = priority
    if iteration is not None:
        m["iteration"] = iteration
    if rbac_op:
        m["rbac_op"] = rbac_op
    if security is not None:
        m["security"] = dict(security)
    for k, v in extra.items():
        m[k] = v
    return m


FIX = "FIXTURE / TEST BED (not a product feature). "

LINES = [
    line("ARCH-AUTH-AS", "SEC-IA", "requirement", "Internal OAuth 2.1 authorization server (single token issuer)"),
    line("ARCH-AUTH-PKCE", "ARCH-AUTH-AS", "requirement", "Authorization code + PKCE S256 only"),
    line("ARCH-AUTH-METADATA", "ARCH-AUTH-AS", "requirement", "AS metadata (RFC 8414) + protected resource metadata (RFC 9728)"),
    line("ARCH-AUTH-AUDIENCE", "ARCH-AUTH-AS", "requirement", "Audience-bound tokens via resource indicators (RFC 8707); no passthrough"),
    line("ARCH-AUTH-REFRESH", "ARCH-AUTH-AS", "requirement", "Refresh token rotation with reuse detection"),
    line("ARCH-AUTH-REVOKE", "ARCH-AUTH-AS", "requirement", "Token revocation and session-linked teardown"),
    line("ARCH-AUTH-CLIENTREG", "ARCH-AUTH-AS", "requirement", "Client registration: pre-registered baseline; CIMD/DCR policy-gated"),
    line("ARCH-AUTH-FEDERATION", "ARCH-AUTH-AS", "requirement", "Enterprise SSO federated upstream through the internal AS"),
    line("ARCH-AUTH-LOCAL", "ARCH-AUTH-AS", "requirement", "Local accounts in the internal identity store"),
    line("ARCH-CRED", "SEC-SEC", "requirement", "Credential store controls"),
    line("ARCH-CRED-HASH", "ARCH-CRED", "requirement", "Passwords stored only as salted approved one-way hashes (configurable params)"),
    line("ARCH-CRED-POLICY", "ARCH-CRED", "requirement", "Password / authenticator policy presets"),
    line("ARCH-CRED-LOCKOUT", "ARCH-CRED", "requirement", "Throttling and lockout after failed attempts"),
    line("ARCH-CRED-MFA", "ARCH-CRED", "requirement", "MFA for privileged roles"),
    line("ARCH-CRED-TOKENS", "ARCH-CRED", "requirement", "Server-side tokens and client secrets stored hashed"),
    line("ARCH-CRED-SESSION", "ARCH-CRED", "requirement", "Session management: idle/absolute timeout, fixation, cookies"),
    line("ARCH-CRED-REAUTH", "ARCH-CRED", "requirement", "Re-authentication (step-up) for sensitive actions"),
    line("ARCH-CRED-AUDIT", "ARCH-CRED", "requirement", "Audit every authentication event"),
    line("ARCH-KEY", "SEC-SEC", "requirement", "Key / secret store — envelope encryption root of trust"),
    line("ARCH-KEY-PROVIDER", "ARCH-KEY", "requirement", "Pluggable KeyProvider; OpenBao Transit default"),
    line("ARCH-KEY-SCOPE", "ARCH-KEY", "requirement", "What the key store protects (signing keys, secrets, sensitive fields)"),
    line("ARCH-KEY-JWKS", "ARCH-KEY", "requirement", "Token signing keys: kid, JWKS, rotation with overlap window"),
    line("ARCH-KEY-LIFECYCLE", "ARCH-KEY", "requirement", "Key lifecycle: generate, rotate, revoke, destroy, online re-wrap"),
    line("ARCH-KEY-CUSTODIAN", "ARCH-KEY", "requirement", "Key custodian role (separation of duties)"),
    line("ARCH-KEY-BREAKGLASS", "ARCH-KEY", "requirement", "Key recovery / break-glass procedure"),
    line("ARCH-KEY-FIPS", "ARCH-KEY", "requirement", "FIPS-validated cryptographic modules where applicable"),
    line("ARCH-KEY-FAILCLOSED", "ARCH-KEY", "requirement", "Fail closed when the KEK / KeyProvider is unavailable"),
    line("ARCH-DEVENV-KEYS", "SEC-DEVENV", "requirement", "Dev KeyProvider: OpenBao dev instance; dev keys never valid in prod"),
    line("ARCH-DEPLOY-MINIMAL", "SEC-DEVENV", "requirement", "One Dockerfile; one multi-role app container (API+AS, Web UI, MCP, sync)"),
    line("ARCH-DEPLOY-PERIPHERALS", "SEC-DEVENV", "requirement", "Peripherals in as few containers as sensible (key store isolated in prod)"),
    line("SEC-BUILD", None, "section", "Build sequencing"),
    line("ARCH-BUILD-FOUNDATION", "SEC-BUILD", "requirement", "Foundation slice first: platform shell + authentication + key store"),
    line("FIX-ALLOW-MCP-OAUTH-PKCE", "SEC-FIX", "requirement", "MCP client authorizes via discovery + PKCE; audience-bound tool call"),
    line("FIX-DENY-PKCE-PLAIN", "SEC-FIX", "requirement", "Deny authorize with plain or missing PKCE"),
    line("FIX-DENY-MCP-WRONG-AUDIENCE", "SEC-FIX", "requirement", "Deny token with wrong audience at MCP server / API"),
    line("FIX-DENY-UPSTREAM-TOKEN-AT-API", "SEC-FIX", "requirement", "Deny upstream IdP token presented directly to API/MCP"),
    line("FIX-DENY-REFRESH-REUSE", "SEC-FIX", "requirement", "Deny reuse of a rotated refresh token; revoke family"),
    line("FIX-DENY-REVOKED-TOKEN", "SEC-FIX", "requirement", "Deny revoked refresh/access token after sign-out"),
    line("FIX-DENY-DCR-DISABLED", "SEC-FIX", "requirement", "Deny dynamic client registration when policy is off"),
    line("FIX-ALLOW-FEDERATED-SSO-VIA-AS", "SEC-FIX", "requirement", "Federated SSO yields internal-AS tokens for linked identity"),
    line("FIX-DENY-LOCKOUT", "SEC-FIX", "requirement", "Lockout after N consecutive failed logins"),
    line("FIX-DENY-PRIV-NO-MFA", "SEC-FIX", "requirement", "Deny privileged action on a session without MFA"),
    line("FIX-DENY-STEPUP-STALE-AUTH", "SEC-FIX", "requirement", "Deny approval/pin apply with stale authentication"),
    line("FIX-DENY-SESSION-IDLE", "SEC-FIX", "requirement", "Deny after idle session timeout"),
    line("FIX-ALLOW-CRED-HASH-ONLY", "SEC-FIX", "requirement", "Credential store holds only hashes / wrapped secrets"),
    line("FIX-DENY-KEK-UNREACHABLE-PROD", "SEC-FIX", "requirement", "Prod start fails closed when KEK unreachable"),
    line("FIX-DENY-DEV-KEK-IN-PROD", "SEC-FIX", "requirement", "Deny dev OpenBao / dev keys in a prod build"),
    line("FIX-JWKS-ROTATION-OVERLAP", "SEC-FIX", "requirement", "Rotated signing key verifies within overlap, rejected after"),
    line("FIX-DENY-KEYOP-NO-CUSTODIAN", "SEC-FIX", "requirement", "Deny key operation without Key custodian"),
    line("FIX-ALLOW-KEK-REWRAP-ONLINE", "SEC-FIX", "requirement", "KEK rotation re-wraps DEKs without downtime"),
    line("FIX-ALLOW-DEVENV-MIN-CONTAINERS", "SEC-FIX", "requirement", "Default dev stack is at most 2 containers"),
    line("FIX-ALLOW-APP-ROLE-SPLIT", "SEC-FIX", "requirement", "App roles toggle by env; split without rebuild"),
]

V = []
V += [
    ver("ARCH-AUTH-AS",
        "ReqAML includes its own OAuth 2.1 authorization server (AS) and it is the single token issuer for the Web UI, API, and MCP clients. It runs in the app container's API role. "
        "Only the authorization code grant with PKCE is supported for user-delegated access (no implicit, no resource-owner password grant). "
        "The AS conforms to the MCP authorization specification (OAuth 2.1, RFC 8414, RFC 9728, RFC 8707, RFC 9207 iss). "
        "Users authenticate at the AS either with a local account (ARCH-AUTH-LOCAL) or through a federated enterprise IdP (ARCH-AUTH-FEDERATION); "
        "either way the API and MCP server only accept tokens issued by this AS. Signing uses KeyProvider keys (ARCH-KEY-JWKS), and every auth event is audited (ARCH-CRED-AUDIT).",
        priority=5, rbac_op="auth:oauth:authorize, auth:oauth:token",
        security=sec("IA-2", "IA-2/IA-5/IA-8/SC-23; single issuer for UI, API, MCP. ASD V-222522."), grooming_state="detailed"),
    ver("ARCH-AUTH-PKCE",
        "The authorization endpoint requires PKCE with code_challenge_method=S256. Requests that use plain or omit the challenge are rejected (invalid_request) and no code is issued. "
        "AS metadata advertises code_challenge_methods_supported=[\"S256\"]. Authorization codes are single-use and short-lived, bound to client_id, redirect_uri (exact match), and code_challenge. "
        "State is required, and the authorization response carries iss (RFC 9207).",
        priority=5, rbac_op="auth:oauth:authorize",
        security=sec("IA-2.8", "Replay-resistant authentication (IA-2(8)); ASD V-222530 / V-222531."), grooming_state="detailed"),
    ver("ARCH-AUTH-METADATA",
        "The AS publishes Authorization Server Metadata (RFC 8414) at /.well-known/oauth-authorization-server, plus OpenID Connect discovery for interop. The metadata issuer is identical to the issuer URL. "
        "The MCP server and the API each publish OAuth Protected Resource Metadata (RFC 9728) at /.well-known/oauth-protected-resource, listing the internal AS in authorization_servers and stating their canonical resource URI. "
        "A request without a valid token gets 401 with WWW-Authenticate: Bearer resource_metadata=\"…\" so MCP clients can discover the AS.",
        priority=5,
        security=sec("REQAML-SEC-OAUTH", "MCP authorization spec discovery (RFC 8414 / RFC 9728). Interop requirement; no direct NIST pin."), grooming_state="detailed"),
    ver("ARCH-AUTH-AUDIENCE",
        "Clients send the RFC 8707 resource parameter on both authorization and token requests. Access tokens are audience-bound to exactly one canonical resource (the API or the MCP server). "
        "Each resource server rejects tokens whose audience is not its own (401 invalid_token). "
        "The MCP server never passes the token it received through to the API. Downstream API calls use a separately issued API-audience token for the same subject; that mechanism is an open question. "
        "RBAC (ARCH-API-RBAC / MC03) still decides every operation after the audience check.",
        priority=5, rbac_op="auth:token:validate",
        security=sec("SC-23", "SC-23 session authenticity; AC-3 enforcement at each resource server."), grooming_state="detailed"),
    ver("ARCH-AUTH-REFRESH",
        "Refresh tokens rotate on every use: the AS issues a new refresh token, invalidates the old one, and keeps them in one token family. "
        "Presenting an already-rotated refresh token is treated as theft: the AS returns invalid_grant, revokes the whole family (and derived access tokens where introspectable), and emits an audit event. "
        "Refresh tokens are bound to client_id and resource, stored hashed server-side (ARCH-CRED-TOKENS), and their idle and absolute lifetimes are configurable.",
        priority=5, rbac_op="auth:oauth:token",
        security=sec("SC-23", "SC-23 / IA-5 authenticator protection; replay-resistant refresh."), grooming_state="detailed"),
    ver("ARCH-AUTH-REVOKE",
        "The AS exposes token revocation (RFC 7009) for refresh and access tokens. Sign-out (A02) revokes the session's refresh tokens and desk attachments. "
        "Disabling or deleting an account, or revoking a grant that removes all access, terminates that subject's sessions and token families. "
        "Resource servers reject revoked tokens through introspection or short access-token lifetimes plus revocation checks.",
        priority=10, rbac_op="auth:oauth:revoke, auth:signout",
        security=sec("AC-12", "AC-12 session termination; ASD V-222549 / V-222578 / V-222391."), grooming_state="detailed"),
    ver("ARCH-AUTH-CLIENTREG",
        "First-party clients (Web UI, admin-configured ReqAML MCP clients) are pre-registered with exact redirect URIs. "
        "Client ID Metadata Documents and Dynamic Client Registration (RFC 7591; deprecated in the MCP 2026-07-28 revision) ship disabled by default. "
        "An admin can enable either one per deployment or per client policy, and every registration is audited. "
        "When DCR is disabled, registration_endpoint is omitted from AS metadata and registration requests are refused. Confidential-client secrets are stored hashed (ARCH-CRED-TOKENS).",
        priority=15, rbac_op="auth:client:register",
        security=sec("CM-7", "CM-7 least functionality: open registration off unless policy enables it."), grooming_state="detailed"),
    ver("ARCH-AUTH-FEDERATION",
        "The enterprise IdP (OIDC or SAML), formerly the direct sign-in path in A01 / CAP-SSO / REQAML-SEC-SSO, is an upstream identity provider federated through the internal AS, not a separate token path. "
        "The AS acts as the OIDC RP / SAML SP. It validates the upstream response (signature, issuer, audience, nonce, NotBefore/NotOnOrAfter, single-use assertion ID), maps external_sub to a linked identity (A06), "
        "and then issues ReqAML tokens through the normal code + PKCE flow. When the role needs MFA (ARCH-CRED-MFA), the AS requires upstream MFA evidence (amr/acr). "
        "The API and MCP server never accept upstream IdP tokens directly.",
        priority=5, rbac_op="auth:signin",
        security=sec("IA-2", "IA-2 / IA-8 federated identification; ASD V-222400 / V-222401 / V-222403 / V-222404 SAML assertion checks."), grooming_state="detailed"),
    ver("ARCH-AUTH-LOCAL",
        "The internal identity store supports local accounts that bind to the same identity rows and grants as federated identities. "
        "Local accounts are required for development (seeded dev accounts, ARCH-DEVENV-IDENTITY.1) and available to deployments whose policy enables them; production enablement and eligible users are an open question. "
        "Every local credential is subject to ARCH-CRED-*. Account create/modify/disable/remove is automated and audited, and unnecessary or built-in accounts are disabled.",
        priority=10, rbac_op="auth:local:signin, identity:account:manage",
        security=sec("AC-2", "AC-2 account management; ASD V-222407 / V-222412 / V-222661."), grooming_state="detailed"),
]
V += [
    ver("ARCH-CRED",
        "Credential store controls cover every credential ReqAML holds or verifies: local passwords, MFA authenticators, OAuth refresh tokens, authorization codes, client secrets, and session identifiers. "
        "Credentials are never stored or logged in plaintext. Each one is either one-way hashed (verify-only) or wrapped by the key store (must be usable), per ARCH-KEY.",
        priority=5, security=sec("IA-5", "IA-5 authenticator management umbrella."), grooming_state="detailed"),
    ver("ARCH-CRED-HASH",
        "Local passwords are stored only as salted, approved one-way hashes with a per-credential random salt. Algorithm and cost parameters are configuration, not a hard-coded library: "
        "Argon2id where FIPS mode is not required, PBKDF2-HMAC-SHA-256/512 (FIPS-approved) where FIPS-validated crypto is required (ARCH-KEY-FIPS). "
        "Each stored hash records its algorithm and parameters, and an outdated hash is re-hashed on the next successful login. Passwords travel only over TLS and are never displayed or logged.",
        priority=5, rbac_op="auth:local:signin",
        security=sec("IA-5.1", "IA-5(1) password-based auth; ASD V-222542 / V-222543 / V-222554 / V-222571."), grooming_state="detailed"),
    ver("ARCH-CRED-POLICY",
        "Password and authenticator policy (minimum length, composition or blocklist, change distance, minimum and maximum lifetime, reuse history, temporary password with forced change) is a configurable preset per deployment. "
        "The DoD-facing preset meets ASD STIG V6R4 values. Default and seeded credentials must be changed before first use, and production must not contain any.",
        priority=10, rbac_op="auth:policy:configure",
        security=sec("IA-5.1", "IA-5(1); ASD V-222536..V-222541, V-222544..V-222548, V-222662."), grooming_state="detailed"),
    ver("ARCH-CRED-LOCKOUT",
        "The AS throttles authentication per account and per source, and locks a local account after N consecutive failed attempts within a window (configurable; DoD preset 3 in 15 minutes). "
        "While locked, even a correct password is refused with the same generic error, and failures never reveal whether an account exists. "
        "Unlock happens only through an approved admin process (auth:account:unlock) or the configured timer. Every failure, lockout, and unlock is audited.",
        priority=5, rbac_op="auth:local:signin, auth:account:unlock",
        security=sec("AC-7", "AC-7 unsuccessful logon attempts; ASD V-222432 / V-222433 / V-222462."), grooming_state="detailed"),
    ver("ARCH-CRED-MFA",
        "Privileged roles must use multi-factor authentication. Privileged means roles holding admin, approve, apply, sign-off, ship, steward, or key-custodian permissions in the permission tree. "
        "For local accounts the AS enforces a second factor, with MFA secrets wrapped by the key store. For federated logins the AS requires upstream MFA evidence (amr/acr). "
        "A session without MFA cannot perform privileged operations. MFA for non-privileged users is a policy preset; factor types and the confirmed privileged-role list are open questions.",
        priority=5, rbac_op="auth:mfa:verify",
        security=sec("IA-2.1", "IA-2(1) MFA privileged; ASD V-222523 / V-222527."), grooming_state="detailed"),
    ver("ARCH-CRED-TOKENS",
        "Server-side bearer credentials (refresh tokens, authorization codes, confidential-client secrets, MFA recovery codes) are stored only as hashes (keyed hash or one-way hash), compared in constant time, and never retrievable. "
        "Secrets ReqAML must present to others (upstream IdP client secret, Azure DevOps connector tokens, SMTP credentials, OTEL sink credentials) are stored encrypted under key-store DEKs (ARCH-KEY-SCOPE) and never returned by APIs.",
        priority=5,
        security=sec("IA-5.6", "IA-5(6) protection of authenticators; SC-28(1); ASD V-222542 / V-222588."), grooming_state="detailed"),
    ver("ARCH-CRED-SESSION",
        "Sessions use system-generated unique identifiers from an approved RNG and rotate on login (anti-fixation). Session IDs are never in URLs or otherwise exposed. "
        "Cookies are HttpOnly and Secure, sessions are validated server-side, and IDs are never reused. "
        "Idle and absolute timeouts are configurable (DoD preset: 15 minutes idle non-privileged, 10 minutes admin), as are concurrent-session limits. "
        "Timeout, sign-out, and account deletion destroy the session and its token family. Session create, renew, timeout, and destroy are audited.",
        priority=5, rbac_op="auth:session:manage",
        security=sec("AC-12", "AC-12 / AC-2(5) / AC-10 / SC-23(3); ASD V-222387 / V-222389 / V-222390 / V-222575 / V-222576 / V-222577 / V-222579 / V-222581 / V-222582 / V-222583."), grooming_state="detailed"),
    ver("ARCH-CRED-REAUTH",
        "Sensitive actions require recent authentication (step-up): line or tree approve (D12/D13), capability approve, ConformsTo pin apply/deny, gate sign-off, release ship, grant and role administration, client registration, and key operations. "
        "If auth_time is older than the configured max_age, or MFA is missing for a privileged slot, the action returns a step-up challenge and nothing is written.",
        priority=10, rbac_op="auth:stepup",
        security=sec("IA-11", "IA-11 re-authentication; ASD V-222520."), grooming_state="detailed"),
    ver("ARCH-CRED-AUDIT",
        "Every authentication event is audited through the existing AuditLog pattern (ARCH-OTEL) with subject, client_id, source IP, user agent, outcome, and timestamp. "
        "Covered events: login success and failure, lockout and unlock, MFA result, step-up, token issue / refresh / rotation-reuse / revoke, client registration, session create / renew / timeout / destroy, account create / modify / disable / remove, and key operations. "
        "Secrets, tokens, and password material never appear in audit payloads.",
        priority=5,
        security=sec("AU-2", "AU-2/3/12; ASD V-222462 / V-222441 / V-222442 / V-222443 / V-222445 / V-222467."), grooming_state="detailed"),
]
V += [
    ver("ARCH-KEY",
        "ReqAML's encryption root of trust is an external key / secret store using envelope encryption. A key-encryption key (KEK) is held outside the application database by the KeyProvider and wraps data-encryption keys (DEKs). "
        "DEKs are persisted only in wrapped form. Plaintext key material exists only in process memory, is never written to the database, logs, or source, and is zeroized when no longer needed.",
        priority=5, security=sec("SC-12", "SC-12 key establishment/management; SC-28(3) cryptographic keys at rest."), grooming_state="detailed"),
    ver("ARCH-KEY-PROVIDER",
        "Key operations go through a pluggable KeyProvider abstraction: wrap/unwrap DEK, re-wrap, generate, rotate, revoke/disable, destroy, and sign with non-exportable signing keys. "
        "The default backend is OpenBao with the Transit engine (envelope encrypt/decrypt/rewrap plus sign) for dev, and it is suitable for production. "
        "The same interface also accepts a cloud KMS or an HSM over PKCS#11 (SoftHSM2 is used only to test the PKCS#11 path). HashiCorp Vault (BUSL) and LocalStack KMS are not defaults. "
        "Access to the KeyProvider is authenticated with deployment credentials injected at runtime, never committed (ARCH-DEVENV-SECRETS).",
        priority=5, security=sec("IA-7", "IA-7 cryptographic module authentication; ASD V-222555."), grooming_state="detailed"),
    ver("ARCH-KEY-SCOPE",
        "The key store protects: (1) OAuth token signing keys (ARCH-KEY-JWKS); "
        "(2) secrets the app must use (DB credentials, SMTP credentials, Azure DevOps connector tokens, upstream IdP client secrets, OTEL sink credentials, MFA secrets), encrypted under DEKs; "
        "(3) peppers or HMAC keys used to hash server-side tokens (ARCH-CRED-TOKENS). Verify-only credentials are hashed, not encrypted. "
        "Field-level encryption applies only to columns that hold such secrets. Requirement content is not field-encrypted and relies on storage-level encryption at rest per deployment.",
        priority=10, security=sec("SC-28.1", "SC-28(1) cryptographic protection at rest; ASD V-222588 / V-222589 / V-222642."), grooming_state="detailed"),
    ver("ARCH-KEY-JWKS",
        "Each token signing key has a kid. By default it is a non-exportable OpenBao Transit key, so signing happens inside the KeyProvider and the kid is the key name plus version. "
        "The AS publishes public keys at its jwks_uri for the active key and any retired keys still inside the overlap window. "
        "Rotation is scheduled and on demand: a new key version starts signing, the prior version stays verify-only until the overlap window passes (at least the maximum access-token lifetime plus clock skew), and is then removed. "
        "After that, tokens with the retired kid are rejected.",
        priority=5, rbac_op="key:signing:rotate", security=sec("SC-12.3", "SC-12(3) asymmetric keys; SC-13; ASD V-222570."), grooming_state="detailed"),
    ver("ARCH-KEY-LIFECYCLE",
        "Key lifecycle operations are generate, rotate (scheduled and on demand), revoke/disable, and destroy, for KEKs and DEKs. "
        "KEK rotation creates a new key version and re-wraps every DEK online (Transit rewrap, so plaintext is never exposed). Prior versions still unwrap until re-wrap finishes and is verified, then the minimum decryption version is raised to disable them. "
        "Reads and writes continue throughout with no downtime. Destroy is irreversible, needs the Key custodian (ARCH-KEY-CUSTODIAN), and requires confirmation that no live ciphertext depends on the key. "
        "Every key operation emits an audit event through the AuditLog pattern (operation, key id/version, actor, outcome) and never includes key material.",
        priority=5, rbac_op="key:kek:rotate, key:dek:rewrap, key:revoke, key:destroy",
        security=sec("SC-12", "SC-12 / SC-12(2) / SC-12(3); AU-2."), grooming_state="detailed"),
    ver("ARCH-KEY-CUSTODIAN",
        "Key operations (KEK/DEK rotate, revoke, destroy, provider reconfigure, recovery) need the deployment-scoped Key custodian role. "
        "No existing role fits: project and client roles are tenant-scoped, and the permission tree has no ops or deployment role ('No separate Deployer in v1'). "
        "For separation of duties, the Key custodian is distinct from Client admin and Project admin, and holding both on one deployment is refused unless a documented exception is approved. "
        "The role grants no access to requirement content. Scheduled automatic rotation runs as an audited system principal.",
        priority=10, rbac_op="key:*", security=sec("AC-5", "AC-5 separation of duties; AC-6 least privilege."), grooming_state="detailed"),
    ver("ARCH-KEY-BREAKGLASS",
        "A documented key recovery / break-glass procedure covers KEK or KeyProvider loss and custodian unavailability. "
        "It uses OpenBao unseal/recovery shares or provider-native recovery held under split knowledge and dual control (M-of-N custodians), restores without exposing plaintext keys, and rotates keys afterward. "
        "Every break-glass use is audited and reviewed, and a restore exercise runs on a schedule.",
        priority=15, rbac_op="key:recover", security=sec("SC-12.1", "SC-12(1) key availability; AC-5 dual control."), grooming_state="detailed"),
    ver("ARCH-KEY-FIPS",
        "Where a deployment requires it (DoD/federal profile), all cryptographic operations (hashing, signing, encryption, key wrap, and RNG for session IDs and tokens) use FIPS 140-validated modules (FIPS mode). "
        "Password hashing then uses PBKDF2 (ARCH-CRED-HASH), and a KeyProvider build that is not FIPS-validated is refused in that mode. Whether FIPS mode is the default for commercial deployments is an open question.",
        priority=10, security=sec("SC-13", "SC-13 cryptographic protection; ASD V-222570 / V-222571 / V-222572 / V-222583."), grooming_state="detailed"),
    ver("ARCH-KEY-FAILCLOSED",
        "In production, ReqAML fails closed when the KEK or KeyProvider is unreachable or sealed. The app does not start or reports not ready (ARCH-DEVENV-HEALTH / M04), and it refuses operations that need key material. "
        "It never falls back to plaintext, cached plaintext KEKs on disk, or a dev provider. Unavailability is audited and alerted.",
        priority=5, security=sec("SC-24", "SC-24 fail in known state; SC-12(1)."), grooming_state="detailed"),
    ver("ARCH-DEVENV-KEYS",
        "Development uses OpenBao (Transit engine) in the peripherals container as the default KeyProvider, which is the same provider type as the production default. "
        "On first start it initializes with dev-only seal/unseal material and a root token generated locally into git-ignored files (never committed). Storage persists so wrapped DEKs survive restarts, and Transit keys are dev-marked. "
        "Dev OpenBao instances and dev keys are never valid in production: production runs its own OpenBao with its own seal, and the app refuses dev-marked addresses or keys in prod mode. "
        "SoftHSM2 is optional and exists only to exercise the PKCS#11 provider path (app hsm-test build target).",
        priority=10, security=sec("CM-7", "CM-7 least functionality; dev key path non-essential in prod. ASD V-222642."), grooming_state="detailed"),
    ver("ARCH-DEPLOY-MINIMAL",
        "One Dockerfile with multi-stage targets (app, peripherals, optional hsm-test) builds every ReqAML image. "
        "A single app container runs the API (including the internal OAuth AS), Web UI (static assets served by the API role), MCP server (Streamable HTTP), and sync worker together, as one Node process or under a lightweight supervisor. "
        "Roles are toggled by env/config (for example REQAML_ROLES=api,web,mcp,sync), so any role can later run as its own container from the same image without a rebuild, and health/readiness is reported per enabled role. "
        "Rationale (Dan, 2026-10-07): run as few containers as possible for fast clone-to-running and small deployments. C4 L2 containers are logical runtime containers, not mandated deploy units.",
        priority=5, iteration="iter-r0", security=sec("CM-2", "CM-2 baseline: one Dockerfile + role config is the deployable baseline; CM-7 roles off when not needed."), grooming_state="detailed"),
    ver("ARCH-DEPLOY-PERIPHERALS",
        "Peripherals run in as few containers as is sensible. "
        "Dev/test: one peripherals container (Dockerfile peripherals target) runs Postgres and OpenBao under a lightweight supervisor, each with its own named volume. "
        "Co-locating them in dev is acceptable because dev keys are dev-only and protect no real data, and separate volumes keep reset and backup independent. "
        "Production: Postgres and OpenBao are separate deploy units with separate host, volume, and backup set. "
        "Rationale: envelope encryption protects data only if the KEK store does not share a compromise domain or backup set with the database whose DEKs it wraps (ARCH-KEY, SC-28(3)), and the two have different durability models (database backups/PITR versus OpenBao seal plus snapshots). "
        "SoftHSM2 is a PKCS#11 library loaded in-process, so it is not a peripheral container: it is an optional app hsm-test target and is never deployed. "
        "Reference topology: dev 2 containers (app + peripherals); prod 3 units (app, Postgres, OpenBao).",
        priority=5, iteration="iter-r0", security=sec("SC-28.3", "SC-28(3) key storage separated from protected data in prod; CP-9 independent backups."), grooming_state="detailed"),
    ver("SEC-BUILD", "Build sequencing for ReqAML implementation. This is ordering only: it does not cut v1 scope or mark any requirement out of scope.",
        priority=None, iteration=None),
    ver("ARCH-BUILD-FOUNDATION",
        "The first implementation slice is the foundation: platform shell (App shell, routes and guards, layout: ARCH-UI / ARCH-UI-GUARD), API layering and OpenAPI (ARCH-API / ARCH-API-LAYERS), "
        "tenancy scope (ARCH-CP-SCOPE), internal OAuth AS (ARCH-AUTH-*), local accounts and credential store (ARCH-CRED-*), key / secret store with OpenBao (ARCH-KEY-*), "
        "RBAC enforcement points (ARCH-API-RBAC / CAP-RBAC), audit (ARCH-OTEL / ARCH-CRED-AUDIT), health (M04), and the minimal-container Compose environment (ARCH-DEVENV-*, ARCH-DEPLOY-*). "
        "All other requirements layer on this foundation. This records build order only: no v1 requirement is deferred, descoped, or marked out of scope. Planned release rel-r1-foundation-shell-auth tracks the slice.",
        priority=1, security=sec("SA-8", "SA-8 security engineering: security foundations built first."), grooming_state="detailed"),
]
V += [
    ver("FIX-ALLOW-MCP-OAUTH-PKCE",
        FIX + "MCP host (as alex-author) calls the MCP server without a token → 401 + WWW-Authenticate resource_metadata. It fetches PRM, then AS metadata (issuer match, S256 advertised), "
        "authorizes with S256 + resource=MCP URI, and exchanges code + verifier + resource for an aud=MCP access token plus a rotating refresh token. The tool update_draft then succeeds (200) after the audience check and RBAC.",
        rbac_op="auth:oauth:authorize, requirement:version:update_draft", security=sec("IA-2", "Happy path for ARCH-AUTH-* / MCP spec.")),
    ver("FIX-DENY-PKCE-PLAIN", FIX + "Authorize request with code_challenge_method=plain, or no code_challenge → expect 400 invalid_request, no authorization code issued, audit deny.",
        rbac_op="auth:oauth:authorize", security=sec("IA-2.8", "Pairs ARCH-AUTH-PKCE; ASD V-222530.")),
    ver("FIX-DENY-MCP-WRONG-AUDIENCE", FIX + "aud=API access token presented to the MCP server → 401 invalid_token + WWW-Authenticate resource_metadata. An aud=MCP token presented to the API → 401. No tool or business call runs.",
        rbac_op="auth:token:validate", security=sec("SC-23", "Pairs ARCH-AUTH-AUDIENCE.")),
    ver("FIX-DENY-UPSTREAM-TOKEN-AT-API", FIX + "A token minted by the upstream enterprise IdP, presented directly to the API or MCP server → 401 (issuer not trusted). Only internal-AS tokens are accepted.",
        priority=15, rbac_op="auth:token:validate", security=sec("IA-2", "Pairs ARCH-AUTH-FEDERATION: no separate token path.")),
    ver("FIX-DENY-REFRESH-REUSE", FIX + "Refresh token R1 rotated to R2; presenting R1 again → 400 invalid_grant. R2 and its derived access tokens are revoked (token family), and an audit row records reuse detection.",
        rbac_op="auth:oauth:token", security=sec("SC-23", "Pairs ARCH-AUTH-REFRESH.")),
    ver("FIX-DENY-REVOKED-TOKEN", FIX + "After sign-out (A02) or RFC 7009 revocation: the revoked refresh token → invalid_grant, and the revoked access token is rejected at the API → 401.",
        priority=15, rbac_op="auth:oauth:revoke", security=sec("AC-12", "Pairs ARCH-AUTH-REVOKE; ASD V-222578.")),
    ver("FIX-DENY-DCR-DISABLED", FIX + "With DCR policy off (default), AS metadata omits registration_endpoint and POST /register → 403 (or 404). No client row is created, and the attempt is audited.",
        priority=20, rbac_op="auth:client:register", security=sec("CM-7", "Pairs ARCH-AUTH-CLIENTREG.")),
    ver("FIX-ALLOW-FEDERATED-SSO-VIA-AS", FIX + "dan signs in through the upstream IdP (external_sub oidc:dan-raby). The AS validates the assertion, maps it to identity dan, and issues internal-AS tokens (iss = ReqAML AS). "
        "The API accepts them and loads dan's reqaml grants; the upstream token never reaches the API.",
        rbac_op="auth:signin", security=sec("IA-8", "Pairs ARCH-AUTH-FEDERATION / A01.")),
    ver("FIX-DENY-LOCKOUT", FIX + "Local dev account for taylor-tester: N consecutive wrong passwords inside the window (DoD preset 3 in 15 minutes) → account locked. The next login with the correct password is refused with the same generic error. "
        "Audit records each failure and the lockout. Unlock only via auth:account:unlock or the timer.",
        rbac_op="auth:local:signin", security=sec("AC-7", "Pairs ARCH-CRED-LOCKOUT; ASD V-222432.")),
    ver("FIX-DENY-PRIV-NO-MFA", FIX + "dan (Project admin) with a session lacking MFA evidence attempts project:grant:create → step-up required / 403. No grant is written, and the attempt is audited.",
        rbac_op="project:grant:create", security=sec("IA-2.1", "Pairs ARCH-CRED-MFA; ASD V-222523.")),
    ver("FIX-DENY-STEPUP-STALE-AUTH", FIX + "pat-client-admin calls requirement:line:approve, or sam-security calls catalog:pin:apply, with auth_time older than max_age → 401 step-up challenge (insufficient_user_authentication). No ApprovalRecord or pin is written.",
        rbac_op="requirement:line:approve, catalog:pin:apply", security=sec("IA-11", "Pairs ARCH-CRED-REAUTH; ASD V-222520.")),
    ver("FIX-DENY-SESSION-IDLE", FIX + "Session idle past the configured timeout (DoD preset 15 minutes non-privileged, 10 minutes admin) → next API call 401. The session is destroyed and a session-timeout audit row is emitted.",
        priority=15, rbac_op="auth:session:manage", security=sec("AC-12", "Pairs ARCH-CRED-SESSION; ASD V-222389 / V-222390 / V-222445.")),
    ver("FIX-ALLOW-CRED-HASH-ONLY", FIX + "Inspection oracle on a seeded instance: no plaintext passwords, refresh tokens, authorization codes, or client secrets (hashes only, with algorithm and params recorded). "
        "Usable secrets exist only as DEK ciphertext, and DEKs exist only wrapped by the OpenBao Transit KEK.",
        priority=15, security=sec("IA-5.1", "Pairs ARCH-CRED-HASH / ARCH-CRED-TOKENS / ARCH-KEY; ASD V-222542.")),
    ver("FIX-DENY-KEK-UNREACHABLE-PROD", FIX + "Production config with OpenBao unreachable or sealed → app refuses to start or readiness stays not-ready, and health reports unhealthy. No plaintext or dev-key fallback. Audited and alerted.",
        security=sec("SC-24", "Pairs ARCH-KEY-FAILCLOSED.")),
    ver("FIX-DENY-DEV-KEK-IN-PROD", FIX + "Production build or config pointing at a dev OpenBao (dev-marked address, dev root token, or dev-marked Transit keys) → startup refused with an explicit error. No keys are unwrapped.",
        security=sec("CM-7", "Pairs ARCH-DEVENV-KEYS.")),
    ver("FIX-JWKS-ROTATION-OVERLAP", FIX + "Transit signing key rotated v1 → v2. A token with kid=v1 still verifies inside the overlap window, and JWKS lists v1 and v2. After the window, v1 leaves JWKS and the same token → 401. New tokens carry kid=v2.",
        rbac_op="key:signing:rotate", security=sec("SC-12.3", "Pairs ARCH-KEY-JWKS.")),
    ver("FIX-DENY-KEYOP-NO-CUSTODIAN", FIX + "pat-client-admin (Client admin, not Key custodian) attempts key:kek:rotate → 403 + audit deny. kim-key-custodian performing the same op → allowed after step-up.",
        rbac_op="key:kek:rotate", security=sec("AC-5", "Pairs ARCH-KEY-CUSTODIAN.")),
    ver("FIX-ALLOW-KEK-REWRAP-ONLINE", FIX + "KEK v1 → v2 while the app serves traffic. Every wrapped DEK is re-wrapped (Transit rewrap), and reads and writes succeed throughout. After verification the minimum decryption version is raised; v1 unwrap then fails and nothing depends on it. Each step is audited.",
        priority=15, rbac_op="key:kek:rotate, key:dek:rewrap", security=sec("SC-12", "Pairs ARCH-KEY-LIFECYCLE.")),
    ver("FIX-ALLOW-DEVENV-MIN-CONTAINERS", FIX + "From a fresh clone, the default compose up starts at most 2 containers (app + peripherals) and both report healthy. "
        "Hybrid mode starts only the peripherals container. The optional SoftHSM2 profile changes the app build target and does not add a peripheral container.",
        priority=15, iteration="iter-r0", security=sec("CM-2", "Pairs ARCH-DEPLOY-MINIMAL / ARCH-DEPLOY-PERIPHERALS.")),
    ver("FIX-ALLOW-APP-ROLE-SPLIT", FIX + "The same app image started with REQAML_ROLES=sync runs only the sync worker (API/MCP/web endpoints absent, readiness reports sync only). "
        "With all roles enabled it serves API+AS, Web UI, and MCP and runs sync. No rebuild between runs.",
        priority=20, security=sec("CM-7", "Pairs ARCH-DEPLOY-MINIMAL; roles not enabled are not exposed.")),
]

CM2 = sec("CM-2", "CM-2 baseline: one Dockerfile + Compose define the supported local/deploy baseline.")
SUCC = {
    "SEC-DEVENV": ver("SEC-DEVENV.1",
        "Developer environment and deployment topology for ReqAML. Docker Compose is the single supported local stand-up path and runs the fewest containers practical: one multi-role app container (API + internal OAuth AS, Web UI, MCP server, sync worker) "
        "and one peripherals container (Postgres + OpenBao), both built from one Dockerfile. "
        "Hybrid mode (peripherals only, app native with hot reload) and full-container mode are both supported. The clone-to-running path is short and documented, and migrations and the dogfood seed (with seeded dev accounts) load automatically or with one command. "
        "Sign-in goes through the internal AS, keys come from a dev OpenBao, and secrets stay out of source. Production builds ship no dev accounts, default credentials, or dev keys.",
        base="SEC-DEVENV", n=1, priority=None, iteration=None, mint_kind="content"),
    "ARCH-DEVENV-COMPOSE": ver("ARCH-DEVENV-COMPOSE.1",
        "Docker Compose is the single supported developer entry point for ReqAML; the repository includes the Compose file(s) and an env template. "
        "The default stack is 2 containers, both from the repo's single Dockerfile: app (API with internal OAuth 2.1 AS, Web UI, MCP server, sync worker roles; ARCH-DEPLOY-MINIMAL) and peripherals (Postgres + OpenBao; ARCH-DEPLOY-PERIPHERALS). "
        "There is no third-party identity-stub container: local sign-in uses the internal AS with seeded dev accounts (ARCH-DEVENV-IDENTITY.1). "
        "An optional hsm-test profile builds the app with SoftHSM2 to exercise the PKCS#11 KeyProvider path without adding a peripheral container. "
        "Operators do not invent ad-hoc local wiring outside Compose for first-time stand-up.",
        base="ARCH-DEVENV-COMPOSE", n=1, priority=15, iteration="iter-r0", security=CM2, grooming_state="detailed", mint_kind="content"),
    "ARCH-DEVENV-MODES": ver("ARCH-DEVENV-MODES.1",
        "ReqAML supports two Compose-backed run modes. (1) Hybrid: Compose runs only the peripherals container (Postgres + OpenBao), and the app runs natively as one Node process with all roles enabled and hot reload. "
        "(2) Full-container: Compose runs the app container (same image as deployment) plus the peripherals container. "
        "Both modes share the same Compose project, env contract, and OpenBao dev KeyProvider, so developers can switch without re-wiring.",
        base="ARCH-DEVENV-MODES", n=1, priority=15, iteration="iter-r0", security=CM2, grooming_state="detailed", mint_kind="content"),
    "ARCH-DEVENV-PARITY": ver("ARCH-DEVENV-PARITY.1",
        "There is one Dockerfile with multi-stage targets. The app target that full-container dev runs is the same target used for deployment. Dev/prod differences are configuration, enabled roles, and Compose overrides only (ports, env, mounts), never a divergent Dockerfile tree. "
        "The peripherals target is for dev/test only; production runs Postgres and OpenBao as separate units (ARCH-DEPLOY-PERIPHERALS). The hsm-test target (SoftHSM2) is never deployed.",
        base="ARCH-DEVENV-PARITY", n=1, priority=20, iteration="iter-r0", security=CM2, grooming_state="detailed", mint_kind="content"),
    "ARCH-DEVENV-IDENTITY": ver("ARCH-DEVENV-IDENTITY.1",
        "Local development signs in through ReqAML's internal OAuth AS (ARCH-AUTH-AS) with seeded dev local accounts mapped to the dogfood seed identities, so A01/A02 sessions, grants, Scoped View, and MCP authorization can be exercised offline. "
        "Dev account credentials are never committed: they come from the local env file or are generated at first seed and shown locally. "
        "Seeded dev accounts and the dev seed loader are dev-only. Production builds and configs ship no seeded dev accounts and no default credentials, and the seed loader refuses to create accounts in production mode. "
        "In production, enterprise SSO federates through the same AS (ARCH-AUTH-FEDERATION). This replaces the earlier third-party local OIDC stub idea.",
        base="ARCH-DEVENV-IDENTITY", n=1, priority=10, iteration="iter-r0", rbac_op="auth:signin",
        security=sec("CM-7", "CM-7 least functionality; IA-5 default authenticators; ASD V-222662 / V-222661 / V-222642."), grooming_state="detailed", mint_kind="content"),
    "FIX-DENY-DEVENV-PROD-LOGIN": ver("FIX-DENY-DEVENV-PROD-LOGIN.1",
        FIX + "Production build or production configuration: (a) no seeded dev accounts exist, so logging in as a dev account (for example taylor-tester's dev local account) → generic invalid-credentials and an audit failure; "
        "(b) running the dev seed loader in production mode → refused (non-zero exit), no accounts created; (c) the startup self-check finds no default or seeded credentials, and fails startup if it does. "
        "Pairs ARCH-DEVENV-IDENTITY.1 and ARCH-CRED-POLICY.",
        base="FIX-DENY-DEVENV-PROD-LOGIN", n=1, priority=15, rbac_op="auth:local:signin",
        security=sec("CM-7", "CM-7; ASD V-222662 default passwords / V-222661 built-in accounts."), mint_kind="content"),
}

REL = [
    ("ARCH-AUTH-AS", "A01", "refines"), ("ARCH-AUTH-AS", "MC01.1", "refines"), ("ARCH-AUTH-AS", "ARCH-API", "uses"),
    ("ARCH-AUTH-AS", "ARCH-KEY-JWKS", "uses"), ("ARCH-AUTH-AS", "ARCH-CRED-AUDIT", "uses"), ("ARCH-AUTH-AS", "ARCH-DEPLOY-MINIMAL", "uses"),
    ("ARCH-AUTH-PKCE", "ARCH-AUTH-AS", "refines"),
    ("ARCH-AUTH-METADATA", "ARCH-AUTH-AS", "refines"), ("ARCH-AUTH-METADATA", "MC01.1", "refines"),
    ("ARCH-AUTH-AUDIENCE", "ARCH-AUTH-AS", "refines"), ("ARCH-AUTH-AUDIENCE", "MC03", "refines"), ("ARCH-AUTH-AUDIENCE", "ARCH-API-RBAC", "uses"),
    ("ARCH-AUTH-REFRESH", "ARCH-AUTH-AS", "refines"), ("ARCH-AUTH-REFRESH", "ARCH-CRED-TOKENS", "uses"),
    ("ARCH-AUTH-REVOKE", "ARCH-AUTH-AS", "refines"), ("ARCH-AUTH-REVOKE", "A02", "refines"),
    ("ARCH-AUTH-CLIENTREG", "ARCH-AUTH-AS", "refines"), ("ARCH-AUTH-CLIENTREG", "ARCH-CRED-TOKENS", "uses"),
    ("ARCH-AUTH-FEDERATION", "ARCH-AUTH-AS", "refines"), ("ARCH-AUTH-FEDERATION", "A01", "refines"), ("ARCH-AUTH-FEDERATION", "CAP-SSO", "refines"),
    ("ARCH-AUTH-FEDERATION", "A06", "uses"), ("ARCH-AUTH-FEDERATION", "ARCH-CRED-MFA", "uses"),
    ("ARCH-AUTH-LOCAL", "ARCH-AUTH-AS", "refines"), ("ARCH-AUTH-LOCAL", "ARCH-CRED", "uses"),
    ("ARCH-CRED-HASH", "ARCH-CRED", "refines"), ("ARCH-CRED-HASH", "ARCH-KEY-FIPS", "uses"),
    ("ARCH-CRED-POLICY", "ARCH-CRED", "refines"),
    ("ARCH-CRED-LOCKOUT", "ARCH-CRED", "refines"), ("ARCH-CRED-LOCKOUT", "ARCH-AUTH-LOCAL", "refines"),
    ("ARCH-CRED-MFA", "ARCH-CRED", "refines"), ("ARCH-CRED-MFA", "ARCH-KEY-SCOPE", "uses"),
    ("ARCH-CRED-TOKENS", "ARCH-CRED", "refines"), ("ARCH-CRED-TOKENS", "ARCH-KEY-SCOPE", "uses"), ("ARCH-CRED-TOKENS", "M03", "refines"),
    ("ARCH-CRED-SESSION", "ARCH-CRED", "refines"), ("ARCH-CRED-SESSION", "A02", "refines"), ("ARCH-CRED-SESSION", "ARCH-UI-GUARD", "uses"),
    ("ARCH-CRED-REAUTH", "ARCH-CRED", "refines"), ("ARCH-CRED-REAUTH", "D12", "refines"), ("ARCH-CRED-REAUTH", "D13", "refines"),
    ("ARCH-CRED-REAUTH", "ARCH-CAP-APPROVE", "refines"), ("ARCH-CRED-REAUTH", "ARCH-GATE-SIGNOFF", "refines"),
    ("ARCH-CRED-REAUTH", "G05", "refines"), ("ARCH-CRED-REAUTH", "A07", "refines"),
    ("ARCH-CRED-AUDIT", "ARCH-CRED", "refines"), ("ARCH-CRED-AUDIT", "ARCH-OTEL", "refines"),
    ("ARCH-KEY", "ARCH-DEVENV-SECRETS", "refines"),
    ("ARCH-KEY-PROVIDER", "ARCH-KEY", "refines"), ("ARCH-KEY-PROVIDER", "ARCH-DEVENV-SECRETS", "uses"),
    ("ARCH-KEY-SCOPE", "ARCH-KEY", "refines"), ("ARCH-KEY-SCOPE", "M03", "uses"),
    ("ARCH-KEY-JWKS", "ARCH-KEY", "refines"), ("ARCH-KEY-JWKS", "ARCH-KEY-PROVIDER", "uses"),
    ("ARCH-KEY-LIFECYCLE", "ARCH-KEY", "refines"), ("ARCH-KEY-LIFECYCLE", "ARCH-KEY-CUSTODIAN", "uses"), ("ARCH-KEY-LIFECYCLE", "ARCH-OTEL", "uses"),
    ("ARCH-KEY-CUSTODIAN", "ARCH-KEY", "refines"), ("ARCH-KEY-CUSTODIAN", "ARCH-API-RBAC", "uses"), ("ARCH-KEY-CUSTODIAN", "ARCH-CRED-MFA", "uses"),
    ("ARCH-KEY-BREAKGLASS", "ARCH-KEY", "refines"), ("ARCH-KEY-BREAKGLASS", "ARCH-KEY-CUSTODIAN", "uses"),
    ("ARCH-KEY-FIPS", "ARCH-KEY", "refines"),
    ("ARCH-KEY-FAILCLOSED", "ARCH-KEY", "refines"), ("ARCH-KEY-FAILCLOSED", "ARCH-DEVENV-HEALTH", "uses"), ("ARCH-KEY-FAILCLOSED", "M04", "uses"),
    ("ARCH-DEVENV-KEYS", "ARCH-KEY-PROVIDER", "refines"), ("ARCH-DEVENV-KEYS", "ARCH-DEPLOY-PERIPHERALS", "uses"),
    ("ARCH-DEPLOY-MINIMAL", "ARCH-DEVENV-COMPOSE.1", "refines"), ("ARCH-DEPLOY-MINIMAL", "ARCH-API", "uses"), ("ARCH-DEPLOY-MINIMAL", "ARCH-UI", "uses"),
    ("ARCH-DEPLOY-MINIMAL", "CAP-MCP-DESK", "uses"), ("ARCH-DEPLOY-MINIMAL", "M04", "uses"),
    ("ARCH-DEPLOY-PERIPHERALS", "ARCH-DEVENV-COMPOSE.1", "refines"), ("ARCH-DEPLOY-PERIPHERALS", "ARCH-KEY", "uses"),
    ("ARCH-DEVENV-COMPOSE.1", "ARCH-DEPLOY-MINIMAL", "uses"), ("ARCH-DEVENV-COMPOSE.1", "ARCH-DEPLOY-PERIPHERALS", "uses"), ("ARCH-DEVENV-COMPOSE.1", "ARCH-AUTH-AS", "uses"),
    ("ARCH-DEVENV-MODES.1", "ARCH-DEVENV-KEYS", "uses"), ("ARCH-DEVENV-MODES.1", "ARCH-DEPLOY-PERIPHERALS", "uses"),
    ("ARCH-DEVENV-PARITY.1", "ARCH-DEPLOY-MINIMAL", "uses"), ("ARCH-DEVENV-PARITY.1", "ARCH-DEPLOY-PERIPHERALS", "uses"),
    ("ARCH-DEVENV-IDENTITY.1", "A01", "refines"), ("ARCH-DEVENV-IDENTITY.1", "ARCH-AUTH-AS", "uses"),
    ("ARCH-DEVENV-IDENTITY.1", "ARCH-AUTH-LOCAL", "uses"), ("ARCH-DEVENV-IDENTITY.1", "ARCH-DEVENV-SEED", "uses"),
    ("FIX-DENY-DEVENV-PROD-LOGIN.1", "ARCH-DEVENV-IDENTITY.1", "uses"), ("FIX-DENY-DEVENV-PROD-LOGIN.1", "ARCH-CRED-POLICY", "uses"),
    ("FIX-DENY-DEVENV-PROD-LOGIN.1", "A01", "uses"),
    ("ARCH-BUILD-FOUNDATION", "ARCH-UI", "uses"), ("ARCH-BUILD-FOUNDATION", "ARCH-API", "uses"), ("ARCH-BUILD-FOUNDATION", "ARCH-CP-SCOPE", "uses"),
    ("ARCH-BUILD-FOUNDATION", "ARCH-AUTH-AS", "uses"), ("ARCH-BUILD-FOUNDATION", "ARCH-CRED", "uses"), ("ARCH-BUILD-FOUNDATION", "ARCH-KEY", "uses"),
    ("ARCH-BUILD-FOUNDATION", "ARCH-API-RBAC", "uses"), ("ARCH-BUILD-FOUNDATION", "ARCH-OTEL", "uses"), ("ARCH-BUILD-FOUNDATION", "M04", "uses"),
    ("ARCH-BUILD-FOUNDATION", "ARCH-DEVENV-COMPOSE.1", "uses"), ("ARCH-BUILD-FOUNDATION", "ARCH-DEPLOY-MINIMAL", "uses"),
    ("FIX-ALLOW-MCP-OAUTH-PKCE", "ARCH-AUTH-METADATA", "uses"), ("FIX-ALLOW-MCP-OAUTH-PKCE", "ARCH-AUTH-PKCE", "uses"),
    ("FIX-ALLOW-MCP-OAUTH-PKCE", "ARCH-AUTH-AUDIENCE", "uses"), ("FIX-ALLOW-MCP-OAUTH-PKCE", "MC02", "uses"),
    ("FIX-DENY-PKCE-PLAIN", "ARCH-AUTH-PKCE", "uses"),
    ("FIX-DENY-MCP-WRONG-AUDIENCE", "ARCH-AUTH-AUDIENCE", "uses"), ("FIX-DENY-MCP-WRONG-AUDIENCE", "ARCH-AUTH-METADATA", "uses"),
    ("FIX-DENY-UPSTREAM-TOKEN-AT-API", "ARCH-AUTH-FEDERATION", "uses"),
    ("FIX-DENY-REFRESH-REUSE", "ARCH-AUTH-REFRESH", "uses"),
    ("FIX-DENY-REVOKED-TOKEN", "ARCH-AUTH-REVOKE", "uses"), ("FIX-DENY-REVOKED-TOKEN", "A02", "uses"),
    ("FIX-DENY-DCR-DISABLED", "ARCH-AUTH-CLIENTREG", "uses"),
    ("FIX-ALLOW-FEDERATED-SSO-VIA-AS", "ARCH-AUTH-FEDERATION", "uses"), ("FIX-ALLOW-FEDERATED-SSO-VIA-AS", "A01", "uses"),
    ("FIX-DENY-LOCKOUT", "ARCH-CRED-LOCKOUT", "uses"),
    ("FIX-DENY-PRIV-NO-MFA", "ARCH-CRED-MFA", "uses"), ("FIX-DENY-PRIV-NO-MFA", "A07", "uses"),
    ("FIX-DENY-STEPUP-STALE-AUTH", "ARCH-CRED-REAUTH", "uses"), ("FIX-DENY-STEPUP-STALE-AUTH", "D12", "uses"),
    ("FIX-DENY-SESSION-IDLE", "ARCH-CRED-SESSION", "uses"),
    ("FIX-ALLOW-CRED-HASH-ONLY", "ARCH-CRED-HASH", "uses"), ("FIX-ALLOW-CRED-HASH-ONLY", "ARCH-CRED-TOKENS", "uses"), ("FIX-ALLOW-CRED-HASH-ONLY", "ARCH-KEY", "uses"),
    ("FIX-DENY-KEK-UNREACHABLE-PROD", "ARCH-KEY-FAILCLOSED", "uses"),
    ("FIX-DENY-DEV-KEK-IN-PROD", "ARCH-DEVENV-KEYS", "uses"),
    ("FIX-JWKS-ROTATION-OVERLAP", "ARCH-KEY-JWKS", "uses"),
    ("FIX-DENY-KEYOP-NO-CUSTODIAN", "ARCH-KEY-CUSTODIAN", "uses"),
    ("FIX-ALLOW-KEK-REWRAP-ONLINE", "ARCH-KEY-LIFECYCLE", "uses"),
    ("FIX-ALLOW-DEVENV-MIN-CONTAINERS", "ARCH-DEPLOY-MINIMAL", "uses"), ("FIX-ALLOW-DEVENV-MIN-CONTAINERS", "ARCH-DEPLOY-PERIPHERALS", "uses"),
    ("FIX-ALLOW-DEVENV-MIN-CONTAINERS", "ARCH-DEVENV-MODES.1", "uses"),
    ("FIX-ALLOW-APP-ROLE-SPLIT", "ARCH-DEPLOY-MINIMAL", "uses"),
]

def stig(*ids):
    return [(i, STIG) for i in ids]


def nist(*ids):
    return [(i, NIST) for i in ids]


CONF = {
    "ARCH-AUTH-AS": nist("IA-2", "IA-5", "IA-8", "SC-23") + stig("V-222522"),
    "ARCH-AUTH-PKCE": nist("IA-2.8") + stig("V-222530", "V-222531"),
    "ARCH-AUTH-METADATA": nist("SC-23"),
    "ARCH-AUTH-AUDIENCE": nist("AC-3", "SC-23"),
    "ARCH-AUTH-REFRESH": nist("SC-23", "IA-5"),
    "ARCH-AUTH-REVOKE": nist("AC-12") + stig("V-222549", "V-222578", "V-222391"),
    "ARCH-AUTH-CLIENTREG": nist("CM-7", "AU-2"),
    "ARCH-AUTH-FEDERATION": nist("IA-2", "IA-8") + stig("V-222400", "V-222401", "V-222403", "V-222404", "V-222522"),
    "ARCH-AUTH-LOCAL": nist("AC-2", "IA-2") + stig("V-222407", "V-222412", "V-222661"),
    "ARCH-CRED": nist("IA-5"),
    "ARCH-CRED-HASH": nist("IA-5.1", "SC-13") + stig("V-222542", "V-222543", "V-222554", "V-222571"),
    "ARCH-CRED-POLICY": nist("IA-5.1") + stig("V-222536", "V-222537", "V-222538", "V-222539", "V-222540", "V-222541",
                                              "V-222544", "V-222545", "V-222546", "V-222547", "V-222548", "V-222662"),
    "ARCH-CRED-LOCKOUT": nist("AC-7") + stig("V-222432", "V-222433", "V-222462"),
    "ARCH-CRED-MFA": nist("IA-2.1") + stig("V-222523", "V-222527"),
    "ARCH-CRED-TOKENS": nist("IA-5.6", "SC-28.1") + stig("V-222542"),
    "ARCH-CRED-SESSION": nist("AC-12", "AC-2.5", "AC-10", "SC-23", "SC-23.3")
        + stig("V-222387", "V-222389", "V-222390", "V-222575", "V-222576", "V-222577", "V-222579", "V-222581", "V-222582", "V-222583"),
    "ARCH-CRED-REAUTH": nist("IA-11") + stig("V-222520"),
    "ARCH-CRED-AUDIT": nist("AU-2", "AU-3", "AU-12") + stig("V-222462", "V-222441", "V-222442", "V-222443", "V-222445", "V-222467"),
    "ARCH-KEY": nist("SC-12", "SC-28", "SC-28.1", "SC-28.3"),
    "ARCH-KEY-PROVIDER": nist("IA-7", "SC-12") + stig("V-222555"),
    "ARCH-KEY-SCOPE": nist("SC-28.1") + stig("V-222588", "V-222589", "V-222642"),
    "ARCH-KEY-JWKS": nist("SC-12.3", "SC-13") + stig("V-222570"),
    "ARCH-KEY-LIFECYCLE": nist("SC-12", "SC-12.2", "SC-12.3", "AU-2"),
    "ARCH-KEY-CUSTODIAN": nist("AC-5", "AC-6"),
    "ARCH-KEY-BREAKGLASS": nist("SC-12.1", "AC-5"),
    "ARCH-KEY-FIPS": nist("SC-13") + stig("V-222570", "V-222571", "V-222572", "V-222583"),
    "ARCH-KEY-FAILCLOSED": nist("SC-24", "SC-12.1"),
    "ARCH-DEVENV-KEYS": nist("CM-7") + stig("V-222642"),
    "ARCH-DEPLOY-MINIMAL": nist("CM-2", "CM-7"),
    "ARCH-DEPLOY-PERIPHERALS": nist("SC-28.3", "SC-12", "CP-9"),
    "ARCH-BUILD-FOUNDATION": nist("SA-8"),
    "ARCH-DEVENV-COMPOSE.1": nist("CM-2"),
    "ARCH-DEVENV-MODES.1": nist("CM-2"),
    "ARCH-DEVENV-PARITY.1": nist("CM-2"),
    "ARCH-DEVENV-IDENTITY.1": nist("CM-7", "IA-2", "IA-5") + stig("V-222662", "V-222661", "V-222642"),
    "FIX-DENY-DEVENV-PROD-LOGIN.1": nist("CM-7") + stig("V-222662", "V-222661"),
    "FIX-ALLOW-MCP-OAUTH-PKCE": nist("IA-2"),
    "FIX-DENY-PKCE-PLAIN": nist("IA-2.8") + stig("V-222530"),
    "FIX-DENY-MCP-WRONG-AUDIENCE": nist("SC-23"),
    "FIX-DENY-UPSTREAM-TOKEN-AT-API": nist("IA-2"),
    "FIX-DENY-REFRESH-REUSE": nist("SC-23"),
    "FIX-DENY-REVOKED-TOKEN": nist("AC-12") + stig("V-222578"),
    "FIX-DENY-DCR-DISABLED": nist("CM-7"),
    "FIX-ALLOW-FEDERATED-SSO-VIA-AS": nist("IA-8"),
    "FIX-DENY-LOCKOUT": nist("AC-7") + stig("V-222432"),
    "FIX-DENY-PRIV-NO-MFA": nist("IA-2.1") + stig("V-222523"),
    "FIX-DENY-STEPUP-STALE-AUTH": nist("IA-11") + stig("V-222520"),
    "FIX-DENY-SESSION-IDLE": nist("AC-12") + stig("V-222389"),
    "FIX-ALLOW-CRED-HASH-ONLY": nist("IA-5.1") + stig("V-222542"),
    "FIX-DENY-KEK-UNREACHABLE-PROD": nist("SC-24"),
    "FIX-DENY-DEV-KEK-IN-PROD": nist("CM-7"),
    "FIX-JWKS-ROTATION-OVERLAP": nist("SC-12.3"),
    "FIX-DENY-KEYOP-NO-CUSTODIAN": nist("AC-5"),
    "FIX-ALLOW-KEK-REWRAP-ONLINE": nist("SC-12"),
    "FIX-ALLOW-DEVENV-MIN-CONTAINERS": nist("CM-2"),
    "FIX-ALLOW-APP-ROLE-SPLIT": nist("CM-7"),
}

ARTIFACTS = [
    ("ARCH-AUTH-METADATA", "../c4/sequences/AS01-mcp-oauth-authorize.puml"),
    ("ARCH-AUTH-AUDIENCE", "../c4/sequences/AS01-mcp-oauth-authorize.puml"),
    ("ARCH-CRED-LOCKOUT", "../c4/sequences/AS02-local-login-lockout-mfa.puml"),
    ("ARCH-CRED-MFA", "../c4/sequences/AS02-local-login-lockout-mfa.puml"),
    ("ARCH-AUTH-FEDERATION", "../c4/sequences/AS03-federated-sso-via-as.puml"),
    ("ARCH-KEY-LIFECYCLE", "../c4/sequences/KS01-kek-rotate-dek-rewrap.puml"),
    ("ARCH-KEY-JWKS", "../c4/sequences/KS02-token-signing-keyprovider.puml"),
]


def ae(id_, at, who, action, outcome, status, notes, client="raby-family", project="reqaml"):
    return cm(id=id_, at=at, identity_id=who, client_id=client, project_id=project, action=action,
              outcome=outcome, http_status=status, notes=notes)


AUDIT = [
    ae("ae-deny-pkce-plain", "2026-10-07T09:00:00-04:00", "alex-author", "auth:oauth:authorize", "deny", 400,
       "FIX-DENY-PKCE-PLAIN sample row: code_challenge_method=plain rejected (invalid_request)."),
    ae("ae-deny-mcp-wrong-audience", "2026-10-07T09:05:00-04:00", "alex-author", "auth:token:validate", "deny", 401,
       "FIX-DENY-MCP-WRONG-AUDIENCE sample row: aud=API token at MCP server."),
    ae("ae-auth-lockout-taylor", "2026-10-07T09:10:00-04:00", "taylor-tester", "auth:local:lockout", "deny", 401,
       "FIX-DENY-LOCKOUT sample row: threshold reached; account locked (generic error to client)."),
    ae("ae-deny-refresh-reuse", "2026-10-07T09:15:00-04:00", "alex-author", "auth:oauth:token", "deny", 400,
       "FIX-DENY-REFRESH-REUSE sample row: rotated refresh token replayed; family revoked."),
    ae("ae-deny-keyop-pat", "2026-10-07T09:20:00-04:00", "pat-client-admin", "key:kek:rotate", "deny", 403,
       "FIX-DENY-KEYOP-NO-CUSTODIAN sample row: deployment-scoped key op; no client/project scope.", client=None, project=None),
    ae("ae-key-kek-rotate-kim", "2026-10-07T09:25:00-04:00", "kim-key-custodian", "key:kek:rotate", "allow", 200,
       "FIX-ALLOW-KEK-REWRAP-ONLINE sample row: KEK v1->v2 via OpenBao Transit; DEK re-wrap started. No key material logged.", client=None, project=None),
]

CAT_ENTRIES = [
    ("REQAML-SEC-OAUTH", "Internal OAuth 2.1 AS is the single token issuer for UI, API, and MCP (PKCE S256, audience-bound tokens)"),
    ("REQAML-SEC-CRED", "Credential store controls: salted one-way hashes, lockout, MFA for privileged roles, hashed server-side tokens"),
    ("REQAML-SEC-KEYS", "Envelope encryption under an external KeyProvider (OpenBao Transit default); custodian-gated key ops"),
]

KIM = cm(id="kim-key-custodian", external_sub="oidc:kim-key-custodian", email="kim.keycustodian@therabyfamily.com",
         display_name="Kim Key-Custodian")
PLATFORM_GRANT = cm(id="pgrant-kim-key-custodian", identity_id="kim-key-custodian", role="Key custodian", scope="deployment",
                    notes="Deployment-scoped Key custodian (ARCH-KEY-CUSTODIAN); distinct from Client/Project admin (AC-5). Grants no requirement-content access.")

FOUNDATION_DELIVERS = [
    "ARCH-BUILD-FOUNDATION",
    "ARCH-AUTH-AS", "ARCH-AUTH-PKCE", "ARCH-AUTH-METADATA", "ARCH-AUTH-AUDIENCE", "ARCH-AUTH-REFRESH", "ARCH-AUTH-REVOKE",
    "ARCH-AUTH-CLIENTREG", "ARCH-AUTH-FEDERATION", "ARCH-AUTH-LOCAL",
    "ARCH-CRED", "ARCH-CRED-HASH", "ARCH-CRED-POLICY", "ARCH-CRED-LOCKOUT", "ARCH-CRED-MFA", "ARCH-CRED-TOKENS",
    "ARCH-CRED-SESSION", "ARCH-CRED-REAUTH", "ARCH-CRED-AUDIT",
    "ARCH-KEY", "ARCH-KEY-PROVIDER", "ARCH-KEY-SCOPE", "ARCH-KEY-JWKS", "ARCH-KEY-LIFECYCLE", "ARCH-KEY-CUSTODIAN",
    "ARCH-KEY-BREAKGLASS", "ARCH-KEY-FIPS", "ARCH-KEY-FAILCLOSED",
    "ARCH-DEPLOY-MINIMAL", "ARCH-DEPLOY-PERIPHERALS",
    "ARCH-DEVENV-COMPOSE.1", "ARCH-DEVENV-MODES.1", "ARCH-DEVENV-PARITY.1", "ARCH-DEVENV-IDENTITY.1", "ARCH-DEVENV-KEYS",
    "ARCH-DEVENV-CLONE", "ARCH-DEVENV-SEED", "ARCH-DEVENV-SECRETS", "ARCH-DEVENV-HEALTH",
    "ARCH-API-LAYERS", "ARCH-API-RBAC", "ARCH-UI-GUARD", "M04",
]

LINE_RETITLE = {
    "SEC-DEVENV": "Developer environment & deployment topology",
    "ARCH-DEVENV-COMPOSE": "Compose is the single supported dev entry point (app + peripherals)",
    "ARCH-DEVENV-MODES": "Hybrid (peripherals only + native app) and full-container run modes",
    "ARCH-DEVENV-PARITY": "Single Dockerfile; app target matches deployment image",
    "ARCH-DEVENV-IDENTITY": "Seeded dev accounts on the internal AS; none in production",
    "FIX-DENY-DEVENV-PROD-LOGIN": "No seeded dev accounts or default credentials in production",
}


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


def ensure_edge(edges, edge):
    key = (edge.get("from"), edge.get("to"), edge.get("kind"), edge.get("catalog_imprint_id"))
    for e in edges:
        if (e.get("from"), e.get("to"), e.get("kind"), e.get("catalog_imprint_id")) == key:
            return 0
    edges.append(edge)
    return 1


def main() -> int:
    data = yaml.load(DOGFOOD)
    lines, versions, edges = data["requirement_lines"], data["requirement_versions"], data["edges"]
    n_lines = sum(upsert(lines, "base_uid", ln) for ln in LINES)
    for bu, title in LINE_RETITLE.items():
        find(lines, "base_uid", bu)["title"] = title
    n_vers = sum(upsert(versions, "uid", v) for v in V)

    # Content successors (.1). DEVENV lines carry no ApprovalRecord, so nothing to clear
    # (no planning_blocked). Pass 1: add .1, prior -> superseded. Pass 2: retarget inbound
    # uses/refines/satisfies from still-live versions to .1 (re-reviewed in this change, so
    # not left suspect); copy prior's outbound uses/refines onto .1 (mapped to successors);
    # .1 refines prior (repo convention, e.g. A12.1 -> A12).
    succ_map = {p: nv["uid"] for p, nv in SUCC.items()}
    for prior_uid, nv in SUCC.items():
        prior = find(versions, "uid", prior_uid)
        assert prior is not None, prior_uid
        n_vers += upsert(versions, "uid", nv)
        prior["status"] = "superseded"
    dead = {v["uid"] for v in versions if v.get("status") in ("superseded", "withdrawn")}
    for e in edges:
        if e.get("kind") in ("uses", "refines", "satisfies") and e.get("to") in succ_map \
                and e.get("from") not in dead and e.get("from") != succ_map[e["to"]]:
            e["to"] = succ_map[e["to"]]
    for prior_uid, new_uid in succ_map.items():
        for e in list(edges):
            if e.get("from") == prior_uid and e.get("kind") in ("uses", "refines"):
                ensure_edge(edges, cm(**{"from": new_uid, "to": succ_map.get(e["to"], e["to"]), "kind": e["kind"]}))
        ensure_edge(edges, cm(**{"from": new_uid, "to": prior_uid, "kind": "refines"}))
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
        assert f in uids, f
        for item, imp in items:
            n_edges += ensure_edge(edges, cm(**{"from": f, "to": item, "kind": "conforms_to", "catalog_imprint_id": imp}))

    arts = data["capability_artifacts"]
    for uid, uri in ARTIFACTS:
        if not any(a.get("requirement_version_uid") == uid and a.get("uri") == uri for a in arts):
            arts.append(cm(requirement_version_uid=uid, kind="other", uri=uri))

    for a in AUDIT:
        upsert(data["audit_events"], "id", a)

    cat = find(data["catalogs"], "id", "cat-reqaml-security")
    for eid, title in CAT_ENTRIES:
        upsert(cat["entries"], "id", cm(id=eid, title=title))

    upsert(data["identities"], "id", KIM)
    if "platform_grants" not in data:
        idx = list(data.keys()).index("client_grants") + 1
        data.insert(idx, "platform_grants", [])
    upsert(data["platform_grants"], "id", PLATFORM_GRANT)

    for u in FOUNDATION_DELIVERS:
        assert u in uids, u
    rel = cm(id="rel-r1-foundation-shell-auth", project_id="reqaml", name="R1-foundation-shell-auth",
             planned_on=None, shipped_on=None, status="planned", delivers=list(FOUNDATION_DELIVERS),
             notes="Build sequencing only (ARCH-BUILD-FOUNDATION): first implementation slice = platform shell + internal OAuth AS + local accounts/credential store + key store + RBAC + audit + health + minimal-container Compose. No v1 scope cut. planned_on / cyber_gate pending Dan (open-questions).")
    rels = data["releases"]
    if find(rels, "id", rel["id"]) is None:
        rels.insert(1, rel)
    else:
        upsert(rels, "id", rel)

    yaml.dump(data, DOGFOOD)
    print(f"patched: new_lines={n_lines} new_versions={n_vers} new_edges={n_edges} "
          f"total_lines={len(lines)} total_versions={len(versions)} total_edges={len(edges)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
