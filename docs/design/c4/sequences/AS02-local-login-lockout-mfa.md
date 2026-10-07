# AS02 — Local account login with lockout and MFA

How a local account (seeded in dev, optionally in prod — see open questions) signs in through the internal AS: lockout and throttling, password verification against salted one-way hashes, MFA for privileged roles, session timeouts, and step-up for approvals and pin applies.

| Field | Value |
|-------|--------|
| Status | draft |
| Requirements | ARCH-AUTH-LOCAL, ARCH-CRED-*, ARCH-CRED-LOCKOUT, ARCH-CRED-MFA, ARCH-CRED-SESSION, ARCH-CRED-REAUTH, ARCH-CRED-HASH |
| Fixtures | FIX-DENY-LOCKOUT, FIX-DENY-PRIV-NO-MFA, FIX-DENY-STEPUP-STALE-AUTH, FIX-DENY-SESSION-IDLE, FIX-ALLOW-CRED-HASH-ONLY |
| RBAC ops | `auth:local:signin`, `auth:account:unlock`, `project:grant:create`, `requirement:line:approve`, `catalog:pin:apply` |
| Macros | LockoutCheck, MfaChallenge, AuthAuditLog, TokenValidate (via API) |
| Diagram | [AS02-local-login-lockout-mfa.puml](./AS02-local-login-lockout-mfa.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST IA-2, AC-2; STIG V-222407, V-222412 | Local accounts authenticate at the internal AS. The issuer is the same as for federated SSO. |
| 2 | NIST AC-7, IA-5(1); STIG V-222432, V-222433, V-222462 | Lockout and throttling run before or with password verification. Errors are generic so accounts cannot be enumerated. |
| 3 | NIST IA-5(1), SC-13; STIG V-222542, V-222543 | Passwords are stored as Argon2id or PBKDF2 with salt and configurable params. Plaintext is never stored. |
| 4 | NIST IA-2(1), IA-11; STIG V-222523, V-222527, V-222520 | Privileged roles need MFA. Approvals and pin applies need a fresh `auth_time` (step-up). |
| 5 | NIST AC-12, AC-2(5), SC-23; STIG V-222389, V-222390 | Sessions have idle and absolute timeouts. Session and refresh secrets are hashed server-side. |
| 6 | NIST AU-2, AU-3, AU-12 | Sign-in, lockout, MFA, and session events go through the AuditLog pattern. No secrets are logged. |
