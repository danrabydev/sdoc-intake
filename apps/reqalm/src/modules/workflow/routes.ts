import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pageQuerySchema } from "../../core/paging.js";
import {
  defineOperationRoute,
  parseZodInput,
  projectIdSchema,
} from "../../http/define-operation-route.js";
import {
  REQUIREMENT_ID,
  WORKFLOW_ACTION_HOOK_ID,
  WORKFLOW_APPROVAL_RECORD_ID,
  WORKFLOW_GATE_ID,
  WORKFLOW_PROFILE_ID,
  WORKFLOW_ROLE_BINDING_ID,
  WORKFLOW_SUBJECT_KIND_ID,
} from "../../http/project-id.js";
import type { OperationDef } from "../../core/operation.js";
import { ok } from "../../core/service-result.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import type { PageResult } from "../../core/paging.js";
import {
  getLineApprovalState,
  getProjectWorkflowProfile,
  getWorkflowActionHook,
  getWorkflowApprovalRecord,
  getWorkflowGate,
  getWorkflowProfile,
  getWorkflowRoleBinding,
  getWorkflowSubjectKind,
  listWorkflowActionHooks,
  listWorkflowApprovalRecords,
  listWorkflowGates,
  listWorkflowProfiles,
  listWorkflowRoleBindings,
  listWorkflowSubjectKinds,
  type WorkflowActionHookDto,
  type WorkflowApprovalRecordDto,
  type WorkflowGateDto,
  type WorkflowLineApprovalStateDto,
  type WorkflowProfileDetailDto,
  type WorkflowProfileSummaryDto,
  type WorkflowRoleBindingDto,
  type WorkflowSubjectKindDto,
  type GetLineApprovalStateInput,
  type GetProjectWorkflowProfileInput,
  type GetWorkflowActionHookInput,
  type GetWorkflowApprovalRecordInput,
  type GetWorkflowGateInput,
  type GetWorkflowProfileInput,
  type GetWorkflowRoleBindingInput,
  type GetWorkflowSubjectKindInput,
  type ListWorkflowActionHooksInput,
  type ListWorkflowApprovalRecordsInput,
  type ListWorkflowGatesInput,
  type ListWorkflowProfilesInput,
  type ListWorkflowRoleBindingsInput,
  type ListWorkflowSubjectKindsInput,
  type ProjectWorkflowProfileDto,
} from "./workflow.service.js";

const denyAsMissing = {
  permissionDeniedAsNotFound: true as const,
  permissionDeniedDetail: "Workflow resource not found",
};

