import type pg from "pg";
import {
  WORKFLOW_ACTION_HOOK_ID,
  WORKFLOW_APPROVAL_RECORD_ID,
  WORKFLOW_GATE_ID,
  WORKFLOW_PROFILE_ID,
  WORKFLOW_ROLE_BINDING_ID,
  WORKFLOW_SUBJECT_KIND_ID,
} from "../http/project-id.js";
export class SeedValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedValidationError";
  }
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(String);
}

function assertSlug(id: string, re: RegExp, label: string): void {
  if (!re.test(id)) throw new SeedValidationError(`workflow ${label} ${id}: invalid id`);
}

export async function loadWorkflowFromSeed(
  client: pg.PoolClient,
  seed: Record<string, unknown>,
  inserted: Record<string, number>,
  baseUidProject: Map<string, string>,
  identityIds: Set<string>,
  releaseIds: Set<string>,
): Promise<void> {
  const gateIds = new Set<string>();
  for (const row of (seed.gates as Record<string, unknown>[] | undefined) ?? []) {
    const id = String(row.id);
    assertSlug(id, WORKFLOW_GATE_ID, "gate");
    gateIds.add(id);
    const r = await client.query(
      `INSERT INTO workflow_gates (id, subject_kinds, mode, predicate, approver_slots, on_fail, deny_fixture, notes)
       VALUES ($1, $2::text[], $3, $4, $5::text[], $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         subject_kinds = EXCLUDED.subject_kinds, mode = EXCLUDED.mode, predicate = EXCLUDED.predicate,
         approver_slots = EXCLUDED.approver_slots, on_fail = EXCLUDED.on_fail,
         deny_fixture = EXCLUDED.deny_fixture, notes = EXCLUDED.notes
       RETURNING (xmax = 0) AS inserted`,
      [
        id,
        strArray(row.subject_kinds),
        row.mode,
        row.predicate,
        strArray(row.approver_slots),
        row.on_fail,
        row.deny_fixture ?? null,
        row.notes ?? null,
      ],
    );
    if (r.rows[0]?.inserted) inserted.workflow_gates = (inserted.workflow_gates ?? 0) + 1;
  }

  for (const row of (seed.subject_kinds as Record<string, unknown>[] | undefined) ?? []) {
    const id = String(row.id);
    assertSlug(id, WORKFLOW_SUBJECT_KIND_ID, "subject_kind");
    const r = await client.query(
      `INSERT INTO workflow_subject_kinds (id, backing, kind_filter, notes)
       VALUES ($1, $2, $3::text[], $4)
       ON CONFLICT (id) DO UPDATE SET backing = EXCLUDED.backing, kind_filter = EXCLUDED.kind_filter, notes = EXCLUDED.notes
       RETURNING (xmax = 0) AS inserted`,
      [id, row.backing, strArray(row.kind_filter), row.notes ?? null],
    );
    if (r.rows[0]?.inserted) inserted.workflow_subject_kinds = (inserted.workflow_subject_kinds ?? 0) + 1;
  }

  for (const row of (seed.action_hooks as Record<string, unknown>[] | undefined) ?? []) {
    const id = String(row.id);
    assertSlug(id, WORKFLOW_ACTION_HOOK_ID, "action_hook");
    for (const gid of strArray(row.gates_before)) {
      if (!gateIds.has(gid)) {
        throw new SeedValidationError(`action_hook ${id}: unknown gates_before id ${gid}`);
      }
    }
    const r = await client.query(
      `INSERT INTO workflow_action_hooks (id, action_id, subject_kind, gates_before, effects_after, notes)
       VALUES ($1, $2, $3, $4::text[], $5::text[], $6)
       ON CONFLICT (id) DO UPDATE SET
         action_id = EXCLUDED.action_id, subject_kind = EXCLUDED.subject_kind,
         gates_before = EXCLUDED.gates_before, effects_after = EXCLUDED.effects_after, notes = EXCLUDED.notes
       RETURNING (xmax = 0) AS inserted`,
      [
        id,
        row.action_id,
        row.subject_kind,
        strArray(row.gates_before),
        strArray(row.effects_after),
        row.notes ?? null,
      ],
    );
    if (r.rows[0]?.inserted) inserted.workflow_action_hooks = (inserted.workflow_action_hooks ?? 0) + 1;
  }

  const profileIds = new Set<string>();
  for (const row of (seed.workflow_profiles as Record<string, unknown>[] | undefined) ?? []) {
    const id = String(row.id);
    assertSlug(id, WORKFLOW_PROFILE_ID, "profile");
    for (const gid of [...strArray(row.gate_ids), ...strArray(row.enabled_optional_gates), ...strArray(row.disabled_optional_gates)]) {
      if (!gateIds.has(gid)) {
        throw new SeedValidationError(`workflow_profile ${id}: unknown gate id ${gid}`);
      }
    }
    profileIds.add(id);
    const projectId = row.project_id == null || row.project_id === "" ? null : String(row.project_id);
    const r = await client.query(
      `INSERT INTO workflow_profiles (
         id, scope, client_id, project_id, title, gate_ids, enabled_optional_gates,
         disabled_optional_gates, planning_gate_actions, action_hook_ids, notes
       ) VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11)
       ON CONFLICT (id) DO UPDATE SET
         scope = EXCLUDED.scope, client_id = EXCLUDED.client_id, project_id = EXCLUDED.project_id,
         title = EXCLUDED.title, gate_ids = EXCLUDED.gate_ids,
         enabled_optional_gates = EXCLUDED.enabled_optional_gates,
         disabled_optional_gates = EXCLUDED.disabled_optional_gates,
         planning_gate_actions = EXCLUDED.planning_gate_actions,
         action_hook_ids = EXCLUDED.action_hook_ids, notes = EXCLUDED.notes
       RETURNING (xmax = 0) AS inserted`,
      [
        id,
        row.scope,
        row.client_id,
        projectId,
        row.title,
        strArray(row.gate_ids),
        strArray(row.enabled_optional_gates),
        strArray(row.disabled_optional_gates),
        strArray(row.planning_gate_actions),
        strArray(row.action_hook_ids),
        row.notes ?? null,
      ],
    );
    if (r.rows[0]?.inserted) inserted.workflow_profiles = (inserted.workflow_profiles ?? 0) + 1;
  }

  for (const row of (seed.role_bindings as Record<string, unknown>[] | undefined) ?? []) {
    const id = String(row.id);
    assertSlug(id, WORKFLOW_ROLE_BINDING_ID, "role_binding");
    const profileId = String(row.profile_id);
    const gateId = String(row.gate_id);
    if (!profileIds.has(profileId)) {
      throw new SeedValidationError(`role_binding ${id}: unknown profile_id ${profileId}`);
    }
    if (!gateIds.has(gateId)) {
      throw new SeedValidationError(`role_binding ${id}: unknown gate_id ${gateId}`);
    }
    const r = await client.query(
      `INSERT INTO workflow_role_bindings (id, profile_id, gate_id, slot, roles, identities, notes)
       VALUES ($1, $2, $3, $4, $5::text[], $6::text[], $7)
       ON CONFLICT (id) DO UPDATE SET
         profile_id = EXCLUDED.profile_id, gate_id = EXCLUDED.gate_id, slot = EXCLUDED.slot,
         roles = EXCLUDED.roles, identities = EXCLUDED.identities, notes = EXCLUDED.notes
       RETURNING (xmax = 0) AS inserted`,
      [id, profileId, gateId, row.slot, strArray(row.roles), strArray(row.identities), row.notes ?? null],
    );
    if (r.rows[0]?.inserted) inserted.workflow_role_bindings = (inserted.workflow_role_bindings ?? 0) + 1;
  }

  for (const row of (seed.approval_records as Record<string, unknown>[] | undefined) ?? []) {
    const id = String(row.id);
    assertSlug(id, WORKFLOW_APPROVAL_RECORD_ID, "approval_record");
    const baseUid = String(row.base_uid);
    const projectId = baseUidProject.get(baseUid);
    if (!projectId) {
      throw new SeedValidationError(`approval_record ${id}: unknown base_uid ${baseUid}`);
    }
    const by = row.by == null || row.by === "" ? null : String(row.by);
    if (by && !identityIds.has(by) && by !== "system-bootstrap") {
      throw new SeedValidationError(`approval_record ${id}: unknown by identity ${by}`);
    }
    const approvedVersion =
      row.approved_version_uid == null || row.approved_version_uid === ""
        ? null
        : String(row.approved_version_uid);
    const r = await client.query(
      `INSERT INTO workflow_approval_records (
         id, project_id, subject_kind, base_uid, status, approved_by, approved_at, notes,
         approved_version_uid, approved_statement_hash
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         project_id = EXCLUDED.project_id, subject_kind = EXCLUDED.subject_kind, base_uid = EXCLUDED.base_uid,
         status = EXCLUDED.status, approved_by = EXCLUDED.approved_by, approved_at = EXCLUDED.approved_at,
         notes = EXCLUDED.notes, approved_version_uid = EXCLUDED.approved_version_uid,
         approved_statement_hash = EXCLUDED.approved_statement_hash
       RETURNING (xmax = 0) AS inserted`,
      [
        id,
        projectId,
        row.subject_kind,
        baseUid,
        row.status,
        by,
        row.at ?? null,
        row.notes ?? null,
        approvedVersion,
        row.approved_statement_hash ?? null,
      ],
    );
    if (r.rows[0]?.inserted) inserted.workflow_approval_records = (inserted.workflow_approval_records ?? 0) + 1;
  }

  for (const row of (seed.gate_signoffs as Record<string, unknown>[] | undefined) ?? []) {
    const id = String(row.id);
    const gateId = String(row.gate_id);
    if (!gateIds.has(gateId)) {
      throw new SeedValidationError(`gate_signoff ${id}: unknown gate_id ${gateId}`);
    }
    const identityId = String(row.identity_id);
    if (!identityIds.has(identityId)) {
      throw new SeedValidationError(`gate_signoff ${id}: unknown identity_id ${identityId}`);
    }
    const subjectKind = String(row.subject_kind);
    const subjectId = String(row.subject_id);
    if (subjectKind === "Release" && !releaseIds.has(subjectId)) {
      throw new SeedValidationError(`gate_signoff ${id}: unknown release subject_id ${subjectId}`);
    }
    const r = await client.query(
      `INSERT INTO workflow_gate_signoffs (
         id, subject_kind, subject_id, gate_id, slot, identity_id, decision, signed_at, note
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9)
       ON CONFLICT (id) DO UPDATE SET
         subject_kind = EXCLUDED.subject_kind, subject_id = EXCLUDED.subject_id, gate_id = EXCLUDED.gate_id,
         slot = EXCLUDED.slot, identity_id = EXCLUDED.identity_id, decision = EXCLUDED.decision,
         signed_at = EXCLUDED.signed_at, note = EXCLUDED.note
       RETURNING (xmax = 0) AS inserted`,
      [
        id,
        subjectKind,
        subjectId,
        gateId,
        row.slot,
        identityId,
        row.decision,
        row.at,
        row.note ?? null,
      ],
    );
    if (r.rows[0]?.inserted) inserted.workflow_gate_signoffs = (inserted.workflow_gate_signoffs ?? 0) + 1;
  }
}

export async function wipeWorkflowTables(client: pg.PoolClient, projectIds: string[]): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  for (const table of [
    "workflow_role_bindings",
    "workflow_gate_signoffs",
    "workflow_approval_records",
    "workflow_profiles",
    "workflow_gates",
    "workflow_action_hooks",
    "workflow_subject_kinds",
  ] as const) {
    const sql =
      table === "workflow_approval_records"
        ? `DELETE FROM ${table} WHERE project_id = ANY($1::text[])`
        : `DELETE FROM ${table}`;
    const r = await client.query(sql, table === "workflow_approval_records" ? [projectIds] : []);
    deleted[table] = r.rowCount ?? 0;
  }
  return deleted;
}
