import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { defineOperationRoute, parseZodInput } from "../../http/define-operation-route.js";
import type { OperationDef } from "../../core/operation.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import { getProject, type GetProjectInput, type ProjectDto } from "./projects.service.js";

const projectParams = z.object({
  // Exact id: reject blank, never trim (a padded id must not resolve to the real project).
  projectId: z.string().refine((v) => v.trim() !== "" && v.trim() === v, "invalid project id"),
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
    parseInput: (req) => parseZodInput(projectParams, req.params, "params"),
    schema: {
      tags: ["projects"],
      summary: "Read a project (scoped to caller grants)",
    },
  });
}
