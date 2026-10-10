import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pageQuerySchema } from "../../core/paging.js";
import {
  defineOperationRoute,
  parseZodInput,
  projectIdSchema,
} from "../../http/define-operation-route.js";
import { VERSION_UID } from "../../http/project-id.js";
import type { OperationDef } from "../../core/operation.js";
import { ok } from "../../core/service-result.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import type { PageResult } from "../../core/paging.js";
import {
  listVersionArtifacts,
  listVersionAttachments,
  type CapabilityArtifactDto,
  type FileAttachmentLatestDto,
  type ListVersionArtifactsInput,
  type ListVersionAttachmentsInput,
} from "./artifacts.service.js";

const versionParams = z.object({
  projectId: projectIdSchema,
  versionUid: z.string().regex(VERSION_UID, "invalid requirement version id"),
});

const denyAsMissing = {
  permissionDeniedAsNotFound: true as const,
  permissionDeniedDetail: "Requirement version not found",
};

function versionReadOp<TIn extends { projectId: string; versionUid: string }, TOut>(
  name: string,
  execute: OperationDef<TIn, TOut>["execute"],
): OperationDef<TIn, TOut> {
  return {
    name,
    permission: "attachment:read",
    projectScoped: true,
    validatePathProjectId: true,
    ...denyAsMissing,
    projectIdFromInput: (input) => input.projectId,
    auditMeta: (input) => ({
      projectId: input.projectId,
      targetType: "requirement_version",
      targetId: input.versionUid,
    }),
    execute,
  };
}

const listArtifactsOp = versionReadOp<ListVersionArtifactsInput, PageResult<CapabilityArtifactDto>>(
  "artifacts.list_for_version",
  listVersionArtifacts,
);
const listAttachmentsOp = versionReadOp<
  ListVersionAttachmentsInput,
  PageResult<FileAttachmentLatestDto>
>("attachments.list_for_version", listVersionAttachments);

export function registerArtifactRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/requirement-versions/:versionUid/artifacts",
    op: listArtifactsOp,
    parseInput: (req) => {
      const params = parseZodInput(versionParams, req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ ...params.data, ...query.data });
    },
    schema: { tags: ["artifacts"], summary: "Paged capability/design artifacts for a requirement version" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/requirement-versions/:versionUid/attachments",
    op: listAttachmentsOp,
    parseInput: (req) => {
      const params = parseZodInput(versionParams, req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ ...params.data, ...query.data });
    },
    schema: {
      tags: ["attachments"],
      summary: "Paged file attachment metadata (latest version) for a requirement version",
    },
  });
}
