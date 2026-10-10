import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { PageQuery, PageResult } from "../../core/paging.js";
import type { RequestContext } from "../../core/request-context.js";

export type WorkflowProfileSummaryDto = {
  id: string;
  title: string;
  scope: string;
  client_id: string;
  project_id: string | null;
};

export type WorkflowProfileDetailDto = WorkflowProfileSummaryDto & {
  gate_ids: string[];
  enabled_optional_gates: string[];
  disabled_optional_gates: string[];
  planning_gate_actions: string[];
  action_hook_ids: string[];
  notes: string | null;
};

export type WorkflowGateDto = {
  id: string;
  subject_kinds: string[];
  mode: string;
  predicate: string;
  approver_slots: string[];
  on_fail: string;
  deny_fixture: string | null;
  notes: string | null;
};

export type WorkflowActionHookDto = {
  id: string;
  action_id: string;
  subject_kind: string;
  gates_before: string[];
  effects_after: string[];
  notes: string | null;
};

export type WorkflowSubjectKindDto = {
  id: string;
  backing: string;
  kind_filter: string[];
  notes: string | null;
};

export type WorkflowRoleBindingDto = {
  id: string;
  profile_id: string;
  gate_id: string;
  slot: string;
  roles: string[];
  identities: string[];
  notes: string | null;
};

export type WorkflowApprovalRecordDto = {
  id: string;
  subject_kind: string;
  base_uid: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  approved_version_uid: string | null;
  approved_statement_hash: string | null;
  notes: string | null;
};

export type ProjectWorkflowProfileDto = {
  project_id: string;
  workflow_profile_id: string | null;
  profile: WorkflowProfileDetailDto | null;
};

export type ListWorkflowProfilesInput = PageQuery & { projectId: string };
export type GetWorkflowProfileInput = { projectId: string; profileId: string };
export type GetProjectWorkflowProfileInput = { projectId: string };
export type ListWorkflowGatesInput = PageQuery & { projectId: string };
export type GetWorkflowGateInput = { projectId: string; gateId: string };
export type ListWorkflowActionHooksInput = PageQuery & { projectId: string };
export type GetWorkflowActionHookInput = { projectId: string; hookId: string };
export type ListWorkflowSubjectKindsInput = PageQuery & { projectId: string };
export type GetWorkflowSubjectKindInput = { projectId: string; subjectKindId: string };
export type ListWorkflowRoleBindingsInput = PageQuery & { projectId: string; profileId?: string };
export type GetWorkflowRoleBindingInput = { projectId: string; bindingId: string };
export type ListWorkflowApprovalRecordsInput = PageQuery & { projectId: string };
export type GetWorkflowApprovalRecordInput = { projectId: string; recordId: string };
export type GetLineApprovalStateInput = { projectId: string; baseUid: string };

export type WorkflowLineApprovalStateDto = {
  base_uid: string;
  approval: WorkflowApprovalRecordDto | null;
};

const notFound = (detail: string) => err("not_found", detail);
const profileNotFound = () => notFound("Workflow profile not found");
const gateNotFound = () => notFound("Workflow gate not found");
const hookNotFound = () => notFound("Workflow action hook not found");
const kindNotFound = () => notFound("Workflow subject kind not found");
const bindingNotFound = () => notFound("Workflow role binding not found");
const recordNotFound = () => notFound("Workflow approval record not found");
const lineNotFound = () => notFound("Requirement line not found");

async function projectClientId(ctx: RequestContext, projectId: string): Promise<string | null> {
  const r = await ctx.pool.query<{ client_id: string }>(`SELECT client_id FROM projects WHERE id = $1`, [projectId]);
  return r.rows[0]?.client_id ?? null;
}

