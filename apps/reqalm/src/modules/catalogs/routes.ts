import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pageQuerySchema } from "../../core/paging.js";
import {
  defineOperationRoute,
  parseZodInput,
  projectIdSchema,
} from "../../http/define-operation-route.js";
import type { OperationDef } from "../../core/operation.js";
import { ok } from "../../core/service-result.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import type { PageResult } from "../../core/paging.js";
import {
  getImprintControl,
  listImprintControls,
  listProjectCatalogs,
  type ControlDetailDto,
  type ControlSummaryDto,
  type GetControlInput,
  type ListCatalogsInput,
  type ListControlsInput,
  type ProjectCatalogsDto,
} from "./catalogs.service.js";

const catalogIdSchema = z.string().min(1).max(128);
const imprintIdSchema = z.string().min(1).max(160);
const controlIdSchema = z.string().min(1).max(128);

const catalogParams = z.object({
  projectId: projectIdSchema,
  catalogId: catalogIdSchema,
});

const imprintParams = catalogParams.extend({ imprintId: imprintIdSchema });
const controlParams = imprintParams.extend({ controlId: controlIdSchema });

const listCatalogsOp: OperationDef<ListCatalogsInput, ProjectCatalogsDto> = {
  name: "catalogs.list",
  permission: "requirement:read",
  projectScoped: true,
  projectIdFromInput: (input) => input.projectId,
  auditMeta: (input) => ({
    projectId: input.projectId,
    targetType: "catalog",
    targetId: null,
  }),
  execute: listProjectCatalogs,
};

const listControlsOp: OperationDef<ListControlsInput, PageResult<ControlSummaryDto>> = {
  name: "catalogs.list_controls",
  permission: "requirement:read",
  projectScoped: true,
  projectIdFromInput: (input) => input.projectId,
  auditMeta: (input) => ({
    projectId: input.projectId,
    targetType: "catalog_imprint",
    targetId: input.imprintId,
  }),
  execute: listImprintControls,
};

const getControlOp: OperationDef<GetControlInput, ControlDetailDto> = {
  name: "catalogs.get_control",
  permission: "requirement:read",
  projectScoped: true,
  projectIdFromInput: (input) => input.projectId,
  auditMeta: (input) => ({
    projectId: input.projectId,
    targetType: "catalog_control",
    targetId: input.controlId,
  }),
  execute: getImprintControl,
};

export function registerCatalogRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/catalogs",
    op: listCatalogsOp,
    parseInput: (req) => parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params"),
    schema: { tags: ["catalogs"], summary: "List catalogs visible at project scope with imprints" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/catalogs/:catalogId/imprints/:imprintId/controls",
    op: listControlsOp,
    parseInput: (req) => {
      const params = parseZodInput(imprintParams, req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ ...params.data, ...query.data });
    },
    schema: {
      tags: ["catalogs"],
      summary: "Paged controls for a catalog imprint with project-scoped conforming counts",
    },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/catalogs/:catalogId/imprints/:imprintId/controls/:controlId",
    op: getControlOp,
    parseInput: (req) => parseZodInput(controlParams, req.params, "params"),
    schema: { tags: ["catalogs"], summary: "Control detail with conforming project lines" },
  });
}
