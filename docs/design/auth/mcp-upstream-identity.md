# MCP integrations and the user's upstream identity provider

**Status:** design options, **deliberately not locked** (2026-10-07). Only the settled parts are encoded as requirements. Everything else is listed in [`../roles/open-questions.md` §5](../roles/open-questions.md).

**Dan, 2026-10-07:** "We don't have to [have local accounts], but we will need an oauth method for mcp integrations. That may pass through the user's provider, but that has to be thought about. It's not always that simple... but could be."

## 1. What is settled (encoded)

| Requirement | Settled rule |
|-------------|--------------|
| ARCH-AUTH-MCP-REQUIRED | OAuth 2.1 through the **internal AS** is mandatory for MCP in **every** identity mode (federated, local, hybrid). The MCP server accepts only internal-AS tokens with `aud` = MCP resource. |
| ARCH-AUTH-PROFILE / ARCH-AUTH-LOCAL.1 | Local password accounts are an auth-profile option, **off by default in production** (`local_accounts=disabled`). A01's "no local password store" remains the default posture, so A01 is **not** minted. Allowed uses: dev (seeded accounts), break-glass recovery admin, or an explicit profile opt-in. |
| ARCH-AUTH-LOCAL-BREAKGLASS | Break-glass local recovery admin: profile-enabled only, MFA, dual-control custody (like ARCH-KEY-BREAKGLASS), recovery-scoped, alerted, audited. |
| ARCH-AUTH-UPSTREAM-CONNECTOR | Upstream IdPs attach through a **pluggable connector**. Each connector is registered to **one client tenant**. Its assertions cannot establish access in another tenant. Connector secrets are held in the key store. |
| ARCH-AUTH-CLAIM-MAP | Claim-to-identity (and, optionally, grant) mapping is explicit, versioned, audited config. The identity key is issuer + subject. A mapping never crosses tenants and never grants deployment roles. Until an open question is decided, claims establish identity and MFA evidence only, and grants come from ReqALM grant records. |
| ARCH-AUTH-UPSTREAM-REVOKE | Upstream back-channel logout / SLO is honored where supported. ReqALM lifetimes are capped by a per-connector maximum upstream authentication age. Disable or unlink is immediate. |
| ARCH-AUTH-AGENT-ATTRIBUTION | Every MCP action is audited as **human `sub` + OAuth `client_id` + `jti` + `source=mcp`**. There is no agent-only principal; headless clients are unsupported until decided. |
| ARCH-AUTH-AUDIENCE (existing) | No token passthrough. Tokens are audience-bound per resource. |

Fixtures: FIX-DENY-LOCAL-LOGIN-PROFILE-OFF, FIX-ALLOW-BREAKGLASS-LOCAL-ADMIN, FIX-ALLOW-MCP-OAUTH-FEDERATED-ONLY, FIX-DENY-UPSTREAM-LOGOUT-PROPAGATED, FIX-DENY-CROSS-TENANT-CONNECTOR, FIX-ALLOW-AGENT-ATTRIBUTION, plus the existing FIX-DENY-UPSTREAM-TOKEN-AT-API.

## 2. Two different problems

"Pass through the user's provider" can mean two separate things. Keeping them apart removes most of the confusion:

1. **Signing in to ReqALM's MCP server (inbound).** Who is this agent acting for, and what may it do *in ReqALM*? This is settled: the internal AS issues the MCP token, and the user may authenticate upstream (options a / a′).
2. **ReqALM calling the provider's own APIs on the user's behalf (outbound).** For example, an MCP tool that reads the user's Azure DevOps work items, Microsoft Graph, or GitHub. This is **not** settled: options b and c below.

## 3. Options

### (a) Brokered federation (current default; encoded)

The MCP host authorizes at the ReqALM AS. The AS redirects the user to the tenant's upstream IdP (OIDC RP / SAML SP), validates the response, maps issuer + subject to a ReqALM identity, and issues **its own** audience-bound token. Sequences: [AS01](../c4/sequences/AS01-mcp-oauth-authorize.puml) + [AS03](../c4/sequences/AS03-federated-sso-via-as.puml).

