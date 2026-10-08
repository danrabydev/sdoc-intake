import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { defineOperationRoute, parseZodInput } from "../../http/define-operation-route.js";
import type { OperationDef } from "../../core/operation.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import {
  grantManageStub,
  type GrantManageDto,
  type GrantManageInput,
} from "./grants.service.js";

const grantParams = z.object({
  // Exact id: reject blank, never trim (a padded id must not resolve to the real project).
  projectId: z.string().refine((v) => v.trim() !== "" && v.trim() === v, "invalid project id"),
});

const grantManageOp: OperationDef<GrantManageInput, GrantManageDto> = {
  name: "grants.manage",
  permission: "grant:manage",
  projectScoped: true,
  projectIdFromInput: (input) => input.projectId,
  auditMeta: (input) => ({
    projectId: input.projectId,
    targetType: "project",
    targetId: input.projectId,
  }),
  execute: grantManageStub,
};

export function registerGrantRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  defineOperationRoute(app, deps, {
    method: "post",
    url: "/api/v1/projects/:projectId/grants",
    op: grantManageOp,
    parseInput: (req) => parseZodInput(grantParams, req.params, "params"),
    schema: {
      tags: ["grants"],
      summary: "Manage project grants (stub — authorize only)",
    },
  });
}
