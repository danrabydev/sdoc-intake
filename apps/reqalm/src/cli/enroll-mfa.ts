import { loadConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { createOpenBaoKeyProvider } from "../key/provider.js";
import { startMfaEnrollment, confirmMfaEnrollment } from "../auth/mfa-enroll.js";
import { normalizeUsername } from "../credential/username.js";

const identityArg = process.argv[2];
const quiet = process.argv.includes("--quiet");
const confirmCode = process.argv.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length);
const ticketArg = process.argv.find((a) => a.startsWith("--ticket="))?.slice("--ticket=".length);

if (!identityArg) {
  console.error("Usage: pnpm devenv:mfa <identity-id> [--quiet] [--confirm=123456]");
  process.exit(1);
}

const config = loadConfig();
const pool = getPool(config.DATABASE_URL);
const keyProvider = createOpenBaoKeyProvider(config);

const username = normalizeUsername(`${identityArg}@dev.local`);
const row = await pool.query<{ identity_id: string }>(
  `SELECT identity_id FROM local_credentials WHERE username = $1`,
  [username],
);
if (!row.rowCount) {
  console.error(`No local credential for ${username}. Seed the database first.`);
  process.exit(1);
}
const identityId = row.rows[0].identity_id;

if (process.env.REQALM_MFA_DEV_SECRET && !confirmCode) {
  const { storeMfaSecret } = await import("../credential/mfa.js");
  await storeMfaSecret(pool, keyProvider, identityId, process.env.REQALM_MFA_DEV_SECRET);
  if (!quiet) {
    console.log(`MFA enrolled for ${identityId} using REQALM_MFA_DEV_SECRET from devenv.env`);
  }
  process.exit(0);
}

if (confirmCode) {
  // Confirm the ticket printed by the earlier interactive run (its secret is the one in the
  // authenticator); starting a new ticket here would generate a different secret.
  if (!ticketArg) {
    console.error("--confirm needs --ticket=<id> from the interactive run");
    process.exit(1);
  }
  const ok = await confirmMfaEnrollment(pool, keyProvider, ticketArg, confirmCode);
  if (!ok.ok || ok.identityId !== identityId) {
    console.error("MFA confirmation failed");
    process.exit(1);
  }
  console.log(`MFA enrolled for ${identityId}`);
  process.exit(0);
}

const enroll = await startMfaEnrollment(pool, keyProvider, identityId, username);
console.log(enroll.otpauthUri);
console.log(`Enrollment ticket: ${enroll.ticketId}`);
console.log(`Confirm with: pnpm devenv:mfa ${identityArg} --ticket=${enroll.ticketId} --confirm=<6-digit-code>`);
await pool.end();
