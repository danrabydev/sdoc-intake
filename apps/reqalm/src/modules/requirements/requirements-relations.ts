import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { RequestContext } from "../../core/request-context.js";
import { authorize, projectIdsWithPermission } from "../../rbac/enforce.js";

export type RelationPeerDto =
  | { id: string; title: string; kind: string; type: string }
  | { restricted: true };

export type RelationLinkDto = {
  relation_kind: string;
  peer: RelationPeerDto;
  catalog_imprint_id?: string | null;
  trace_suspect: boolean;
};

export type RelationsGroupedDto = Record<string, RelationLinkDto[]>;

export type RequirementRelationsDto = {
  id: string;
  project_id: string;
  outgoing: RelationsGroupedDto;
  incoming: RelationsGroupedDto;
};

export type GetRequirementRelationsInput = { projectId: string; requirementId: string };

type EdgeRow = {
  from_uid: string;
  to_uid: string;
  kind: string;
  catalog_imprint_id: string;
  trace_suspect: boolean;
};

type LinePeerRow = {
  uid: string;
  base_uid: string;
  project_id: string;
  line_kind: string;
  line_title: string;
  mint_kind: string | null;
};

type CatalogMetaRow = {
  catalog_id: string;
  is_standard: boolean;
  project_id: string | null;
};

function emptyGrouped(): RelationsGroupedDto {
  return {};
}

function pushGrouped(grouped: RelationsGroupedDto, kind: string, link: RelationLinkDto): void {
  const bucket = grouped[kind] ?? [];
  bucket.push(link);
  grouped[kind] = bucket;
}

function linePeer(row: LinePeerRow): RelationPeerDto {
  return {
    id: row.base_uid,
    title: row.line_title,
    kind: row.line_kind,
    type: row.mint_kind ?? row.line_kind,
  };
}

function catalogPeer(uid: string, title: string): RelationPeerDto {
  return { id: uid, title, kind: "control", type: "catalog_control" };
}

function externalPeer(uid: string): RelationPeerDto {
  return { id: uid, title: uid, kind: "reference", type: "external_ref" };
}

export async function getRequirementRelations(
  ctx: RequestContext,
  input: GetRequirementRelationsInput,
): Promise<ServiceResult<RequirementRelationsDto>> {
  const exists = await ctx.pool.query(
    `SELECT 1 FROM requirement_lines WHERE project_id = $1 AND base_uid = $2`,
    [input.projectId, input.requirementId],
  );
  if (!exists.rowCount) return err("not_found", "Requirement not found");

  const versionUids = await ctx.pool.query<{ uid: string }>(
    `SELECT uid FROM requirement_versions WHERE project_id = $1 AND base_uid = $2`,
    [input.projectId, input.requirementId],
  );
  const touchUids = [input.requirementId, ...versionUids.rows.map((r) => r.uid)];

  const edges = await ctx.pool.query<EdgeRow>(
    `
    SELECT from_uid, to_uid, kind, catalog_imprint_id, trace_suspect
      FROM trace_edges
     WHERE from_uid = ANY($1::text[]) OR to_uid = ANY($1::text[])
     ORDER BY kind, from_uid, to_uid
  `,
    [touchUids],
  );

  const allowedProjects = new Set(await projectIdsWithPermission(ctx, "requirement:read"));
  const imprintCatalog = await loadImprintCatalogMap(ctx);
  const catalogMeta = await loadCatalogMeta(ctx);

  const peerUids = new Set<string>();
  for (const e of edges.rows) {
    const other = touchUids.includes(e.from_uid) ? e.to_uid : e.from_uid;
    peerUids.add(other);
  }

  const linePeers = await loadLinePeers(ctx, [...peerUids]);
  const catalogLabels = await loadCatalogLabels(ctx, edges.rows, imprintCatalog);

  const outgoing = emptyGrouped();
  const incoming = emptyGrouped();

  for (const edge of edges.rows) {
    const outbound = touchUids.includes(edge.from_uid);
    const peerUid = outbound ? edge.to_uid : edge.from_uid;
    const peer = await resolvePeer(
      ctx,
      peerUid,
      edge,
      allowedProjects,
      linePeers,
      catalogLabels,
      imprintCatalog,
      catalogMeta,
    );
    const link: RelationLinkDto = {
      relation_kind: edge.kind,
      peer,
      catalog_imprint_id: edge.catalog_imprint_id || null,
      trace_suspect: edge.trace_suspect,
    };
    if (outbound) pushGrouped(outgoing, edge.kind, link);
    else pushGrouped(incoming, edge.kind, link);
  }

  return ok({
    id: input.requirementId,
    project_id: input.projectId,
    outgoing,
    incoming,
  });
}

async function loadImprintCatalogMap(ctx: RequestContext): Promise<Map<string, string>> {
  const res = await ctx.pool.query<{ id: string; catalog_id: string }>(
    `SELECT id, catalog_id FROM catalog_imprints`,
  );
  return new Map(res.rows.map((r) => [r.id, r.catalog_id]));
}

