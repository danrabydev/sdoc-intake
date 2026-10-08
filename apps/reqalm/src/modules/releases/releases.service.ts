import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { PageQuery, PageResult } from "../../core/paging.js";
import type { RequestContext } from "../../core/request-context.js";

export type ReleaseListFilters = PageQuery & {
  projectId: string;
  status?: string;
};

export type ReleaseSummaryDto = {
  id: string;
  name: string;
  status: string;
  planned_on: string | null;
  shipped_on: string | null;
  delivered_capability_count: number;
};

export type DeliveredCapabilityDto = {
  uid: string;
  title: string;
  status: string;
};

export type ReleaseDetailDto = ReleaseSummaryDto & {
  project_id: string;
  notes: string | null;
  delivered_capabilities: DeliveredCapabilityDto[];
};

export type GetReleaseInput = { projectId: string; releaseId: string };

/** Stable list order: planned_on descending (nulls last), then id ascending. */
const LIST_ORDER = "r.planned_on DESC NULLS LAST, r.id ASC";

const CAPABILITY_COUNT_SQL = `
  (SELECT count(*)::int
   FROM release_delivers d
   JOIN requirement_versions v ON v.uid = d.version_uid
   JOIN requirement_lines l
     ON l.base_uid = v.base_uid AND l.project_id = v.project_id AND l.kind = 'capability'
   WHERE d.release_id = r.id)`;

type SummaryRow = {
  id: string;
  name: string;
  status: string;
  planned_on: string | null;
  shipped_on: string | null;
  delivered_capability_count: number;
};

function summary(r: SummaryRow): ReleaseSummaryDto {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    planned_on: r.planned_on,
    shipped_on: r.shipped_on,
    delivered_capability_count: r.delivered_capability_count,
  };
}

export async function listReleases(
  ctx: RequestContext,
  input: ReleaseListFilters,
): Promise<ServiceResult<PageResult<ReleaseSummaryDto>>> {
  const params: unknown[] = [input.projectId];
  const where = ["r.project_id = $1"];
  let n = 2;
  if (input.status) {
    where.push(`r.status = $${n++}`);
    params.push(input.status);
  }
  const w = where.join(" AND ");
  const total =
    (await ctx.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM releases r WHERE ${w}`, params)).rows[0]?.c ??
    0;
  const res = await ctx.pool.query<SummaryRow>(
    `SELECT r.id, r.name, r.status,
            r.planned_on::text AS planned_on, r.shipped_on::text AS shipped_on,
            ${CAPABILITY_COUNT_SQL} AS delivered_capability_count
     FROM releases r WHERE ${w} ORDER BY ${LIST_ORDER} LIMIT $${n} OFFSET $${n + 1}`,
    [...params, input.limit, input.offset],
  );
  return ok({ items: res.rows.map(summary), limit: input.limit, offset: input.offset, total });
}

export async function getRelease(
  ctx: RequestContext,
  input: GetReleaseInput,
): Promise<ServiceResult<ReleaseDetailDto>> {
  const res = await ctx.pool.query<SummaryRow & { notes: string | null }>(
    `SELECT r.id, r.name, r.status,
            r.planned_on::text AS planned_on, r.shipped_on::text AS shipped_on,
            r.notes, ${CAPABILITY_COUNT_SQL} AS delivered_capability_count
     FROM releases r WHERE r.project_id = $1 AND r.id = $2`,
    [input.projectId, input.releaseId],
  );
  const row = res.rows[0];
  if (!row) return err("not_found", "Release not found");

  const caps = await ctx.pool.query<DeliveredCapabilityDto>(
    `SELECT l.base_uid AS uid, COALESCE(v.title, l.title) AS title, v.status
     FROM release_delivers d
     JOIN requirement_versions v ON v.uid = d.version_uid
     JOIN requirement_lines l
       ON l.base_uid = v.base_uid AND l.project_id = v.project_id AND l.kind = 'capability'
     WHERE d.release_id = $1
     ORDER BY d.position ASC`,
    [input.releaseId],
  );

  return ok({
    ...summary(row),
    project_id: input.projectId,
    notes: row.notes,
    delivered_capabilities: caps.rows,
  });
}
