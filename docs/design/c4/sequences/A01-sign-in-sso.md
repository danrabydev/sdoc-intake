# A01 — Sign in via SSO (OIDC/SAML)

| Field | Value |
|-------|--------|
| Status | draft |
| RBAC op | `auth:signin` (TBD — lock with Dan) |
| Diagram | [A01-sign-in-sso.puml](./A01-sign-in-sso.puml) |

## Step → control → rationale

Authoritative mapping for reviewers. Keep in sync with `ControlNote` / `ComplianceNote` calls in the diagram.

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST IA-2(1), IA-2(8); STIG TBD (ASD V6R4) | User reaches sign-in only through enterprise SSO; product does not maintain local passwords. |
| 2 | NIST AC-3; STIG TBD | Route guard blocks protected routes until authenticated. |
| 3 | NIST IA-2, IA-8; STIG TBD | Federated identity provider performs primary authentication. |
| 4 | NIST IA-2(1), IA-2(2); STIG TBD | MFA and re-auth policies enforced at IdP. |
| 5 | NIST IA-5; STIG TBD | Browser handles short-lived tokens; no embedding of secrets in client bundle. |
| 6 | NIST SC-8, IA-5; STIG TBD | Callback over TLS; API validates token authenticity before session creation. |
| 7 | NIST IA-2, SC-23; STIG TBD | Signature / issuer validation against IdP metadata. |
| 8 | NIST AC-3, AC-6; STIG TBD | Session reflects verified identity with least privilege. |
| 9 | NIST AC-2, AC-3; STIG TBD | RBAC gate at sign-in (`auth:signin`) before granting app access. |
| 10 | NIST AU-2, AU-3, AU-12; STIG TBD | Record auditable sign-in success (subject, time, source, outcome). |
| 11 | NIST AU-6, AU-12; STIG TBD | Forward audit events to OTEL for monitoring and review. |
| 12 | Retention / Marsy's Law (TBD) | Deployment-specific retention and lawful logging; pin in ops runbook. |
| 13 | NIST AC-12; STIG TBD | Session cookie / handle with server-enforced timeout and logout path. |

## Notes

- STIG rule IDs remain **TBD** until mapped from `data/catalog/asd-stig-v6r4.sdoc` (or successor imprint).
- When status moves to **locked**, RBAC op and STIG columns must be filled — no TBD.
