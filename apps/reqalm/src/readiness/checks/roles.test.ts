import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  checkApiRole,
  checkMcpRole,
  checkSyncRole,
  checkWebRole,
} from "./roles.js";
import { startSyncWorker } from "../../roles/sync-worker.js";
import { loadConfig } from "../../config.js";

test("checkApiRole fails when OpenAPI file missing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reqalm-role-"));
  const result = await checkApiRole(new Set(["api"]), {
    openapiPath: path.join(dir, "missing.yaml"),
    webIndexPath: path.join(dir, "index.html"),
    apiRoutesMounted: true,
    mcpRouteMounted: false,
  });
  assert.equal(result?.ok, false);
});

test("checkWebRole succeeds when index exists", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reqalm-role-"));
  const index = path.join(dir, "index.html");
  await writeFile(index, "<html></html>");
  const result = await checkWebRole(new Set(["web"]), {
    openapiPath: path.join(dir, "o.yaml"),
    webIndexPath: index,
    apiRoutesMounted: false,
    mcpRouteMounted: false,
  });
  assert.equal(result?.ok, true);
});

test("checkMcpRole fails when route not mounted", async () => {
  const result = await checkMcpRole(new Set(["mcp"]), {
    openapiPath: "o.yaml",
    webIndexPath: "i.html",
    apiRoutesMounted: false,
    mcpRouteMounted: false,
  });
  assert.equal(result?.ok, false);
});

test("checkSyncRole fails after stop", async () => {
  const cfg = loadConfig({ DATABASE_URL: "postgresql://u:p@localhost/db" });
  const sync = startSyncWorker(cfg);
  sync.stop();
  const result = checkSyncRole(new Set(["sync"]), sync);
  assert.equal(result?.ok, false);
});