async function visibleProfileIds(ctx: RequestContext, projectId: string): Promise<string[] | null> {
  const clientId = await projectClientId(ctx, projectId);
  if (!clientId) return null;
  const r = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM workflow_profiles
      WHERE (scope = 'project' AND project_id = $1)
         OR (scope = 'client' AND client_id = $2 AND (project_id IS NULL OR project_id = ''))
      ORDER BY id ASC`,
    [projectId, clientId],
  );
  return r.rows.map((row) => row.id);
}

function mapProfile(row: Record<string, unknown>): WorkflowProfileDetailDto {
  return {
    id: String(row.id),
    title: String(row.title),
    scope: String(row.scope),
    client_id: String(row.client_id),
    project_id: row.project_id == null ? null : String(row.project_id),
    gate_ids: (row.gate_ids as string[]) ?? [],
    enabled_optional_gates: (row.enabled_optional_gates as string[]) ?? [],
    disabled_optional_gates: (row.disabled_optional_gates as string[]) ?? [],
    planning_gate_actions: (row.planning_gate_actions as string[]) ?? [],
    action_hook_ids: (row.action_hook_ids as string[]) ?? [],
    notes: row.notes == null ? null : String(row.notes),
  };
}

export async function getProjectWorkflowProfile(
  ctx: RequestContext,
  input: GetProjectWorkflowProfileInput,
): Promise<ServiceResult<ProjectWorkflowProfileDto>> {
  const clientId = await projectClientId(ctx, input.projectId);
  if (!clientId) return profileNotFound();
  const proj = await ctx.pool.query<{ workflow_profile_id: string | null }>(
    `SELECT workflow_profile_id FROM projects WHERE id = $1`,
    [input.projectId],
  );
  const profileId = proj.rows[0]?.workflow_profile_id ?? null;
  if (!profileId) {
    return ok({ project_id: input.projectId, workflow_profile_id: null, profile: null });
  }
  const visible = await visibleProfileIds(ctx, input.projectId);
  if (!visible?.includes(profileId)) return profileNotFound();
  const row = await ctx.pool.query(`SELECT * FROM workflow_profiles WHERE id = $1`, [profileId]);
  if (!row.rows[0]) return profileNotFound();
  return ok({
    project_id: input.projectId,
    workflow_profile_id: profileId,
    profile: mapProfile(row.rows[0] as Record<string, unknown>),
  });
}

export async function listWorkflowProfiles(
  ctx: RequestContext,
  input: ListWorkflowProfilesInput,
): Promise<ServiceResult<PageResult<WorkflowProfileSummaryDto>>> {
  const ids = await visibleProfileIds(ctx, input.projectId);
  if (!ids) return profileNotFound();
  const total = ids.length;
  const slice = ids.slice(input.offset, input.offset + input.limit);
  if (slice.length === 0) {
    return ok({ items: [], limit: input.limit, offset: input.offset, total });
  }
  const res = await ctx.pool.query<WorkflowProfileSummaryDto>(
    `SELECT id, title, scope, client_id, project_id FROM workflow_profiles WHERE id = ANY($1::text[]) ORDER BY id ASC`,
    [slice],
  );
  const byId = new Map(res.rows.map((r) => [r.id, r]));
  const items = slice.map((id) => byId.get(id)).filter((r): r is WorkflowProfileSummaryDto => !!r);
  return ok({ items, limit: input.limit, offset: input.offset, total });
}

export async function getWorkflowProfile(
  ctx: RequestContext,
  input: GetWorkflowProfileInput,
): Promise<ServiceResult<WorkflowProfileDetailDto>> {
  const visible = await visibleProfileIds(ctx, input.projectId);
  if (!visible?.includes(input.profileId)) return profileNotFound();
  const row = await ctx.pool.query(`SELECT * FROM workflow_profiles WHERE id = $1`, [input.profileId]);
  if (!row.rows[0]) return profileNotFound();
  return ok(mapProfile(row.rows[0] as Record<string, unknown>));
}

export async function listWorkflowGates(
  ctx: RequestContext,
  input: ListWorkflowGatesInput,
): Promise<ServiceResult<PageResult<WorkflowGateDto>>> {
  if (!(await projectClientId(ctx, input.projectId))) return gateNotFound();
  const total = (await ctx.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM workflow_gates`)).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<WorkflowGateDto>(
    `SELECT id, subject_kinds, mode, predicate, approver_slots, on_fail, deny_fixture, notes
       FROM workflow_gates ORDER BY id ASC LIMIT $1 OFFSET $2`,
    [input.limit, input.offset],
  );
  return ok({ items: res.rows, limit: input.limit, offset: input.offset, total });
}

