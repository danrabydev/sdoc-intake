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

const KNOWN_ARGS = new Set(["--confirm", "--dry-run"]);
const argv = process.argv.slice(2);
const args = new Set(argv);
const confirm = args.has("--confirm");
const dryRun = args.has("--dry-run");

function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

const unknown = argv.filter((a) => !KNOWN_ARGS.has(a));
if (unknown.length) {
  refuse(`Refusing dogfood seed reset: unknown argument(s) ${unknown.join(" ")} (use --dry-run or --confirm)`);
}
if (!confirm && !dryRun) {
  refuse("Refusing dogfood seed reset: pass --dry-run to print the plan or --confirm to wipe and reload");
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

// Guard first, on the raw environment, before config parsing or any database connection.
try {
  assertSeedResetAllowed({ databaseUrl: process.env.DATABASE_URL, env: process.env, repoRoot });
} catch (err) {
  if (err instanceof SeedResetRefusedError) refuse(err.message);
  throw err;
}

const config = loadConfig();
const seedPath = path.isAbsolute(config.REQALM_SEED_PATH)
  ? config.REQALM_SEED_PATH
  : path.resolve(repoRoot, config.REQALM_SEED_PATH);

const seed = await readDogfoodFile(seedPath);
const pool = getPool(config.DATABASE_URL);
// --dry-run stays read-only; the schema is migrated only for a confirmed reset.
if (!dryRun) await runMigrations(pool);

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

try {
  const actor =
    process.env.REQALM_SEED_RESET_ACTOR?.trim() || process.env.USER?.trim() || undefined;
  const result = await resetDogfoodSeed(pool, config, seed, {
    confirm: true,
    seedPath,
    repoRoot,
    actor,
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
