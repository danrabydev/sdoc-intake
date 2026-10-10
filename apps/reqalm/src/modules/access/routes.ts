import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pageQuerySchema } from "../../core/paging.js";
import {
  clientParamsSchema,
  defineOperationRoute,
  parseZodInput,
  projectIdSchema,
} from "../../http/define-operation-route.js";
import type { OperationDef } from "../../core/operation.js";
import { ok } from "../../core/service-result.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import type { PageResult } from "../../core/paging.js";
import {
  listClientGrants,
  listPlatformGrants,
  listProjectGrants,
  listProjectPeople,
  listRoleCatalog,
  type AccessPersonDto,
  type ClientGrantDto,
  type ListClientGrantsInput,
  type ListPlatformGrantsInput,
  type ListProjectGrantsInput,
  type ListProjectPeopleInput,
  type ListRolesInput,
  type PlatformGrantDto,
  type ProjectGrantDto,
  type RoleCatalogDto,
} from "./access.service.js";

const projectParams = z.object({ projectId: projectIdSchema });

const denyAsMissing = {
  permissionDeniedAsNotFound: true as const,
  permissionDeniedDetail: "Project not found",
};

function accessReadOp<TIn extends { projectId: string }, TOut>(
  name: string,
  execute: OperationDef<TIn, TOut>["execute"],
  targetType: string,
  targetId: (input: TIn) => string | null,
): OperationDef<TIn, TOut> {
  return {
    name,
    permission: "grant:read",
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

const listPeopleOp = accessReadOp<ListProjectPeopleInput, PageResult<AccessPersonDto>>(
  "access.list_people",
  listProjectPeople,
  "project",
  () => null,
);
const listProjectGrantsOp = accessReadOp<ListProjectGrantsInput, PageResult<ProjectGrantDto>>(
  "access.list_project_grants",
  listProjectGrants,
  "project",
  () => null,
);

const listClientGrantsOp: OperationDef<ListClientGrantsInput, PageResult<ClientGrantDto>> = {
  name: "access.list_client_grants",
  permission: "grant:read",
  listScope: true,
  auditMeta: (input) => ({
    targetType: "client",
    targetId: input.clientId,
  }),
  execute: listClientGrants,
};

const listRolesOp: OperationDef<ListRolesInput, PageResult<RoleCatalogDto>> = {
  name: "access.list_roles",
  permission: "grant:read",
  listScope: true,
  auditMeta: () => ({ targetType: "role_catalog", targetId: null }),
  execute: listRoleCatalog,
};

const listPlatformGrantsOp: OperationDef<ListPlatformGrantsInput, PageResult<PlatformGrantDto>> = {
  name: "access.list_platform_grants",
  permission: "grant:read",
  listScope: true,
  auditMeta: () => ({ targetType: "platform_grant", targetId: null }),
  execute: listPlatformGrants,
};

export function registerAccessRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/access/people",
    op: listPeopleOp,
    parseInput: (req) => {
      const params = parseZodInput(projectParams, req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ projectId: params.data.projectId, ...query.data });
    },
    schema: { tags: ["access"], summary: "List people with active roles on a project" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/access/grants",
    op: listProjectGrantsOp,
    parseInput: (req) => {
      const params = parseZodInput(projectParams, req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ projectId: params.data.projectId, ...query.data });
    },
    schema: { tags: ["access"], summary: "List active project role grants" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/clients/:clientId/access/grants",
    op: listClientGrantsOp,
    parseInput: (req) => {
      const params = parseZodInput(clientParamsSchema, req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ clientId: params.data.clientId, ...query.data });
    },
    schema: { tags: ["access"], summary: "List client-level role grants visible to caller" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/access/roles",
    op: listRolesOp,
    parseInput: (req) => parseZodInput(pageQuerySchema, req.query, "query"),
    schema: { tags: ["access"], summary: "Paged role catalog with permissions" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/access/platform-grants",
    op: listPlatformGrantsOp,
    parseInput: (req) => parseZodInput(pageQuerySchema, req.query, "query"),
    schema: { tags: ["access"], summary: "List deployment platform grants (platform roles only)" },
  });
}