| Pros | Cons |
|------|------|
| Works with any OIDC or SAML IdP. One token format and one revocation point. Matches the MCP spec exactly. MFA can stay at the IdP. | ReqALM gets an identity, not upstream API access. The user may see two consent steps (IdP + ReqALM AS). Upstream logout needs propagation (ARCH-AUTH-UPSTREAM-REVOKE). |

### (a′) IdP-driven variant: MCP Enterprise-Managed Authorization (ID-JAG)

The MCP extension `io.modelcontextprotocol/enterprise-managed-authorization` (stable) builds on draft-ietf-oauth-identity-assertion-authz-grant:
1. The MCP host signs in to the enterprise IdP.
2. The host performs an RFC 8693 token exchange **at the IdP** for an Identity Assertion JWT Authorization Grant (ID-JAG) targeted at ReqALM's AS and MCP resource.
3. The host redeems the ID-JAG at the ReqALM AS (RFC 7523 JWT bearer grant).
4. The ReqALM AS validates the ID-JAG and still issues its **own** aud=MCP token.

This is the cleanest sanctioned form of "pass through the user's provider". The IdP centrally decides which MCP servers the user may reach, without per-server consent.

| Pros | Cons |
|------|------|
| Zero-touch for enterprise users. IdP policy (groups, conditional access) gates MCP access. Still no passthrough, because the ReqALM AS mints the MCP token. | Requires IdP support for ID-JAG (Okta and others; not universal). The MCP host must support the extension. Trust config per IdP issuer. It is an addition to (a), not a replacement. |

### (b) Token exchange (RFC 8693) for outbound provider APIs