function workflowReadOp<TIn extends { projectId: string }, TOut>(
  name: string,
  execute: OperationDef<TIn, TOut>["execute"],
  targetType: string,
  targetId: (input: TIn) => string | null,
): OperationDef<TIn, TOut> {
  return {
    name,
    permission: "workflow:read",
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

const profileParams = z.object({
  projectId: projectIdSchema,
  profileId: z.string().regex(WORKFLOW_PROFILE_ID, "invalid workflow profile id"),
});

export function registerWorkflowRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/profile",
    op: workflowReadOp<GetProjectWorkflowProfileInput, ProjectWorkflowProfileDto>(
      "workflow.project_profile",
      getProjectWorkflowProfile,
      "workflow_profile",
      () => null,
    ),
    parseInput: (req) => parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params"),
    schema: { tags: ["workflow"], summary: "Effective workflow profile for a project" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/profiles",
    op: workflowReadOp<ListWorkflowProfilesInput, PageResult<WorkflowProfileSummaryDto>>(
      "workflow.list_profiles",
      listWorkflowProfiles,
      "workflow_profile",
      () => null,
    ),
    parseInput: (req) => {
      const params = parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ projectId: params.data.projectId, ...query.data });
    },
    schema: { tags: ["workflow"], summary: "Paged workflow profiles visible to a project" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/profiles/:profileId",
    op: workflowReadOp<GetWorkflowProfileInput, WorkflowProfileDetailDto>(
      "workflow.get_profile",
      getWorkflowProfile,
      "workflow_profile",
      (i) => i.profileId,
    ),
    parseInput: (req) => parseZodInput(profileParams, req.params, "params"),
    schema: { tags: ["workflow"], summary: "Read a workflow profile" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/gates",
    op: workflowReadOp<ListWorkflowGatesInput, PageResult<WorkflowGateDto>>(
      "workflow.list_gates",
      listWorkflowGates,
      "workflow_gate",
      () => null,
    ),
    parseInput: (req) => {
      const params = parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ projectId: params.data.projectId, ...query.data });
    },
    schema: { tags: ["workflow"], summary: "Paged workflow gate catalog" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/gates/:gateId",
    op: workflowReadOp<GetWorkflowGateInput, WorkflowGateDto>(
      "workflow.get_gate",
      getWorkflowGate,
      "workflow_gate",
      (i) => i.gateId,
    ),
    parseInput: (req) =>
      parseZodInput(
        z.object({
          projectId: projectIdSchema,
          gateId: z.string().regex(WORKFLOW_GATE_ID, "invalid workflow gate id"),
        }),
        req.params,
        "params",
      ),
    schema: { tags: ["workflow"], summary: "Read a workflow gate" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/action-hooks",
    op: workflowReadOp<ListWorkflowActionHooksInput, PageResult<WorkflowActionHookDto>>(
      "workflow.list_action_hooks",
      listWorkflowActionHooks,
      "workflow_action_hook",
      () => null,
    ),
    parseInput: (req) => {
      const params = parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ projectId: params.data.projectId, ...query.data });
    },
    schema: { tags: ["workflow"], summary: "Paged action hook catalog" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/action-hooks/:hookId",
    op: workflowReadOp<GetWorkflowActionHookInput, WorkflowActionHookDto>(
      "workflow.get_action_hook",
      getWorkflowActionHook,
      "workflow_action_hook",
      (i) => i.hookId,
    ),
    parseInput: (req) =>
      parseZodInput(
        z.object({
          projectId: projectIdSchema,
          hookId: z.string().regex(WORKFLOW_ACTION_HOOK_ID, "invalid action hook id"),
        }),
        req.params,
        "params",
      ),
    schema: { tags: ["workflow"], summary: "Read an action hook" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/subject-kinds",
    op: workflowReadOp<ListWorkflowSubjectKindsInput, PageResult<WorkflowSubjectKindDto>>(
      "workflow.list_subject_kinds",
      listWorkflowSubjectKinds,
      "workflow_subject_kind",
      () => null,
    ),
    parseInput: (req) => {
      const params = parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ projectId: params.data.projectId, ...query.data });
    },
    schema: { tags: ["workflow"], summary: "Paged SubjectKind registry" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/subject-kinds/:subjectKindId",
    op: workflowReadOp<GetWorkflowSubjectKindInput, WorkflowSubjectKindDto>(
      "workflow.get_subject_kind",
      getWorkflowSubjectKind,
      "workflow_subject_kind",
      (i) => i.subjectKindId,
    ),
    parseInput: (req) =>
      parseZodInput(
        z.object({
          projectId: projectIdSchema,
          subjectKindId: z.string().regex(WORKFLOW_SUBJECT_KIND_ID, "invalid subject kind id"),
        }),
        req.params,
        "params",
      ),
    schema: { tags: ["workflow"], summary: "Read a SubjectKind registry entry" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/role-bindings",
    op: workflowReadOp<ListWorkflowRoleBindingsInput, PageResult<WorkflowRoleBindingDto>>(
      "workflow.list_role_bindings",
      listWorkflowRoleBindings,
      "workflow_role_binding",
      () => null,
    ),
    parseInput: (req) => {
      const params = parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(
        pageQuerySchema.extend({
          profileId: z.string().regex(WORKFLOW_PROFILE_ID, "invalid workflow profile id").optional(),
        }),
        req.query,
        "query",
      );
      if (!query.ok) return query;
      return ok({ projectId: params.data.projectId, ...query.data });
    },
    schema: { tags: ["workflow"], summary: "Paged role bindings for visible workflow profiles" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/role-bindings/:bindingId",
    op: workflowReadOp<GetWorkflowRoleBindingInput, WorkflowRoleBindingDto>(
      "workflow.get_role_binding",
      getWorkflowRoleBinding,
      "workflow_role_binding",
      (i) => i.bindingId,
    ),
    parseInput: (req) =>
      parseZodInput(
        z.object({
          projectId: projectIdSchema,
          bindingId: z.string().regex(WORKFLOW_ROLE_BINDING_ID, "invalid role binding id"),
        }),
        req.params,
        "params",
      ),
    schema: { tags: ["workflow"], summary: "Read a workflow role binding" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/approval-records",
    op: workflowReadOp<ListWorkflowApprovalRecordsInput, PageResult<WorkflowApprovalRecordDto>>(
      "workflow.list_approval_records",
      listWorkflowApprovalRecords,
      "workflow_approval_record",
      () => null,
    ),
    parseInput: (req) => {
      const params = parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ projectId: params.data.projectId, ...query.data });
    },
    schema: { tags: ["workflow"], summary: "Paged line approval records for a project" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/approval-records/:recordId",
    op: workflowReadOp<GetWorkflowApprovalRecordInput, WorkflowApprovalRecordDto>(
      "workflow.get_approval_record",
      getWorkflowApprovalRecord,
      "workflow_approval_record",
      (i) => i.recordId,
    ),
    parseInput: (req) =>
      parseZodInput(
        z.object({
          projectId: projectIdSchema,
          recordId: z.string().regex(WORKFLOW_APPROVAL_RECORD_ID, "invalid approval record id"),
        }),
        req.params,
        "params",
      ),
    schema: { tags: ["workflow"], summary: "Read a workflow approval record" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/workflow/lines/:baseUid/approval",
    op: workflowReadOp<GetLineApprovalStateInput, WorkflowLineApprovalStateDto>(
      "workflow.get_line_approval",
      getLineApprovalState,
      "requirement_line",
      (i) => i.baseUid,
    ),
    parseInput: (req) =>
      parseZodInput(
        z.object({
          projectId: projectIdSchema,
          baseUid: z.string().regex(REQUIREMENT_ID, "invalid requirement line id"),
        }),
        req.params,
        "params",
      ),
    schema: { tags: ["workflow"], summary: "Current line approval state (record or null)" },
  });
}
