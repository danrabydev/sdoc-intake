import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { getPool, closePool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { readDogfoodFile } from "../seed/load-dogfood.js";
import {
  assertSeedResetAllowed,
  formatSeedResetPlan,
  resetDogfoodSeed,
  SeedResetRefusedError,
  summarizeSeedReset,
} from "../seed/seed-reset.js";

const args = new Set(process.argv.slice(2));
const confirm = args.has("--confirm");
const dryRun = args.has("--dry-run");

const config = loadConfig();
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const seedPath = path.isAbsolute(config.REQALM_SEED_PATH)
  ? config.REQALM_SEED_PATH
  : path.resolve(repoRoot, config.REQALM_SEED_PATH);

try {
  assertSeedResetAllowed({ config, env: process.env, repoRoot });
} catch (err) {
  if (err instanceof SeedResetRefusedError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const pool = getPool(config.DATABASE_URL);
await runMigrations(pool);
const seed = await readDogfoodFile(seedPath);

const client = await pool.connect();
let plan;
try {
  plan = await summarizeSeedReset(client, seed, seedPath);
} finally {
  client.release();
}

console.log(formatSeedResetPlan(plan));

if (dryRun) {
  await closePool();
  process.exit(0);
}

if (!confirm) {
  console.error("\nRefusing to reset without --confirm (see plan above).");
  await closePool();
  process.exit(1);
}

try {
  const actor =
    process.env.REQALM_SEED_RESET_ACTOR?.trim() ||
    process.env.USER?.trim() ||
    "devenv-cli";
  const result = await resetDogfoodSeed(pool, config, seed, {
    confirm: true,
    seedPath,
    repoRoot,
    actorIdentityId: actor,
  });
  console.log(JSON.stringify({ seedPath, ...result }, null, 2));
} catch (err) {
  if (err instanceof SeedResetRefusedError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
} finally {
  await closePool();
}
