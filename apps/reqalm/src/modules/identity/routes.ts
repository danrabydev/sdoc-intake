import type { FastifyInstance } from "fastify";
import { defineOperationRoute } from "../../http/define-operation-route.js";
import type { OperationDef } from "../../core/operation.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import { ok } from "../../core/service-result.js";
import { buildMeDto, type MeDto } from "./me.service.js";

const meOp: OperationDef<Record<string, never>, MeDto> = {
  name: "identity.me",
  execute: async (ctx) => buildMeDto(ctx),
};

export function registerIdentityRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/me",
    op: meOp,
    parseInput: () => ok({}),
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
  });
}
