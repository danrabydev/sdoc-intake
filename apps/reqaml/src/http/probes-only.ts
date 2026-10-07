import Fastify from "fastify";
import type { RuntimeState } from "./server.js";

/** Minimal HTTP surface for sync-only role (FIX-ALLOW-APP-ROLE-SPLIT). */
export async function buildProbesServer(state: RuntimeState) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({
    status: "ok" as const,
    version: state.config.REQAML_VERSION,
    mode: state.config.REQAML_MODE,
  }));

  app.get("/ready", async (_req, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {
      sync: { ok: state.syncRunning },
    };
    const ready = state.syncRunning;
    const body = { ready, roles: [...state.roles], checks };
    if (!ready) return reply.code(503).send(body);
    return body;
  });

  return app;
}
