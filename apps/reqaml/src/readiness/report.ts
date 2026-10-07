import path from "node:path";
import { access } from "node:fs/promises";
import type pg from "pg";
import type { AppConfig, AppRole } from "../config.js";
import type { SyncHandle } from "../roles/sync-worker.js";
import { ProbeCache } from "./cache.js";
import { checkDatabase } from "./checks/database.js";
import { checkMigrationsCurrent } from "./checks/migrations.js";
import { checkOpenBaoLive } from "./checks/openbao.js";
import {
  checkApiRole,
  checkMcpRole,
  checkSyncRole,
  checkWebRole,
  type RoleAssetPaths,
} from "./checks/roles.js";
import type { ReadinessReport } from "./types.js";

export type ReadinessContext = {
  config: AppConfig;
  pool: pg.Pool;
  roles: Set<AppRole>;
  sync: SyncHandle | null;
  roleAssets: RoleAssetPaths;
  cache: ProbeCache;
  probeTimeoutMs: number;
};

export async function buildReadinessReport(
  ctx: ReadinessContext,
): Promise<ReadinessReport> {
  const checks: ReadinessReport["checks"] = {};

  checks.database = await ctx.cache.get("database", () =>
    checkDatabase(ctx.pool),
  );

  checks.migrations = await ctx.cache.get("migrations", () =>
    checkMigrationsCurrent(ctx.pool),
  );

  if (ctx.config.OPENBAO_ADDR) {
    checks.openbao = await ctx.cache.get("openbao", () =>
      checkOpenBaoLive(ctx.config, ctx.probeTimeoutMs),
    );
  }

  const api = await checkApiRole(ctx.roles, ctx.roleAssets);
  if (api) checks.api = api;

  const web = await checkWebRole(ctx.roles, ctx.roleAssets);
  if (web) checks.web = web;

  const mcp = await checkMcpRole(ctx.roles, ctx.roleAssets);
  if (mcp) checks.mcp = mcp;

  const sync = checkSyncRole(ctx.roles, ctx.sync);
  if (sync) checks.sync = sync;

  const ready = Object.values(checks).every((c) => c.ok);
  return {
    ready,
    roles: [...ctx.roles],
    checks,
  };
}

export async function defaultRoleAssets(
  cwd: string = process.cwd(),
): Promise<RoleAssetPaths> {
  const distWeb = path.join(cwd, "dist/web/public/index.html");
  let webIndexPath = path.join(cwd, "src/web/public/index.html");
  try {
    await access(distWeb);
    webIndexPath = distWeb;
  } catch {
    /* use src path */
  }
  return {
    openapiPath: path.join(cwd, "openapi/openapi.yaml"),
    webIndexPath,
    apiRoutesMounted: false,
    mcpRouteMounted: false,
  };
}
