import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type pg from "pg";
import type { AppConfig, AppRole } from "../config.js";
import { getSeedSummary } from "../seed/load-dogfood.js";
import type { KeyProviderStatus } from "../key/openbao.js";

export type RuntimeState = {
  config: AppConfig;
  pool: pg.Pool;
  roles: Set<AppRole>;
  openbao: KeyProviderStatus;
  syncRunning: boolean;
};

export async function buildApiServer(state: RuntimeState) {
  const { config, roles } = state;
  const app = Fastify({ logger: true });

  const openapiPath = path.join(process.cwd(), "openapi/openapi.yaml");
  const openapiSpec = await readFile(openapiPath, "utf8");

  await app.register(fastifySwagger, {
    mode: "static",
    specification: { path: openapiPath, baseDir: path.dirname(openapiPath) },
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
  });

  app.get("/health", async () => ({
    status: "ok" as const,
    version: config.REQAML_VERSION,
    mode: config.REQAML_MODE,
  }));

  app.get("/ready", async (_req, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};
    try {
      await state.pool.query("SELECT 1");
      checks.database = { ok: true };
    } catch (err) {
      checks.database = {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    if (config.OPENBAO_ADDR) {
      checks.openbao = {
        ok: state.openbao.ok,
        detail: state.openbao.detail,
      };
    }

    if (roles.has("api")) checks.api = { ok: true };
    if (roles.has("web")) checks.web = { ok: true };
    if (roles.has("mcp")) checks.mcp = { ok: true };
    if (roles.has("sync")) {
      checks.sync = { ok: state.syncRunning };
    }

    const ready = Object.values(checks).every((c) => c.ok);
    const body = {
      ready,
      roles: [...roles],
      checks,
    };
    if (!ready) {
      return reply.code(503).send(body);
    }
    return body;
  });

  if (roles.has("api")) {
    app.get("/api/v1/seed/summary", async () => getSeedSummary(state.pool));
  }

  if (roles.has("mcp")) {
    app.post("/mcp", async () => ({
      jsonrpc: "2.0",
      result: { message: "MCP role stub — OAuth wiring in a later slice" },
      id: null,
    }));
  }

  if (roles.has("web")) {
    const webRoot = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../web/public",
    );
    await app.register(fastifyStatic, {
      root: webRoot,
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
