import type pg from "pg";
import type { AppConfig } from "../config.js";
import { ensureBootstrapClients } from "./clients.js";
import { authProfileFromEnv, loadAuthProfile, validateAuthProfileStartup } from "./profile.js";
import { issuerUrl } from "./resources.js";
import type { KeyProvider } from "../key/provider.js";
import { ensureSigningKeys } from "../key/signing.js";

export async function bootstrapAuth(
  pool: pg.Pool,
  config: AppConfig,
  keyProvider: KeyProvider,
): Promise<void> {
  const envProfile = authProfileFromEnv(config);
  await pool.query(
    `
    UPDATE auth_profile
    SET identity_mode = $1, local_accounts = $2, updated_at = now()
    WHERE id = 'default'
  `,
    [envProfile.identityMode, envProfile.localAccounts],
  );
  const profile = await loadAuthProfile(pool);
  const errors = validateAuthProfileStartup(config, profile);
  if (errors.length) {
    throw new Error(`Auth profile self-check failed:\n- ${errors.join("\n- ")}`);
  }
  const iss = issuerUrl(config);
  await ensureBootstrapClients(pool, iss);
  await ensureSigningKeys(pool, keyProvider);
}
