import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pageQuerySchema } from "../../core/paging.js";
import {
  defineOperationRoute,
  parseZodInput,
  projectIdSchema,
} from "../../http/define-operation-route.js";
import { RELEASE_ID } from "../../http/project-id.js";
import type { OperationDef } from "../../core/operation.js";
import { ok } from "../../core/service-result.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import type { PageResult } from "../../core/paging.js";
import {
  getRelease,
  listReleases,
  type GetReleaseInput,
  type ReleaseDetailDto,
  type ReleaseListFilters,
  type ReleaseSummaryDto,
} from "./releases.service.js";

export const releaseIdSchema = z.string().regex(RELEASE_ID, "invalid release id");

const projectReleaseParams = z.object({
  projectId: projectIdSchema,
  releaseId: releaseIdSchema,
});

/** Release statuses persisted in the seed and migrations (planned | shipped). */
const RELEASE_STATUS = z.enum(["planned", "shipped"]);

const listQuerySchema = pageQuerySchema.extend({
  status: RELEASE_STATUS.optional(),
});

const listReleasesOp: OperationDef<ReleaseListFilters, PageResult<ReleaseSummaryDto>> = {
  name: "releases.list",
  permission: "release:list",
  projectScoped: true,
  projectIdFromInput: (input) => input.projectId,
  auditMeta: (input) => ({
    projectId: input.projectId,
    targetType: "release",
    targetId: null,
  }),
  execute: listReleases,
};

const getReleaseOp: OperationDef<GetReleaseInput, ReleaseDetailDto> = {
  name: "releases.get",
  permission: "release:read",
  projectScoped: true,
  projectIdFromInput: (input) => input.projectId,
  auditMeta: (input) => ({
    projectId: input.projectId,
    targetType: "release",
    targetId: input.releaseId,
  }),
  execute: getRelease,
};

export function registerReleaseRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/releases",
    op: listReleasesOp,
    parseInput: (req) => {
      const params = parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(listQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ projectId: params.data.projectId, ...query.data });
    },
    schema: {
      tags: ["releases"],
      summary:
        "List releases in a project (planned_on desc, id asc). Optional status filter (planned | shipped).",
    },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/releases/:releaseId",
    op: getReleaseOp,
    parseInput: (req) => parseZodInput(projectReleaseParams, req.params, "params"),
    schema: { tags: ["releases"], summary: "Read a release (notes and delivered capabilities)" },
  });
}
