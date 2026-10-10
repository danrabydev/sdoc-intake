import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pageQuerySchema } from "../../core/paging.js";
import {
  defineOperationRoute,
  parseZodInput,
  projectIdSchema,
} from "../../http/define-operation-route.js";
import { CHANGE_SET_ID, ITERATION_ID, WORK_ITEM_LINK_ID } from "../../http/project-id.js";
import type { OperationDef } from "../../core/operation.js";
import { ok } from "../../core/service-result.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import type { PageResult } from "../../core/paging.js";
import {
  getChangeSet,
  getIteration,
  getWorkItemLink,
  listChangeSets,
  listIterations,
  listWorkItemLinks,
  type ChangeSetDetailDto,
  type ChangeSetSummaryDto,
  type GetChangeSetInput,
  type GetIterationInput,
  type GetWorkItemLinkInput,
  type IterationDetailDto,
  type IterationSummaryDto,
  type ListPlanningInput,
  type WorkItemLinkDetailDto,
  type WorkItemLinkSummaryDto,
} from "./planning.service.js";

const denyAsMissing = {
  permissionDeniedAsNotFound: true as const,
  permissionDeniedDetail: "Not found",
};

function planningReadOp<TIn extends { projectId: string }, TOut>(
  name: string,
  execute: OperationDef<TIn, TOut>["execute"],
  targetType: string,
  targetId: (input: TIn) => string | null,
): OperationDef<TIn, TOut> {
  return {
    name,
    permission: "planning:read",
    projectScoped: true,
    ...denyAsMissing,
    projectIdFromInput: (input) => input.projectId,
    auditMeta: (input) => ({
      projectId: input.projectId,
      targetType,
      targetId: targetId(input),
    }),
    execute,
  };
}

const iterationParams = z.object({ projectId: projectIdSchema, iterationId: z.string().regex(ITERATION_ID) });
const changeSetParams = z.object({ projectId: projectIdSchema, changeSetId: z.string().regex(CHANGE_SET_ID) });
const linkParams = z.object({ projectId: projectIdSchema, linkId: z.string().regex(WORK_ITEM_LINK_ID) });

const listIterationsOp = planningReadOp<ListPlanningInput, PageResult<IterationSummaryDto>>(
  "planning.iterations.list",
  listIterations,
  "iteration",
  () => null,
);
const getIterationOp = planningReadOp<GetIterationInput, IterationDetailDto>(
  "planning.iterations.get",
  getIteration,
  "iteration",
  (i) => i.iterationId,
);
const listChangeSetsOp = planningReadOp<ListPlanningInput, PageResult<ChangeSetSummaryDto>>(
  "planning.change_sets.list",
  listChangeSets,
  "change_set",
  () => null,
);
const getChangeSetOp = planningReadOp<GetChangeSetInput, ChangeSetDetailDto>(
  "planning.change_sets.get",
  getChangeSet,
  "change_set",
  (i) => i.changeSetId,
);
const listLinksOp = planningReadOp<ListPlanningInput, PageResult<WorkItemLinkSummaryDto>>(
  "planning.work_item_links.list",
  listWorkItemLinks,
  "work_item_link",
  () => null,
);
const getLinkOp = planningReadOp<GetWorkItemLinkInput, WorkItemLinkDetailDto>(
  "planning.work_item_links.get",
  getWorkItemLink,
  "work_item_link",
  (i) => i.linkId,
);

function listRoute(
  app: FastifyInstance,
  deps: RequestContextDeps,
  url: string,
  op: OperationDef<ListPlanningInput, PageResult<unknown>>,
  tag: string,
  summary: string,
): void {
  defineOperationRoute(app, deps, {
    method: "get",
    url,
    op,
    parseInput: (req) => {
      const params = parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ projectId: params.data.projectId, ...query.data });
    },
    schema: { tags: [tag], summary },
  });
}

export function registerPlanningRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  listRoute(
    app,
    deps,
    "/api/v1/projects/:projectId/iterations",
    listIterationsOp,
    "planning",
    "List iterations (starts_on desc, id asc)",
  );
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/iterations/:iterationId",
    op: getIterationOp,
    parseInput: (req) => parseZodInput(iterationParams, req.params, "params"),
    schema: { tags: ["planning"], summary: "Read an iteration" },
  });
  listRoute(
    app,
    deps,
    "/api/v1/projects/:projectId/change-sets",
    listChangeSetsOp,
    "planning",
    "List change sets (opened_at desc, id asc)",
  );
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/change-sets/:changeSetId",
    op: getChangeSetOp,
    parseInput: (req) => parseZodInput(changeSetParams, req.params, "params"),
    schema: { tags: ["planning"], summary: "Read a change set" },
  });
  listRoute(
    app,
    deps,
    "/api/v1/projects/:projectId/work-item-links",
    listLinksOp,
    "planning",
    "List work item links (id asc; grant-filtered requirement versions)",
  );
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/work-item-links/:linkId",
    op: getLinkOp,
    parseInput: (req) => parseZodInput(linkParams, req.params, "params"),
    schema: { tags: ["planning"], summary: "Read a work item link" },
  });
}
