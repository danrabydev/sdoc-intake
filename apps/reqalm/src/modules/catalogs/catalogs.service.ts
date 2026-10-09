import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { PageResult } from "../../core/paging.js";
import type { RequestContext } from "../../core/request-context.js";
import {
  allowedReadProjects,
  canReadCatalog,
  catalogFamily,
  type CatalogMetaRow,
} from "./catalog-access.js";

export type CatalogImprintDto = { id: string; version_label: string; status: string };
export type CatalogSummaryDto = {
  id: string;
  title: string;
  is_standard: boolean;
  imprints: CatalogImprintDto[];
};
export type ProjectCatalogsDto = { project_id: string; catalogs: CatalogSummaryDto[] };

export type ControlSummaryDto = {
  id: string;
  title: string;
  family: string;
  conforming_count: number;
};

export type ConformingLineDto = {
  id: string;
  title: string | null;
  status: string;
  link: { mode: "direct" } | { mode: "via"; edge_uid: string };
};

export type ControlDetailDto = {
  id: string;
  title: string;
  family: string;
  text: string | null;
  conforming_lines: ConformingLineDto[];
};

export type ListCatalogsInput = { projectId: string };
export type ListControlsInput = {
  projectId: string;
  catalogId: string;
  imprintId: string;
  limit: number;
  offset: number;
};
export type GetControlInput = {
  projectId: string;
  catalogId: string;
  imprintId: string;
  controlId: string;
};

const catalogNotFound = () => err("not_found", "Catalog not found");
const imprintNotFound = () => err("not_found", "Imprint not found");
const controlNotFound = () => err("not_found", "Control not found");

async function loadCatalogMeta(
  ctx: RequestContext,
  catalogId: string,
): Promise<CatalogMetaRow | null> {
  const r = await ctx.pool.query<CatalogMetaRow>(
    `SELECT id, is_standard, project_id, title FROM catalog_defs WHERE id = $1`,
    [catalogId],
  );
  return r.rows[0] ?? null;
}

async function assertCatalogVisible(
  ctx: RequestContext,
  projectId: string,
  catalogId: string,
): Promise<ServiceResult<CatalogMetaRow>> {
  const meta = await loadCatalogMeta(ctx, catalogId);
  if (!meta) return catalogNotFound();
  const allowed = await allowedReadProjects(ctx);
  if (!canReadCatalog(meta, projectId, allowed)) return catalogNotFound();
  return ok(meta);
}

async function assertImprintForCatalog(
  ctx: RequestContext,
  catalogId: string,
  imprintId: string,
): Promise<ServiceResult<{ catalog_id: string }>> {
  const r = await ctx.pool.query<{ catalog_id: string }>(
    `SELECT catalog_id FROM catalog_imprints WHERE id = $1`,
    [imprintId],
  );
  const row = r.rows[0];
  if (!row || row.catalog_id !== catalogId) return imprintNotFound();
  return ok(row);
}

export async function listProjectCatalogs(
  ctx: RequestContext,
  input: ListCatalogsInput,
): Promise<ServiceResult<ProjectCatalogsDto>> {
  const { projectId } = input;
  const allowed = await allowedReadProjects(ctx);

  const defs = await ctx.pool.query<CatalogMetaRow>(
    `SELECT id, is_standard, project_id, title FROM catalog_defs
      WHERE is_standard OR project_id = $1
      ORDER BY is_standard DESC, id`,
    [projectId],
  );
  const visible = defs.rows.filter((c) => canReadCatalog(c, projectId, allowed));
  if (!visible.length) return ok({ project_id: projectId, catalogs: [] });

  const ids = visible.map((c) => c.id);
  const imprints = await ctx.pool.query<{
    id: string;
    catalog_id: string;
    version_label: string;
    status: string;
  }>(
    `SELECT id, catalog_id, version_label, status FROM catalog_imprints
      WHERE catalog_id = ANY($1::text[]) ORDER BY id`,
    [ids],
  );
  const byCatalog = new Map<string, CatalogImprintDto[]>();
  for (const imp of imprints.rows) {
    const bucket = byCatalog.get(imp.catalog_id) ?? [];
    if (!byCatalog.has(imp.catalog_id)) byCatalog.set(imp.catalog_id, bucket);
    bucket.push({ id: imp.id, version_label: imp.version_label, status: imp.status });
  }

  return ok({
    project_id: projectId,
    catalogs: visible.map((c) => ({
      id: c.id,
      title: c.title,
      is_standard: c.is_standard,
      imprints: byCatalog.get(c.id) ?? [],
    })),
  });
}

