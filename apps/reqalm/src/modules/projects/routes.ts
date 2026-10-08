import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pageQuerySchema } from "../../core/paging.js";
import { defineOperationRoute, parseZodInput, projectIdSchema } from "../../http/define-operation-route.js";
import { SLUG_ID } from "../../http/project-id.js";
import type { OperationDef } from "../../core/operation.js";
import { ok } from "../../core/service-result.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import type { PageResult } from "../../core/paging.js";
import {
  getProject,
  listClientProjects,
  listProjects,
  type GetProjectInput,
  type ListClientProjectsInput,
  type ListProjectsInput,
  type ProjectDto,
} from "./projects.service.js";

const projectParams = z.object({
  projectId: projectIdSchema,
});

const clientIdSchema = z.string().regex(SLUG_ID, "invalid client id");

const clientProjectParams = z.object({
  clientId: clientIdSchema,
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

const listProjectsOp: OperationDef<ListProjectsInput, PageResult<ProjectDto>> = {
  name: "projects.list",
  permission: "project:list",
  auditMeta: () => ({ targetType: "project", targetId: null }),
  execute: listProjects,
};

const listClientProjectsOp: OperationDef<ListClientProjectsInput, PageResult<ProjectDto>> = {
  name: "projects.list_for_client",
  permission: "project:list",
  auditMeta: (input) => ({
    targetType: "client",
    targetId: input.clientId,
  }),
  execute: listClientProjects,
};

export function registerProjectRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects",
    op: listProjectsOp,
    parseInput: (req) => parseZodInput(pageQuerySchema, req.query, "query"),
    schema: { tags: ["projects"], summary: "List projects visible to caller grants" },
  });

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

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/clients/:clientId/projects",
    op: listClientProjectsOp,
    parseInput: (req) => {
      const params = parseZodInput(clientProjectParams, req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ ...params.data, ...query.data });
    },
    schema: {
      tags: ["projects"],
      summary: "List projects under a client (grant-scoped)",
    },
  });
}
