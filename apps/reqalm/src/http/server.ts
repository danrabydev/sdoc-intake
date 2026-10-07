import { readFile } from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import type pg from "pg";
import type { AppConfig, AppRole } from "../config.js";
import { bootstrapAuth } from "../auth/bootstrap.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { loadAuthProfile } from "../auth/profile.js";
import { createOpenBaoKeyProvider, type KeyProvider } from "../key/provider.js";
import { getSeedSummary } from "../seed/load-dogfood.js";
import { resolveWebIndexPath } from "../readiness/paths.js";
import type { ReadinessContext } from "../readiness/report.js";
import type { SyncHandle } from "../roles/sync-worker.js";
import { registerProbeRoutes } from "./routes-probes.js";
import { createBearerGuard, type AuthedRequest } from "./middleware/bearer-auth.js";
import { installRouteCapture } from "./route-security.js";
import { registerFeatureModules } from "../modules/register.js";
import { requestIdFromHeaders } from "../telemetry/request-id.js";

export type RuntimeState = {
  config: AppConfig;
  pool: pg.Pool;
  roles: Set<AppRole>;
  sync: SyncHandle | null;
  readiness: ReadinessContext;
  /** Test seam: inject an in-memory KeyProvider instead of OpenBao. */
  keyProvider?: KeyProvider;
  /** Test seam: capture structured logs from Fastify. */
  testLogger?: import("fastify").FastifyBaseLogger;
};

export async function buildApiServer(state: RuntimeState) {
  const { config, pool, roles, readiness } = state;
  const app = Fastify({
    logger: state.testLogger ?? {
      level: "info",
      serializers: {
        req(req) {
          const url = req.url?.replace(/([?&]code=)[^&]+/gi, "$1[REDACTED]");
          return { method: req.method, url, host: req.host };
        },
      },
    },
    genReqId: (req) => requestIdFromHeaders(req.headers),
    // Trust X-Forwarded-* only from the listed proxies; never blanket trust in production
    // (startup self-check refuses REQALM_TRUST_PROXY=true without REQALM_TRUSTED_PROXIES).
    trustProxy:
      config.REQALM_TRUST_PROXY === true
        ? config.REQALM_TRUSTED_PROXIES
          ? config.REQALM_TRUSTED_PROXIES.split(",").map((s) => s.trim()).filter(Boolean)
          : true
        : false,
  });
  const keyProvider = state.keyProvider ?? createOpenBaoKeyProvider(config);

  await app.register(fastifyCookie);
  await app.register(fastifyFormbody);

  const openapiPath = path.join(process.cwd(), "openapi/openapi.yaml");
  const openapiSpec = await readFile(openapiPath, "utf8");

  installRouteCapture(app);

  registerProbeRoutes(app, config, readiness);

  await bootstrapAuth(pool, config, keyProvider);
  const profile = await loadAuthProfile(pool);
  await registerAuthRoutes(app, {
    config,
    pool,
    keyProvider,
    profile,
  });

  await app.register(fastifySwagger, {
    mode: "static",
    specification: { path: openapiPath, baseDir: path.dirname(openapiPath) },
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
  });

  const apiGuard = createBearerGuard(pool, config, "api");
  const mcpGuard = createBearerGuard(pool, config, "mcp");

  if (roles.has("api")) {
    readiness.roleAssets.apiRoutesMounted = true;

    app.get(
      "/api/v1/seed/summary",
      { config: { reqalmSecurity: { kind: "public" } } },
      async () => getSeedSummary(state.pool),
    );

    const ctxDeps = { pool, config, keyProvider, logger: app.log };
    registerFeatureModules(app, ctxDeps);
  }

  if (roles.has("mcp")) {
    readiness.roleAssets.mcpRouteMounted = true;
    app.post(
      "/mcp",
      {
        preHandler: mcpGuard,
        config: { reqalmSecurity: { kind: "authenticated" } },
      },
      async (req: AuthedRequest) => ({
        jsonrpc: "2.0",
        result: {
          message: "MCP authorized",
          subject: req.accessToken?.sub,
          audience: req.accessToken?.aud,
        },
        id: null,
      }),
    );
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
      if (
        req.url.startsWith("/login") ||
        req.url.startsWith("/mfa") ||
        req.url.startsWith("/consent") ||
        req.url.startsWith("/app")
      ) {
        return reply.sendFile("index.html");
      }
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => {
    app.log.info("HTTP server closing");
  });

  void openapiSpec;
  void keyProvider;

  return app;
}
