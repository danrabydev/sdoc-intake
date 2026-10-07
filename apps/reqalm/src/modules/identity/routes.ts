import type { FastifyInstance } from "fastify";
import { mapServiceResultToHttp } from "../../core/http-envelope.js";
import { runAuthenticated } from "../../core/operation.js";
import { buildRequestContext, type RequestContextDeps } from "../../core/request-context.js";
import { buildMeDto } from "./me.service.js";

export function registerIdentityRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  app.get(
    "/api/v1/me",
    {
      config: { reqalmSecurity: { kind: "authenticated" } },
      schema: {
        tags: ["identity"],
        summary: "Current principal, grants, and effective roles",
        response: {
          200: {
            type: "object",
            required: ["data", "request_id"],
            properties: {
              data: { type: "object", additionalProperties: true },
              request_id: { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const ctx = await buildRequestContext(req, { ...deps, logger: req.log });
      const result = await runAuthenticated(ctx, "identity.me", buildMeDto);
      return mapServiceResultToHttp(reply, ctx.requestId, result);
    },
  );
}
