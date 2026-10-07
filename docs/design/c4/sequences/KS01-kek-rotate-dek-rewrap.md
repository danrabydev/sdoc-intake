# KS01 — KEK rotation with online DEK re-wrap

Covers the Key custodian (or the scheduled system principal) rotating the key-encryption key in OpenBao Transit and re-wrapping every data-encryption key online. The minimum decryption version is raised only after verification. Rotation goes through the standard pipeline (RbacCheck → HookEval → GateCheck → mutate → HookEffectsAfter → AuditLog) with KeyOp steps. If the KeyProvider is unreachable in production, the app fails closed.

| Field | Value |
|-------|--------|
| Status | draft |
| Requirements | ARCH-KEY, ARCH-KEY-PROVIDER, ARCH-KEY-LIFECYCLE, ARCH-KEY-CUSTODIAN, ARCH-KEY-FAILCLOSED, ARCH-CRED-REAUTH |
| Fixtures | FIX-ALLOW-KEK-REWRAP-ONLINE, FIX-DENY-KEYOP-NO-CUSTODIAN, FIX-DENY-KEK-UNREACHABLE-PROD |
| RBAC ops | `key:kek:rotate`, `key:dek:rewrap` (deployment-scoped Key custodian) |
| Macros | RbacCheck, HookEval, GateCheck, KeyOp, HookEffectsAfter, AuditLog |
| Diagram | [KS01-kek-rotate-dek-rewrap.puml](./KS01-kek-rotate-dek-rewrap.puml) |

| Step | Control | Rationale |
|------|---------|-----------|
| 1 | NIST AC-5, AC-6 | Only the deployment-scoped Key custodian may rotate. A Client admin gets 403. |
| 2 | NIST IA-2(1), IA-11; STIG V-222520 | Key operations are privileged, so they need MFA and recent authentication (step-up). |
| 3 | NIST SC-12, SC-12(2); STIG V-222555 | The new KEK version is created inside OpenBao and is never exported. |
| 4 | NIST SC-28(1), SC-28(3); STIG V-222588 | DEKs are re-wrapped with Transit rewrap, so plaintext is never exposed. Only wrapped DEKs are persisted, and the service stays online throughout. |
| 5 | NIST SC-12 | `min_decryption_version` is raised only after every DEK is verified at v2. Destroy is a separate custodian operation. |
| 6 | NIST AU-2, AU-3, AU-12; STIG V-222462 | Every key operation is audited. Key material is never logged. |
| 7 | NIST SC-24, SC-12(1) | If the KeyProvider is unreachable or sealed in production, the app returns 503 and stays not-ready. There is no fallback. |
