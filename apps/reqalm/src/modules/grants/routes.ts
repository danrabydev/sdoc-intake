import type { FastifyInstance } from "fastify";
import { mapServiceResultToHttp } from "../../core/http-envelope.js";
import { runOperation } from "../../core/operation.js";
import { buildRequestContext, type RequestContextDeps } from "../../core/request-context.js";
import { grantManageStub } from "./grants.service.js";

const grantManageOp = {
  name: "grants.manage",
  permission: "grant:manage",
  projectScoped: true,
  projectIdFromInput: (input: { projectId: string }) => input.projectId,
  auditMeta: (input: { projectId: string }) => ({
    projectId: input.projectId,
    targetType: "project",
    targetId: input.projectId,
  }),
  execute: grantManageStub,
};

export function registerGrantRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  app.post(
    "/api/v1/projects/:projectId/grants",
    {
      config: { reqalmSecurity: { kind: "permission", permission: "grant:manage" } },
      schema: {
        tags: ["grants"],
        summary: "Manage project grants (stub — authorize only)",
        params: {
          type: "object",
          required: ["projectId"],
          properties: { projectId: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const ctx = await buildRequestContext(req, { ...deps, logger: req.log });
      const projectId = (req.params as { projectId: string }).projectId;
      const result = await runOperation(ctx, grantManageOp, { projectId });
      return mapServiceResultToHttp(reply, ctx.requestId, result);
    },
  );
}
