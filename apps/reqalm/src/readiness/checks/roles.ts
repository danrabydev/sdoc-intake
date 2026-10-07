import { access } from "node:fs/promises";
import type { AppRole } from "../../config.js";
import type { SyncHandle } from "../../roles/sync-worker.js";
import type { CheckResult } from "../types.js";

export type RoleAssetPaths = {
  openapiPath: string;
  webIndexPath: string;
  apiRoutesMounted: boolean;
  mcpRouteMounted: boolean;
};

async function pathReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function checkApiRole(
  roles: Set<AppRole>,
  assets: RoleAssetPaths,
): Promise<CheckResult | null> {
  if (!roles.has("api")) return null;
  if (!assets.apiRoutesMounted) {
    return { ok: false, detail: "API routes not mounted" };
  }
  if (!(await pathReadable(assets.openapiPath))) {
    return { ok: false, detail: "OpenAPI spec missing or unreadable" };
  }
  return { ok: true };
}

export async function checkWebRole(
  roles: Set<AppRole>,
  assets: RoleAssetPaths,
): Promise<CheckResult | null> {
  if (!roles.has("web")) return null;
  if (!(await pathReadable(assets.webIndexPath))) {
    return { ok: false, detail: "Web static root missing or unreadable" };
  }
  return { ok: true };
}

export async function checkMcpRole(
  roles: Set<AppRole>,
  assets: RoleAssetPaths,
): Promise<CheckResult | null> {
  if (!roles.has("mcp")) return null;
  if (!assets.mcpRouteMounted) {
    return { ok: false, detail: "MCP route not mounted" };
  }
  return { ok: true };
}

export function checkSyncRole(
  roles: Set<AppRole>,
  sync: SyncHandle | null,
): CheckResult | null {
  if (!roles.has("sync")) return null;
  if (!sync?.isRunning()) {
    return { ok: false, detail: "Sync worker not running" };
  }
  return { ok: true };
}