export async function getWorkflowGate(
  ctx: RequestContext,
  input: GetWorkflowGateInput,
): Promise<ServiceResult<WorkflowGateDto>> {
  if (!(await projectClientId(ctx, input.projectId))) return gateNotFound();
  const res = await ctx.pool.query<WorkflowGateDto>(
    `SELECT id, subject_kinds, mode, predicate, approver_slots, on_fail, deny_fixture, notes
       FROM workflow_gates WHERE id = $1`,
    [input.gateId],
  );
  return res.rows[0] ? ok(res.rows[0]) : gateNotFound();
}

export async function listWorkflowActionHooks(
  ctx: RequestContext,
  input: ListWorkflowActionHooksInput,
): Promise<ServiceResult<PageResult<WorkflowActionHookDto>>> {
  if (!(await projectClientId(ctx, input.projectId))) return hookNotFound();
  const total =
    (await ctx.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM workflow_action_hooks`)).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<WorkflowActionHookDto>(
    `SELECT id, action_id, subject_kind, gates_before, effects_after, notes
       FROM workflow_action_hooks ORDER BY id ASC LIMIT $1 OFFSET $2`,
    [input.limit, input.offset],
  );
  return ok({ items: res.rows, limit: input.limit, offset: input.offset, total });
}

export async function getWorkflowActionHook(
  ctx: RequestContext,
  input: GetWorkflowActionHookInput,
): Promise<ServiceResult<WorkflowActionHookDto>> {
  if (!(await projectClientId(ctx, input.projectId))) return hookNotFound();
  const res = await ctx.pool.query<WorkflowActionHookDto>(
    `SELECT id, action_id, subject_kind, gates_before, effects_after, notes FROM workflow_action_hooks WHERE id = $1`,
    [input.hookId],
  );
  return res.rows[0] ? ok(res.rows[0]) : hookNotFound();
}

export async function listWorkflowSubjectKinds(
  ctx: RequestContext,
  input: ListWorkflowSubjectKindsInput,
): Promise<ServiceResult<PageResult<WorkflowSubjectKindDto>>> {
  if (!(await projectClientId(ctx, input.projectId))) return kindNotFound();
  const total =
    (await ctx.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM workflow_subject_kinds`)).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<WorkflowSubjectKindDto>(
    `SELECT id, backing, kind_filter, notes FROM workflow_subject_kinds ORDER BY id ASC LIMIT $1 OFFSET $2`,
    [input.limit, input.offset],
  );
  return ok({ items: res.rows, limit: input.limit, offset: input.offset, total });
}

export async function getWorkflowSubjectKind(
  ctx: RequestContext,
  input: GetWorkflowSubjectKindInput,
): Promise<ServiceResult<WorkflowSubjectKindDto>> {
  if (!(await projectClientId(ctx, input.projectId))) return kindNotFound();
  const res = await ctx.pool.query<WorkflowSubjectKindDto>(
    `SELECT id, backing, kind_filter, notes FROM workflow_subject_kinds WHERE id = $1`,
    [input.subjectKindId],
  );
  return res.rows[0] ? ok(res.rows[0]) : kindNotFound();
}

