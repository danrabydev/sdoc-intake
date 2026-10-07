import { readFile } from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type pg from "pg";
import type { AppConfig, AppRole } from "../config.js";
import { getSeedSummary } from "../seed/load-dogfood.js";
import { resolveWebIndexPath } from "../readiness/paths.js";
import type { ReadinessContext } from "../readiness/report.js";
import type { SyncHandle } from "../roles/sync-worker.js";
import { registerProbeRoutes } from "./routes-probes.js";

export type RuntimeState = {
  config: AppConfig;
  pool: pg.Pool;
  roles: Set<AppRole>;
  sync: SyncHandle | null;
  readiness: ReadinessContext;
};

export async function buildApiServer(state: RuntimeState) {
  const { config, roles, readiness } = state;
  const app = Fastify({ logger: true });

  const openapiPath = path.join(process.cwd(), "openapi/openapi.yaml");
  const openapiSpec = await readFile(openapiPath, "utf8");

  registerProbeRoutes(app, config, readiness);

  await app.register(fastifySwagger, {
    mode: "static",
    specification: { path: openapiPath, baseDir: path.dirname(openapiPath) },
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
  });

  if (roles.has("api")) {
    readiness.roleAssets.apiRoutesMounted = true;
    app.get("/api/v1/seed/summary", async () => getSeedSummary(state.pool));
  }

  if (roles.has("mcp")) {
    readiness.roleAssets.mcpRouteMounted = true;
    app.post("/mcp", async () => ({
      jsonrpc: "2.0",
      result: { message: "MCP role stub — OAuth wiring in a later slice" },
      id: null,
    }));
  }

  if (roles.has("web")) {
    const webIndex = await resolveWebIndexPath();
    const root = path.dirname(webIndex);
    await app.register(fastifyStatic, {
      root,
      prefix: "/",
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/mcp")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => {
    app.log.info("HTTP server closing");
  });

  void openapiSpec;

  return app;
}
