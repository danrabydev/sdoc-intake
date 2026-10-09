import type { RequestContext } from "../../core/request-context.js";
import { projectIdsWithPermission } from "../../rbac/enforce.js";

export type CatalogMetaRow = {
  id: string;
  is_standard: boolean;
  project_id: string | null;
  title: string;
};

/** Standard catalogs are readable from any granted project; private catalogs only from their owner project. */
export function canReadCatalog(
  meta: Pick<CatalogMetaRow, "is_standard" | "project_id">,
  anchorProjectId: string,
  allowedProjectIds: ReadonlySet<string>,
): boolean {
  if (!allowedProjectIds.has(anchorProjectId)) return false;
  if (meta.is_standard) return true;
  return meta.project_id != null && allowedProjectIds.has(meta.project_id);
}

export async function allowedReadProjects(ctx: RequestContext): Promise<Set<string>> {
  return new Set(await projectIdsWithPermission(ctx, "requirement:read"));
}

export function catalogFamily(itemUid: string): string {
  if (/^V-\d+$/.test(itemUid)) return "STIG";
  const m = /^([A-Z]{1,4})-\d/.exec(itemUid);
  return m?.[1] ?? "";
}
