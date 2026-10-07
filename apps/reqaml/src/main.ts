import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type AppRole } from "./config.js";
import { closePool, getPool, pingDatabase } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { checkOpenBao } from "./key/openbao.js";
import { buildApiServer, type RuntimeState } from "./http/server.js";
import { buildProbesServer } from "./http/probes-only.js";
import { readDogfoodFile, loadDogfoodSeed } from "./seed/load-dogfood.js";
import { runStartupSelfCheck } from "./startup/self-check.js";
import { startSyncWorker, type SyncHandle } from "./roles/sync-worker.js";

function resolveSeedPath(config: ReturnType<typeof loadConfig>): string {
  if (path.isAbsolute(config.REQAML_SEED_PATH)) {
    return config.REQAML_SEED_PATH;
  }
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  return path.resolve(repoRoot, config.REQAML_SEED_PATH);
}

async function bootstrap() {
  const config = loadConfig();
  const roles = new Set<AppRole>(config.REQAML_ROLES);
  const pool = getPool(config.DATABASE_URL);

  await pingDatabase(config.DATABASE_URL);
  await runMigrations(pool);

  if (config.REQAML_SEED_ON_START) {
    const seed = await readDogfoodFile(resolveSeedPath(config));
    await loadDogfoodSeed(pool, config, seed);
  }

  await runStartupSelfCheck(config, pool);

  const openbao = await checkOpenBao(config);
  let sync: SyncHandle | null = null;
  if (roles.has("sync")) {
    sync = startSyncWorker(config);
  }

  const state: RuntimeState = {
    config,
    pool,
    roles,
    openbao,
    syncRunning: Boolean(sync),
  };

  const apiSurface =
    roles.has("api") || roles.has("web") || roles.has("mcp");
  const app = apiSurface
    ? await buildApiServer(state)
    : await buildProbesServer(state);
  const host = "0.0.0.0";
  await app.listen({ port: config.REQAML_PORT, host });

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