export async function listImprintControls(
  ctx: RequestContext,
  input: ListControlsInput,
): Promise<ServiceResult<PageResult<ControlSummaryDto>>> {
  const vis = await assertCatalogVisible(ctx, input.projectId, input.catalogId);
  if (!vis.ok) return vis;
  const imp = await assertImprintForCatalog(ctx, input.catalogId, input.imprintId);
  if (!imp.ok) return imp;

  const totalR = await ctx.pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM catalog_item_labels WHERE catalog_id = $1`,
    [input.catalogId],
  );
  const total = totalR.rows[0]?.c ?? 0;

  const rows = await ctx.pool.query<{
    id: string;
    title: string;
    family: string;
    conforming_count: number;
  }>(
    `SELECT l.item_uid AS id, l.title, l.family,
            COALESCE(x.cnt, 0)::int AS conforming_count
       FROM catalog_item_labels l
       LEFT JOIN (
         SELECT to_uid, count(DISTINCT from_uid)::int AS cnt
           FROM trace_edges
          WHERE from_project_id = $1 AND kind = 'conforms_to' AND catalog_imprint_id = $2
          GROUP BY to_uid
       ) x ON x.to_uid = l.item_uid
      WHERE l.catalog_id = $3
      ORDER BY l.item_uid
      LIMIT $4 OFFSET $5`,
    [input.projectId, input.imprintId, input.catalogId, input.limit, input.offset],
  );

  return ok({
    items: rows.rows.map((r) => ({
      id: r.id,
      title: r.title,
      family: r.family || catalogFamily(r.id),
      conforming_count: r.conforming_count,
    })),
    limit: input.limit,
    offset: input.offset,
    total,
  });
}

export async function getImprintControl(
  ctx: RequestContext,
  input: GetControlInput,
): Promise<ServiceResult<ControlDetailDto>> {
  const vis = await assertCatalogVisible(ctx, input.projectId, input.catalogId);
  if (!vis.ok) return vis;
  const imp = await assertImprintForCatalog(ctx, input.catalogId, input.imprintId);
  if (!imp.ok) return imp;

  const label = await ctx.pool.query<{ title: string; family: string; statement: string | null }>(
    `SELECT title, family, statement FROM catalog_item_labels
      WHERE catalog_id = $1 AND item_uid = $2`,
    [input.catalogId, input.controlId],
  );
  if (!label.rowCount) return controlNotFound();

  const edges = await ctx.pool.query<{ from_uid: string; base_uid: string; line_title: string; status: string }>(
    `SELECT e.from_uid, l.base_uid,
            COALESCE(v.title, l.title) AS line_title,
            COALESCE(v.status, 'unknown') AS status
       FROM trace_edges e
       JOIN requirement_lines l ON l.project_id = e.from_project_id
        AND (l.base_uid = e.from_uid OR EXISTS (
          SELECT 1 FROM requirement_versions rv
           WHERE rv.project_id = e.from_project_id AND rv.uid = e.from_uid AND rv.base_uid = l.base_uid))
       LEFT JOIN LATERAL (
         SELECT title, status FROM requirement_versions
          WHERE project_id = l.project_id AND base_uid = l.base_uid
          ORDER BY version_n DESC LIMIT 1
       ) v ON true
      WHERE e.from_project_id = $1 AND e.kind = 'conforms_to'
        AND e.catalog_imprint_id = $2 AND e.to_uid = $3
      ORDER BY l.base_uid, e.from_uid`,
    [input.projectId, input.imprintId, input.controlId],
  );

  const conforming_lines: ConformingLineDto[] = edges.rows.map((r) => ({
    id: r.base_uid,
    title: r.line_title,
    status: r.status,
    link:
      r.from_uid === r.base_uid
        ? { mode: "direct" as const }
        : { mode: "via" as const, edge_uid: r.from_uid },
  }));

  const row = label.rows[0]!;
  return ok({
    id: input.controlId,
    title: row.title,
    family: row.family || catalogFamily(input.controlId),
    text: row.statement,
    conforming_lines,
  });
}
