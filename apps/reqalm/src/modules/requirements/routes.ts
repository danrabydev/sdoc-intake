import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pageQuerySchema } from "../../core/paging.js";
import {
  defineOperationRoute,
  parseZodInput,
  projectIdSchema,
} from "../../http/define-operation-route.js";
import { REQUIREMENT_ID } from "../../http/project-id.js";
import type { OperationDef } from "../../core/operation.js";
import { ok } from "../../core/service-result.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import type { PageResult } from "../../core/paging.js";
import {
  getRequirement,
  listRequirementTree,
  listRequirementVersions,
  listRequirements,
  type GetRequirementInput,
  type ListRequirementTreeInput,
  type ListRequirementVersionsInput,
  type RequirementDetailDto,
  type RequirementListFilters,
  type RequirementSummaryDto,
  type RequirementTreeNodeDto,
  type RequirementVersionDto,
} from "./requirements.service.js";

export const requirementIdSchema = z.string().regex(REQUIREMENT_ID, "invalid requirement id");

const projectRequirementParams = z.object({
  projectId: projectIdSchema,
  requirementId: requirementIdSchema,
});

const listQuerySchema = pageQuerySchema.extend({
  kind: z.string().min(1).max(64).optional(),
  type: z.string().min(1).max(64).optional(),
  status: z.string().min(1).max(64).optional(),
  q: z.string().min(1).max(200).optional(),
});

const listRequirementsOp: OperationDef<RequirementListFilters, PageResult<RequirementSummaryDto>> = {
  name: "requirements.list",
  permission: "requirement:list",
  projectScoped: true,
  projectIdFromInput: (input) => input.projectId,
  auditMeta: (input) => ({
    projectId: input.projectId,
    targetType: "requirement",
    targetId: null,
  }),
  execute: listRequirements,
};

const getRequirementOp: OperationDef<GetRequirementInput, RequirementDetailDto> = {
  name: "requirements.get",
  permission: "requirement:read",
  projectScoped: true,
  projectIdFromInput: (input) => input.projectId,
  auditMeta: (input) => ({
    projectId: input.projectId,
    targetType: "requirement",
    targetId: input.requirementId,
  }),
  execute: getRequirement,
};

const treeQuerySchema = pageQuerySchema.extend({
  parent: requirementIdSchema.optional(),
});

const listTreeOp: OperationDef<ListRequirementTreeInput, PageResult<RequirementTreeNodeDto>> = {
  name: "requirements.list_tree",
  permission: "requirement:read",
  projectScoped: true,
  projectIdFromInput: (input) => input.projectId,
  auditMeta: (input) => ({
    projectId: input.projectId,
    targetType: "requirement",
    targetId: input.parentUid,
  }),
  execute: listRequirementTree,
};

const listVersionsOp: OperationDef<
  ListRequirementVersionsInput,
  PageResult<RequirementVersionDto>
> = {
  name: "requirements.list_versions",
  permission: "requirement:read",
  projectScoped: true,
  projectIdFromInput: (input) => input.projectId,
  auditMeta: (input) => ({
    projectId: input.projectId,
    targetType: "requirement",
    targetId: input.requirementId,
  }),
  execute: listRequirementVersions,
};

export function registerRequirementRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/requirements",
    op: listRequirementsOp,
    parseInput: (req) => {
      const params = parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(listQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ projectId: params.data.projectId, ...query.data });
    },
    schema: { tags: ["requirements"], summary: "List requirements in a project (current version summary)" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/requirements/tree",
    op: listTreeOp,
    parseInput: (req) => {
      const params = parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(treeQuerySchema, req.query, "query");
      if (!query.ok) return query;
      const { parent, ...page } = query.data;
      return ok({ projectId: params.data.projectId, parentUid: parent ?? null, ...page });
    },
    schema: { tags: ["requirements"], summary: "List direct children in the requirement tree (lazy)" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/requirements/:requirementId",
    op: getRequirementOp,
    parseInput: (req) => parseZodInput(projectRequirementParams, req.params, "params"),
    schema: { tags: ["requirements"], summary: "Read current version of a requirement" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/requirements/:requirementId/versions",
    op: listVersionsOp,
    parseInput: (req) => {
      const params = parseZodInput(projectRequirementParams, req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ ...params.data, ...query.data });
    },
    schema: { tags: ["requirements"], summary: "Paged version history for a requirement" },
  });
}
