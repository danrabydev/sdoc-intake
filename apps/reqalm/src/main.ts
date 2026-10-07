import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type AppRole } from "./config.js";
import { closePool, getPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { buildApiServer } from "./http/server.js";
import { buildProbesServer } from "./http/probes-only.js";
import { ProbeCache } from "./readiness/cache.js";
import { defaultRoleAssets } from "./readiness/report.js";
import type { ReadinessContext } from "./readiness/report.js";
import { readDogfoodFile, loadDogfoodSeed } from "./seed/load-dogfood.js";
import { runStartupSelfCheck } from "./startup/self-check.js";
import { waitForPeripherals } from "./startup/wait-for-peripherals.js";
import { startSyncWorker, type SyncHandle } from "./roles/sync-worker.js";

function resolveSeedPath(config: ReturnType<typeof loadConfig>): string {
  if (path.isAbsolute(config.REQALM_SEED_PATH)) {
    return config.REQALM_SEED_PATH;
  }
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  return path.resolve(repoRoot, config.REQALM_SEED_PATH);
}

async function bootstrap() {
  const config = loadConfig();
  const roles = new Set<AppRole>(config.REQALM_ROLES);
  const pool = getPool(config.DATABASE_URL);

  await waitForPeripherals(config, pool);
  await runMigrations(pool);

  await runStartupSelfCheck(config, pool);

  if (config.REQALM_SEED_ON_START) {
    const seed = await readDogfoodFile(resolveSeedPath(config));
    await loadDogfoodSeed(pool, config, seed);
  }

  let sync: SyncHandle | null = null;
  if (roles.has("sync")) {
    sync = startSyncWorker(config);
  }

  const readiness: ReadinessContext = {
    config,
    pool,
    roles,
    sync,
    roleAssets: await defaultRoleAssets(),
    cache: new ProbeCache(config.REQALM_READY_CACHE_MS),
    probeTimeoutMs: config.REQALM_READY_PROBE_TIMEOUT_MS,
  };

  const state = {
    config,
    pool,
    roles,
    sync,
    readiness,
  };

  const apiSurface =
    roles.has("api") || roles.has("web") || roles.has("mcp");
  const app = apiSurface
    ? await buildApiServer(state)
    : await buildProbesServer(state);
  const host = "0.0.0.0";
  await app.listen({ port: config.REQALM_PORT, host });

  process.on("SIGTERM", async () => {
    sync?.stop();
    await app.close();
    await closePool();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
