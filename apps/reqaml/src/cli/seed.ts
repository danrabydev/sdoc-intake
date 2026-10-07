import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { getPool, closePool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { readDogfoodFile, loadDogfoodSeed } from "../seed/load-dogfood.js";

const config = loadConfig();
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const seedPath = path.isAbsolute(config.REQAML_SEED_PATH)
  ? config.REQAML_SEED_PATH
  : path.resolve(repoRoot, config.REQAML_SEED_PATH);

const pool = getPool(config.DATABASE_URL);
await runMigrations(pool);
const seed = await readDogfoodFile(seedPath);
const result = await loadDogfoodSeed(pool, config, seed);
console.log(JSON.stringify({ seedPath, ...result }, null, 2));
await closePool();