export async function listWorkflowRoleBindings(
  ctx: RequestContext,
  input: ListWorkflowRoleBindingsInput,
): Promise<ServiceResult<PageResult<WorkflowRoleBindingDto>>> {
  const visible = await visibleProfileIds(ctx, input.projectId);
  if (!visible) return bindingNotFound();
  let profileFilter = visible;
  if (input.profileId) {
    if (!visible.includes(input.profileId)) return bindingNotFound();
    profileFilter = [input.profileId];
  }
  const total =
    (
      await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM workflow_role_bindings WHERE profile_id = ANY($1::text[])`,
        [profileFilter],
      )
    ).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<WorkflowRoleBindingDto>(
    `SELECT id, profile_id, gate_id, slot, roles, identities, notes
       FROM workflow_role_bindings WHERE profile_id = ANY($1::text[])
       ORDER BY profile_id ASC, id ASC LIMIT $2 OFFSET $3`,
    [profileFilter, input.limit, input.offset],
  );
  return ok({ items: res.rows, limit: input.limit, offset: input.offset, total });
}

export async function getWorkflowRoleBinding(
  ctx: RequestContext,
  input: GetWorkflowRoleBindingInput,
): Promise<ServiceResult<WorkflowRoleBindingDto>> {
  const visible = await visibleProfileIds(ctx, input.projectId);
  if (!visible) return bindingNotFound();
  const res = await ctx.pool.query<WorkflowRoleBindingDto>(
    `SELECT id, profile_id, gate_id, slot, roles, identities, notes FROM workflow_role_bindings WHERE id = $1`,
    [input.bindingId],
  );
  const row = res.rows[0];
  if (!row || !visible.includes(row.profile_id)) return bindingNotFound();
  return ok(row);
}

export async function listWorkflowApprovalRecords(
  ctx: RequestContext,
  input: ListWorkflowApprovalRecordsInput,
): Promise<ServiceResult<PageResult<WorkflowApprovalRecordDto>>> {
  if (!(await projectClientId(ctx, input.projectId))) return recordNotFound();
  const total =
    (
      await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM workflow_approval_records WHERE project_id = $1`,
        [input.projectId],
      )
    ).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<{
    id: string;
    subject_kind: string;
    base_uid: string;
    status: string;
    approved_by: string | null;
    approved_at: string | null;
    approved_version_uid: string | null;
    approved_statement_hash: string | null;
    notes: string | null;
  }>(
    `SELECT id, subject_kind, base_uid, status, approved_by, approved_at::text AS approved_at,
            approved_version_uid, approved_statement_hash, notes
       FROM workflow_approval_records WHERE project_id = $1
       ORDER BY base_uid ASC, id ASC LIMIT $2 OFFSET $3`,
    [input.projectId, input.limit, input.offset],
  );
  return ok({ items: res.rows, limit: input.limit, offset: input.offset, total });
}

export async function getWorkflowApprovalRecord(
  ctx: RequestContext,
  input: GetWorkflowApprovalRecordInput,
): Promise<ServiceResult<WorkflowApprovalRecordDto>> {
  if (!(await projectClientId(ctx, input.projectId))) return recordNotFound();
  const res = await ctx.pool.query<WorkflowApprovalRecordDto>(
    `SELECT id, subject_kind, base_uid, status, approved_by, approved_at::text AS approved_at,
            approved_version_uid, approved_statement_hash, notes
       FROM workflow_approval_records WHERE project_id = $1 AND id = $2`,
    [input.projectId, input.recordId],
  );
  return res.rows[0] ? ok(res.rows[0]) : recordNotFound();
}

export async function getLineApprovalState(
  ctx: RequestContext,
  input: GetLineApprovalStateInput,
): Promise<ServiceResult<WorkflowLineApprovalStateDto>> {
  if (!(await projectClientId(ctx, input.projectId))) return lineNotFound();
  const line = await ctx.pool.query(
    `SELECT 1 FROM requirement_lines WHERE project_id = $1 AND base_uid = $2`,
    [input.projectId, input.baseUid],
  );
  if (!line.rowCount) return lineNotFound();
  const res = await ctx.pool.query<WorkflowApprovalRecordDto>(
    `SELECT id, subject_kind, base_uid, status, approved_by, approved_at::text AS approved_at,
            approved_version_uid, approved_statement_hash, notes
       FROM workflow_approval_records WHERE project_id = $1 AND base_uid = $2
       ORDER BY subject_kind ASC LIMIT 1`,
    [input.projectId, input.baseUid],
  );
  return ok({ base_uid: input.baseUid, approval: res.rows[0] ?? null });
}
