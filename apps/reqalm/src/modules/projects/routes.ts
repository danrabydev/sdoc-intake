import type { FastifyInstance } from "fastify";
import { mapServiceResultToHttp } from "../../core/http-envelope.js";
import { runOperation } from "../../core/operation.js";
import { buildRequestContext, type RequestContextDeps } from "../../core/request-context.js";
import { getProject } from "./projects.service.js";

const getProjectOp = {
  name: "projects.get",
  permission: "requirement:read",
  projectScoped: true,
  projectIdFromInput: (input: { projectId: string }) => input.projectId,
  auditMeta: (input: { projectId: string }) => ({
    projectId: input.projectId,
    targetType: "project",
    targetId: input.projectId,
  }),
  execute: getProject,
};

export function registerProjectRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  app.get(
    "/api/v1/projects/:projectId",
    {
      config: { reqalmSecurity: { kind: "permission", permission: "requirement:read" } },
      schema: {
        tags: ["projects"],
        summary: "Read a project (scoped to caller grants)",
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
      const result = await runOperation(ctx, getProjectOp, { projectId });
      return mapServiceResultToHttp(reply, ctx.requestId, result);
    },
  );
}
