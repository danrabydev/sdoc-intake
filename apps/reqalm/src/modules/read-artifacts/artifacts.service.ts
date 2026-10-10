import { createHash } from "node:crypto";
import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { PageQuery, PageResult } from "../../core/paging.js";
import type { RequestContext } from "../../core/request-context.js";

export type CapabilityArtifactDto = {
  id: string;
  kind: string;
  uri: string;
  position: number;
};

export type FileAttachmentLatestDto = {
  id: string;
  version_id: string;
  version_n: number;
  display_name: string;
  size_bytes: number;
  media_type: string;
  sha256: string;
  scan_state: string;
  uploaded_by: string;
  created_at: string;
  is_latest: true;
};

export type ListVersionArtifactsInput = PageQuery & { projectId: string; versionUid: string };
export type ListVersionAttachmentsInput = PageQuery & { projectId: string; versionUid: string };

const parentMissing = () => err("not_found", "Requirement version not found");

export function stableCapabilityArtifactId(versionUid: string, position: number): string {
  const digest = createHash("sha256").update(`${versionUid}\0${position}`, "utf8").digest("hex");
  return `art_${digest.slice(0, 26)}`;
}

async function versionInProject(
  ctx: RequestContext,
  projectId: string,
  versionUid: string,
): Promise<boolean> {
  const r = await ctx.pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM requirement_versions WHERE uid = $1 AND project_id = $2 LIMIT 1`,
    [versionUid, projectId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function listVersionArtifacts(
  ctx: RequestContext,
  input: ListVersionArtifactsInput,
): Promise<ServiceResult<PageResult<CapabilityArtifactDto>>> {
  if (!(await versionInProject(ctx, input.projectId, input.versionUid))) return parentMissing();
  const total =
    (
      await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM capability_artifacts
           WHERE project_id = $1 AND requirement_version_uid = $2`,
        [input.projectId, input.versionUid],
      )
    ).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<{ kind: string; uri: string; position: number }>(
    `SELECT kind, uri, position FROM capability_artifacts
       WHERE project_id = $1 AND requirement_version_uid = $2
       ORDER BY position ASC, kind ASC, uri ASC
       LIMIT $3 OFFSET $4`,
    [input.projectId, input.versionUid, input.limit, input.offset],
  );
  const items = res.rows.map((row) => ({
    id: stableCapabilityArtifactId(input.versionUid, row.position),
    kind: row.kind,
    uri: row.uri,
    position: row.position,
  }));
  return ok({ items, limit: input.limit, offset: input.offset, total });
}

type AttachmentRow = {
  id: string;
  display_name: string;
  version_id: string;
  version_n: number;
  size_bytes: number;
  media_type: string;
  sha256: string;
  scan_state: string;
  uploaded_by: string;
  created_at: string;
};

export async function listVersionAttachments(
  ctx: RequestContext,
  input: ListVersionAttachmentsInput,
): Promise<ServiceResult<PageResult<FileAttachmentLatestDto>>> {
  if (!(await versionInProject(ctx, input.projectId, input.versionUid))) return parentMissing();
  const total =
    (
      await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM file_attachments
           WHERE project_id = $1 AND parent_uid = $2 AND deleted_at IS NULL`,
        [input.projectId, input.versionUid],
      )
    ).rows[0]?.c ?? 0;
  const res = await ctx.pool.query<AttachmentRow>(
    `
    SELECT fa.id, fa.display_name, fav.id AS version_id, fav.version_n,
           b.size_bytes, b.media_type, b.sha256, fav.scan_state, fav.uploaded_by,
           fav.created_at::text AS created_at
      FROM file_attachments fa
      JOIN LATERAL (
        SELECT * FROM file_attachment_versions
         WHERE attachment_id = fa.id
         ORDER BY version_n DESC LIMIT 1
      ) fav ON true
      JOIN attachment_blobs b ON b.id = fav.blob_id
     WHERE fa.project_id = $1 AND fa.parent_uid = $2 AND fa.deleted_at IS NULL
     ORDER BY fa.id ASC
     LIMIT $3 OFFSET $4
    `,
    [input.projectId, input.versionUid, input.limit, input.offset],
  );
  const items: FileAttachmentLatestDto[] = res.rows.map((row) => ({
    id: row.id,
    version_id: row.version_id,
    version_n: row.version_n,
    display_name: row.display_name,
    size_bytes: Number(row.size_bytes),
    media_type: row.media_type,
    sha256: row.sha256,
    scan_state: row.scan_state,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
    is_latest: true as const,
  }));
  return ok({ items, limit: input.limit, offset: input.offset, total });
}