async function loadCatalogMeta(ctx: RequestContext): Promise<Map<string, CatalogMetaRow>> {
  const res = await ctx.pool.query<CatalogMetaRow>(
    `SELECT id AS catalog_id, is_standard, project_id FROM catalog_defs`,
  );
  return new Map(res.rows.map((r) => [r.catalog_id, r]));
}

async function loadLinePeers(ctx: RequestContext, uids: string[]): Promise<Map<string, LinePeerRow>> {
  if (uids.length === 0) return new Map();
  const res = await ctx.pool.query<LinePeerRow>(
    `
    WITH peer AS (SELECT unnest($1::text[]) AS peer_uid)
    SELECT p.peer_uid AS uid, l.base_uid, l.project_id, l.kind AS line_kind,
           COALESCE(v.title, l.title) AS line_title, v.mint_kind
      FROM peer p
      JOIN requirement_lines l
        ON l.base_uid = p.peer_uid
       OR EXISTS (
         SELECT 1 FROM requirement_versions rv
          WHERE rv.uid = p.peer_uid AND rv.project_id = l.project_id AND rv.base_uid = l.base_uid
       )
      JOIN LATERAL (
        SELECT mint_kind, title FROM requirement_versions
         WHERE project_id = l.project_id AND base_uid = l.base_uid
         ORDER BY version_n DESC LIMIT 1
      ) v ON true
  `,
    [uids],
  );
  const map = new Map<string, LinePeerRow>();
  for (const row of res.rows) {
    map.set(row.uid, row);
    map.set(row.base_uid, row);
  }
  return map;
}

async function loadCatalogLabels(
  ctx: RequestContext,
  edges: EdgeRow[],
  imprintCatalog: Map<string, string>,
): Promise<Map<string, string>> {
  const keys: Array<{ catalogId: string; itemUid: string }> = [];
  for (const e of edges) {
    if (!e.catalog_imprint_id) continue;
    const catalogId = imprintCatalog.get(e.catalog_imprint_id);
    if (!catalogId) continue;
    keys.push({ catalogId, itemUid: e.to_uid });
  }
  if (keys.length === 0) return new Map();
  const catalogIds = [...new Set(keys.map((k) => k.catalogId))];
  const itemUids = [...new Set(keys.map((k) => k.itemUid))];
  const res = await ctx.pool.query<{ catalog_id: string; item_uid: string; title: string }>(
    `SELECT catalog_id, item_uid, title FROM catalog_item_labels
      WHERE catalog_id = ANY($1::text[]) AND item_uid = ANY($2::text[])`,
    [catalogIds, itemUids],
  );
  return new Map(res.rows.map((r) => [`${r.catalog_id}\0${r.item_uid}`, r.title]));
}

async function canReadCatalog(
  ctx: RequestContext,
  catalogId: string,
  meta: Map<string, CatalogMetaRow>,
  allowedProjects: Set<string>,
): Promise<boolean> {
  const row = meta.get(catalogId);
  if (!row) return false;
  if (row.is_standard) return true;
  if (row.project_id) {
    if (!allowedProjects.has(row.project_id)) return false;
    return authorize(ctx.pool, ctx.identityId!, "requirement:read", row.project_id, ctx.auth?.accessToken);
  }
  return false;
}

async function resolvePeer(
  ctx: RequestContext,
  peerUid: string,
  edge: EdgeRow,
  allowedProjects: Set<string>,
  linePeers: Map<string, LinePeerRow>,
  catalogLabels: Map<string, string>,
  imprintCatalog: Map<string, string>,
  catalogMeta: Map<string, CatalogMetaRow>,
): Promise<RelationPeerDto> {
  const line = linePeers.get(peerUid);
  if (line) {
    if (!allowedProjects.has(line.project_id)) return { restricted: true };
    const okRead = await authorize(
      ctx.pool,
      ctx.identityId!,
      "requirement:read",
      line.project_id,
      ctx.auth?.accessToken,
    );
    return okRead ? linePeer(line) : { restricted: true };
  }

  if (edge.catalog_imprint_id) {
    const catalogId = imprintCatalog.get(edge.catalog_imprint_id);
    if (!catalogId || !(await canReadCatalog(ctx, catalogId, catalogMeta, allowedProjects))) {
      return { restricted: true };
    }
    const title = catalogLabels.get(`${catalogId}\0${peerUid}`) ?? peerUid;
    return catalogPeer(peerUid, title);
  }

  const nistLike = /^[A-Z]{2,3}(-|\d|\()/;
  if (nistLike.test(peerUid) && catalogMeta.has("cat-nist-global")) {
    if (await canReadCatalog(ctx, "cat-nist-global", catalogMeta, allowedProjects)) {
      const title = catalogLabels.get(`cat-nist-global\0${peerUid}`) ?? peerUid;
      return catalogPeer(peerUid, title);
    }
    return { restricted: true };
  }

  if (/^V-\d+/.test(peerUid)) {
    if (await canReadCatalog(ctx, "cat-stig-asd-v6r4", catalogMeta, allowedProjects)) {
      const title = catalogLabels.get(`cat-stig-asd-v6r4\0${peerUid}`) ?? peerUid;
      return catalogPeer(peerUid, title);
    }
    return { restricted: true };
  }

  return externalPeer(peerUid);
}
