import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { defineOperationRoute, parseZodInput } from "../../http/define-operation-route.js";
import type { OperationDef } from "../../core/operation.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import { ok, type ServiceResult } from "../../core/service-result.js";
import { getProject, type GetProjectInput, type ProjectDto } from "./projects.service.js";

const projectParams = z.object({
  projectId: z.string().trim().min(1),
});

const getProjectOp: OperationDef<GetProjectInput, ProjectDto> = {
  name: "projects.get",
  permission: "requirement:read",
  projectScoped: true,
  projectIdFromInput: (input) => input.projectId,
  auditMeta: (input) => ({
    projectId: input.projectId,
    targetType: "project",
    targetId: input.projectId,
  }),
  execute: getProject,
};

export function registerProjectRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId",
    op: getProjectOp,
    parseInput: (req): ServiceResult<GetProjectInput> => {
      const params = parseZodInput(projectParams, req.params, "params");
      if (!params.ok) return params;
      return ok(params.data);
    },
    schema: {
      tags: ["projects"],
      summary: "Read a project (scoped to caller grants)",
      params: {
        type: "object",
        required: ["projectId"],
        properties: { projectId: { type: "string" } },
      },
    },
  });
}
