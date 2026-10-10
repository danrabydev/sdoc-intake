import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  defineOperationRoute,
  parseZodInput,
  projectIdSchema,
} from "../../http/define-operation-route.js";
import type { OperationDef } from "../../core/operation.js";
import { ok } from "../../core/service-result.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import type { PageResult } from "../../core/paging.js";
import { auditFilterQuerySchema } from "../../audit/audit-api-schemas.js";
import {
  listPlatformAuditEvents,
  listProjectAuditEvents,
  type AuditEventDto,
  type ListPlatformAuditInput,
  type ListProjectAuditInput,
} from "./audit.service.js";

const denyAsMissing = {
  permissionDeniedAsNotFound: true as const,
  permissionDeniedDetail: "Project not found",
};

const listProjectOp: OperationDef<ListProjectAuditInput, PageResult<AuditEventDto>> = {
  name: "audit.list_project",
  permission: "audit:read",
  projectScoped: true,
  ...denyAsMissing,
  projectIdFromInput: (input) => input.projectId,
  auditMeta: (input) => ({
    projectId: input.projectId,
    targetType: "audit",
    targetId: null,
  }),
  execute: listProjectAuditEvents,
};

const listPlatformOp: OperationDef<ListPlatformAuditInput, PageResult<AuditEventDto>> = {
  name: "audit.list_platform",
  permission: "audit:read",
  listScope: true,
  ...denyAsMissing,
  auditMeta: () => ({
    projectId: null,
    targetType: "audit",
    targetId: null,
  }),
  execute: listPlatformAuditEvents,
};

export function registerAuditRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/audit-events",
    op: listProjectOp,
    parseInput: (req) => {
      const params = parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(auditFilterQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ projectId: params.data.projectId, ...query.data });
    },
    schema: {
      tags: ["audit"],
      summary: "Paged business audit events for a project (newest first)",
    },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/audit-events",
    op: listPlatformOp,
    parseInput: (req) => parseZodInput(auditFilterQuerySchema, req.query, "query"),
    schema: {
      tags: ["audit"],
      summary: "Platform-wide audit events (business rows with null project and auth audit)",
    },
  });
}
