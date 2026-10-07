import { loadConfig } from "../config.js";
import { getPool, closePool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

const config = loadConfig();
const pool = getPool(config.DATABASE_URL);
const applied = await runMigrations(pool);
console.log(
  applied.length
    ? `Applied migrations: ${applied.join(", ")}`
    : "Migrations up to date",
);
await closePool();
