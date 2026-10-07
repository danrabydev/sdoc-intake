import Fastify from "fastify";
import type { RuntimeState } from "./server.js";
import { registerProbeRoutes } from "./routes-probes.js";

/** Minimal HTTP surface for sync-only role (FIX-ALLOW-APP-ROLE-SPLIT). */
export async function buildProbesServer(state: RuntimeState) {
  const app = Fastify({ logger: true });
  registerProbeRoutes(app, state.config, state.readiness);
  return app;
}