When a tool must call the provider's API, the ReqALM MCP/API role exchanges a token **at the provider's AS** (or the IdP's, for example Entra on-behalf-of) for a token whose audience is the provider API, scoped to that call. ReqALM keeps nothing long-lived.

| Pros | Cons |
|------|------|
| No stored upstream refresh tokens. Short-lived, narrowly scoped, and auditable. Respects upstream policy at every call. | Needs a **subject token the provider trusts**. The ReqALM-issued token is not one, so ReqALM must hold the user's upstream token from sign-in (which drifts toward (c)), or the provider must trust ReqALM's AS as an issuer (cross-domain trust, identity chaining). Provider support varies (Entra OBO is proprietary-ish; many SaaS have none). Fails offline or in background sync. |

### (c) Stored upstream grants (connector-style)

ReqALM runs a per-user, per-provider OAuth consent ("Connect Azure DevOps") and stores the provider refresh token **encrypted under a DEK wrapped by the KeyProvider** (ARCH-KEY-SCOPE already lists connector tokens). Tools and the sync worker mint short-lived provider access tokens as needed.

| Pros | Cons |
|------|------|
| Works with any OAuth provider. Supports background sync (J04/J05) and offline. Explicit, revocable per-user consent. This is how the ADO connector would likely work anyway. | ReqALM becomes custodian of long-lived upstream credentials (a high-value target, which raises key-store and audit stakes). Consent UX per provider. Must handle upstream revocation, scope drift, and user offboarding. More AS surface (a client of each provider). |

### (d) Direct passthrough: **rejected**

The MCP host sends the user's upstream IdP or provider token straight to the ReqALM MCP server, which accepts it or forwards it.

**Rejected** because the MCP authorization spec (2026-07-28) states that MCP servers "MUST only accept tokens specifically intended for themselves", "MUST NOT accept or transit any other tokens", and "MUST NOT pass through the token it received from the MCP client". Beyond the spec:
- **Confused deputy:** a token minted for another audience would be honored by ReqALM.
- **Bypassed controls:** ReqALM's own RBAC, audience checks, revocation, and audit attribution would be skipped.
- **Lost guarantees:** ReqALM could not bound lifetime or scope.
- **Leaked authority:** any ReqALM compromise would leak the user's full upstream authority.

Encoded as ARCH-AUTH-AUDIENCE, ARCH-AUTH-MCP-REQUIRED, and FIX-DENY-UPSTREAM-TOKEN-AT-API.

## 4. Hard cases

| Case | Current position | Open? |
|------|------------------|-------|
| **Non-OIDC / SAML-only IdPs** | The SAML 2.0 SP is built into the connector interface, and the AS still mints OAuth tokens (option a). SAML gives no upstream API token, so (b) is unavailable; outbound access needs (c). LDAP/Kerberos/RADIUS-only shops would need a bridge IdP or a custom connector. | Which non-OIDC/SAML protocols to support natively (if any). |
| **Multiple IdPs per client tenant** | Each connector is bound to exactly one tenant (encoded). A user may need to reach several tenants with different IdPs. Cross-tenant access stays a ReqALM grant, never a connector side effect. | Cardinality (one vs many connectors per tenant); home-realm discovery (email domain, tenant picker, `login_hint`); one deployment-wide connector for platform roles (Key custodian, break-glass)? |
| **Consent and scope mapping** | Upstream claims map to identity explicitly (issuer + subject). Grants come from ReqALM records only for now. MCP OAuth scopes are coarse and RBAC decides. | Auto-provisioning grants from upstream groups (JIT/SCIM)? MCP scope vocabulary (for example `reqalm:read`, `reqalm:draft`) and the consent screen? |
| **Upstream session end / revocation** | Back-channel logout / SLO honored where supported; maximum upstream authentication age caps refresh; ReqALM disable is immediate (encoded). | IdPs without back-channel logout: SCIM deprovision, periodic userinfo check, or rely on the max age? Should (c) stored grants be revoked when the upstream sign-in session ends? |
| **Refresh lifetimes vs upstream** | ReqALM refresh ≤ connector maximum authentication age; rotation and reuse detection (ARCH-AUTH-REFRESH). | Default values; whether MCP refresh tokens get a shorter cap than the UI's. |
| **Step-up MFA when the IdP does MFA** | ARCH-CRED-MFA / REAUTH: the AS requires amr/acr evidence and, for step-up, re-redirects upstream with `max_age` / `prompt=login` / `acr_values`. | Mapping of IdP-specific `acr` values per connector. What to do if the IdP does not emit amr/acr: refuse privileged ops or trust a connector-level assertion? |
| **Headless / agent MCP clients** | Not supported until decided. Every MCP token today is user-delegated (ARCH-AUTH-AGENT-ATTRIBUTION). | Choose among: **device authorization grant** (RFC 8628; still user-delegated, good for CLI agents); **OAuth client credentials** (MCP extension `io.modelcontextprotocol/oauth-client-credentials`, `private_key_jwt` preferred) as a service principal, which needs a non-human principal kind, grants, and attribution to an owning human; or EMA (a′). |
| **Audit attribution of agent actions** | `identity_id` = human `sub`, plus `oauth_client_id`, `jti`, `source=mcp` (encoded; sample `ae-mcp-update-draft-attrib`). | For service principals: the owner/approver field, and whether "agent on behalf of X" is shown in UI history. |

## 5. Suggested direction (not locked)

1. Keep **(a)** as the baseline. It is already encoded and needed for every deployment.
2. Add **(a′) EMA/ID-JAG** as an optional per-connector capability when an enterprise client asks for zero-touch MCP.
3. For outbound provider APIs, prefer **(c)** for long-running connectors (Azure DevOps sync already needs it) and **(b)** only where the provider supports exchange against a token ReqALM legitimately holds. Decide per provider, not globally.
4. Keep **(d)** permanently rejected.

## 6. Diagrams

- [AS01](../c4/sequences/AS01-mcp-oauth-authorize.puml): MCP OAuth at the internal AS.
- [AS03](../c4/sequences/AS03-federated-sso-via-as.puml): brokered federation, now with tenant connector, claim mapping, step-up, and back-channel logout.
- [AS04](../c4/sequences/AS04-mcp-upstream-api-access.puml): **proposal.** An MCP tool reaching a provider API via (b) token exchange vs (c) stored upstream grant. It shows that the MCP token is never forwarded.
