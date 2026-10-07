import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { ReadinessContext } from "../readiness/report.js";
import { buildReadinessReport } from "../readiness/report.js";

/**
 * Liveness vs readiness (ARCH-DEVENV-HEALTH / M04):
 * - /health — process is up; does not call Postgres or OpenBao (orchestrator liveness).
 * - /ready — live dependency + role checks; may return 503 when peripherals fail (routing readiness).
 */
export function registerProbeRoutes(
  app: FastifyInstance,
  config: AppConfig,
  readiness: ReadinessContext,
): void {
  app.get("/health", async () => ({
    status: "ok" as const,
    version: config.REQAML_VERSION,
    mode: config.REQAML_MODE,
  }));

  app.get("/ready", async (_req, reply) => {
    const body = await buildReadinessReport(readiness);
    if (!body.ready) {
      return reply.code(503).send(body);
    }
    return body;
  });
}
