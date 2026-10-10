import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { PageQuery, PageResult } from "../../core/paging.js";
import type { RequestContext } from "../../core/request-context.js";
import { projectIdsWithPermission } from "../../rbac/enforce.js";

export type ContractSummaryDto = {
  id: string;
  title: string;
  kind: string;
  description: string | null;
  scope_count: number;
  release_count: number;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  client_id: string;
};

export type ContractDetailDto = ContractSummaryDto & {
  project_id: string;
  client_id: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  notes: string | null;
};

export type VisibleScopeLineDto = {
  uid: string;
  base: string;
  kind: string;
  status: string;
  version: number;
  project_id: string;
};

export type ContractScopeLineDto = VisibleScopeLineDto;

export type ContractReleaseDto = {
  id: string;
  name: string;
  status: string;
  planned_on: string | null;
  shipped_on: string | null;
  project_id: string;
};

export type ListContractsInput = PageQuery & { projectId: string };
export type GetContractInput = { projectId: string; contractId: string };
export type ListContractScopeInput = PageQuery & { projectId: string; contractId: string };
export type ListContractReleasesInput = { projectId: string; contractId: string };

const contractNotFound = () => err("not_found", "Contract not found");

type SummaryRow = {
  id: string;
  name: string;
  notes: string | null;
  scope_count: number;
  release_count: number;
  project_id?: string;
  client_id?: string;
  status?: string;
  starts_on?: string | null;
  ends_on?: string | null;
};

const toSummary = (r: SummaryRow): ContractSummaryDto => ({
  id: r.id,
  title: r.name,
  kind: "contract",
  description: r.notes,
  scope_count: r.scope_count,
  release_count: r.release_count,
  status: r.status ?? "—",
  starts_on: r.starts_on ?? null,
  ends_on: r.ends_on ?? null,
  client_id: r.client_id ?? "",
});

const visibleScopeCount = (n: number) =>
  `(SELECT count(*)::int FROM contract_scope cs JOIN requirement_versions v ON v.uid = cs.version_uid
     WHERE cs.contract_id = c.id AND cs.project_id = c.project_id AND v.project_id = ANY($${n}::text[]))`;

const visibleReleaseCount = (n: number) =>
  `(SELECT count(*)::int FROM contract_releases cr JOIN releases r ON r.id = cr.release_id
     WHERE cr.contract_id = c.id AND cr.project_id = c.project_id AND r.project_id = ANY($${n}::text[]))`;

async function contractRow(
  ctx: RequestContext,
  projectId: string,
  contractId: string,
): Promise<SummaryRow | null> {
  const reqProjects = await projectIdsWithPermission(ctx, "requirement:read");
  const relProjects = await projectIdsWithPermission(ctx, "release:read");
  const res = await ctx.pool.query<SummaryRow>(
    `SELECT c.id, c.project_id, c.client_id, c.name, c.status,
            c.starts_on::text AS starts_on, c.ends_on::text AS ends_on, c.notes,
            ${visibleScopeCount(3)} AS scope_count, ${visibleReleaseCount(4)} AS release_count
       FROM contracts c WHERE c.project_id = $1 AND c.id = $2`,
    [projectId, contractId, reqProjects, relProjects],
  );
  return res.rows[0] ?? null;
}

export async function listContracts(
  ctx: RequestContext,
  input: ListContractsInput,
): Promise<ServiceResult<PageResult<ContractSummaryDto>>> {
  const reqProjects = await projectIdsWithPermission(ctx, "requirement:read");
  const relProjects = await projectIdsWithPermission(ctx, "release:read");
  const total =
    (await ctx.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM contracts c WHERE c.project_id = $1`, [input.projectId]))
      .rows[0]?.c ?? 0;
  const res = await ctx.pool.query<SummaryRow>(
    `SELECT c.id, c.client_id, c.name, c.notes, c.status, c.starts_on::text AS starts_on, c.ends_on::text AS ends_on,
            ${visibleScopeCount(2)} AS scope_count, ${visibleReleaseCount(3)} AS release_count
       FROM contracts c WHERE c.project_id = $1 ORDER BY c.id ASC LIMIT $4 OFFSET $5`,
    [input.projectId, reqProjects, relProjects, input.limit, input.offset],
  );
  return ok({ items: res.rows.map(toSummary), limit: input.limit, offset: input.offset, total });
}

export async function getContract(
  ctx: RequestContext,
  input: GetContractInput,
): Promise<ServiceResult<ContractDetailDto>> {
  const row = await contractRow(ctx, input.projectId, input.contractId);
  if (!row?.project_id) return contractNotFound();
  return ok({
    ...toSummary(row),
    project_id: row.project_id,
    client_id: row.client_id!,
    status: row.status!,
    starts_on: row.starts_on ?? null,
    ends_on: row.ends_on ?? null,
    notes: row.notes,
  });
}

export async function listContractScope(
  ctx: RequestContext,
  input: ListContractScopeInput,
): Promise<ServiceResult<PageResult<ContractScopeLineDto>>> {
  if (!(await contractRow(ctx, input.projectId, input.contractId))) return contractNotFound();

  const allowed = new Set(await projectIdsWithPermission(ctx, "requirement:read"));
  const res = await ctx.pool.query<{
    version_uid: string;
    line_project_id: string;
    base_uid: string;
    line_kind: string;
    version_status: string;
    version_n: number;
  }>(
    `SELECT cs.version_uid, v.project_id AS line_project_id, v.base_uid, l.kind AS line_kind,
            v.status AS version_status, v.version_n
       FROM contract_scope cs
       JOIN requirement_versions v ON v.uid = cs.version_uid
       JOIN requirement_lines l ON l.base_uid = v.base_uid AND l.project_id = v.project_id
      WHERE cs.project_id = $1 AND cs.contract_id = $2
      ORDER BY cs.position ASC, cs.version_uid ASC`,
    [input.projectId, input.contractId],
  );

  const visible: ContractScopeLineDto[] = [];
  for (const r of res.rows) {
    if (!allowed.has(r.line_project_id)) continue;
    visible.push({
      uid: r.version_uid,
      base: r.base_uid,
      kind: r.line_kind,
      status: r.version_status,
      version: r.version_n,
      project_id: r.line_project_id,
    });
  }
  const total = visible.length;
  return ok({
    items: visible.slice(input.offset, input.offset + input.limit),
    limit: input.limit,
    offset: input.offset,
    total,
  });
}

export async function listContractReleases(
  ctx: RequestContext,
  input: ListContractReleasesInput,
): Promise<ServiceResult<{ items: ContractReleaseDto[] }>> {
  if (!(await contractRow(ctx, input.projectId, input.contractId))) return contractNotFound();

  const relProjects = await projectIdsWithPermission(ctx, "release:read");
  const res = await ctx.pool.query<ContractReleaseDto>(
    `SELECT r.id, r.name, r.status, r.project_id, r.planned_on::text AS planned_on, r.shipped_on::text AS shipped_on
       FROM contract_releases cr
       JOIN releases r ON r.id = cr.release_id
      WHERE cr.project_id = $1 AND cr.contract_id = $2 AND r.project_id = ANY($3::text[])
      ORDER BY cr.position ASC, r.id ASC`,
    [input.projectId, input.contractId, relProjects],
  );
  return ok({ items: res.rows });
}
