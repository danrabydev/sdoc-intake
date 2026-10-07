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
import { authProfileFromEnv, loadAuthProfile } from "../auth/profile.js";
import { createOpenBaoKeyProvider } from "../key/provider.js";
import { getSeedSummary } from "../seed/load-dogfood.js";
import { resolveWebIndexPath } from "../readiness/paths.js";
import type { ReadinessContext } from "../readiness/report.js";
import type { SyncHandle } from "../roles/sync-worker.js";
import { registerProbeRoutes } from "./routes-probes.js";
import {
  createBearerGuard,
  type AuthedRequest,
} from "./middleware/bearer-auth.js";
import { authorize } from "../rbac/enforce.js";
import { writeAuthAudit } from "../audit/auth-audit.js";

export type RuntimeState = {
  config: AppConfig;
  pool: pg.Pool;
  roles: Set<AppRole>;
  sync: SyncHandle | null;
  readiness: ReadinessContext;
};

export async function buildApiServer(state: RuntimeState) {
  const { config, pool, roles, readiness } = state;
  const app = Fastify({ logger: true, trustProxy: true });
  const keyProvider = createOpenBaoKeyProvider(config);

  await app.register(fastifyCookie);
  await app.register(fastifyFormbody);

  const openapiPath = path.join(process.cwd(), "openapi/openapi.yaml");
  const openapiSpec = await readFile(openapiPath, "utf8");

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

    app.get("/api/v1/seed/summary", async () => getSeedSummary(state.pool));

    app.get(
      "/api/v1/me",
      { preHandler: apiGuard },
      async (req: AuthedRequest) => {
        const sub = req.accessToken!.sub!;
        const grants = await pool.query(
          `
          SELECT project_id, role FROM project_grants
          WHERE identity_id = $1 AND revoked_at IS NULL
        `,
          [sub],
        );
        return {
          identity_id: sub,
          auth_profile: authProfileFromEnv(config),
          grants: grants.rows,
        };
      },
    );

    app.post(
      "/api/v1/projects/:projectId/grants",
      { preHandler: apiGuard },
      async (req: AuthedRequest, reply) => {
        const sub = req.accessToken!.sub!;
        const projectId = (req.params as { projectId: string }).projectId;
        const allowed = await authorize(pool, sub, "grant:manage", projectId);
        if (!allowed) {
          await writeAuthAudit(pool, {
            eventType: "rbac.deny",
            outcome: "deny",
            identityId: sub,
            detail: { permission: "grant:manage", projectId },
            ip: req.ip,
          });
          return reply.code(403).send({ error: "forbidden" });
        }
        return reply.send({ ok: true, message: "grant manage authorized (stub)" });
      },
    );
  }

  if (roles.has("mcp")) {
    readiness.roleAssets.mcpRouteMounted = true;
    app.post(
      "/mcp",
      { preHandler: mcpGuard },
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
