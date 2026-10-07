import type pg from "pg";
import type { AppConfig } from "../config.js";
import { isProduction } from "../config.js";

export type LocalAccountsMode = "disabled" | "breakglass_only" | "enabled";
export type IdentityMode = "federated" | "local" | "hybrid";

export type AuthProfile = {
  identityMode: IdentityMode;
  localAccounts: LocalAccountsMode;
};

export function authProfileFromEnv(config: AppConfig): AuthProfile {
  const localRaw =
    (process.env.REQAML_AUTH_LOCAL_ACCOUNTS as LocalAccountsMode | undefined) ??
    (isProduction(config) ? "disabled" : "enabled");
  const identityRaw =
    (process.env.REQAML_AUTH_IDENTITY_MODE as IdentityMode | undefined) ??
    (isProduction(config) ? "federated" : "hybrid");

  return {
    identityMode: identityRaw,
    localAccounts: localRaw,
  };
}

export async function loadAuthProfile(pool: pg.Pool): Promise<AuthProfile> {
  const r = await pool.query<{
    identity_mode: IdentityMode;
    local_accounts: LocalAccountsMode;
  }>("SELECT identity_mode, local_accounts FROM auth_profile WHERE id = 'default'");
  if (!r.rowCount) {
    return { identityMode: "hybrid", localAccounts: "enabled" };
  }
  return {
    identityMode: r.rows[0].identity_mode,
    localAccounts: r.rows[0].local_accounts,
  };
}

export function localLoginAllowed(profile: AuthProfile): boolean {
  return profile.localAccounts === "enabled" || profile.localAccounts === "breakglass_only";
}

export function validateAuthProfileStartup(
  config: AppConfig,
  profile: AuthProfile,
): string[] {
  const errors: string[] = [];
  if (isProduction(config)) {
    if (profile.localAccounts === "enabled") {
      errors.push(
        "Production auth profile must not set local_accounts=enabled (use disabled or breakglass_only)",
      );
    }
    if (profile.identityMode === "local") {
      errors.push("Production auth profile must not set identity_mode=local alone");
    }
  }
  return errors;
}
