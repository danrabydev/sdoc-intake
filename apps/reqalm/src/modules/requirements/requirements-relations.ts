import { err, ok, type ServiceResult } from "../../core/service-result.js";
import type { RequestContext } from "../../core/request-context.js";
import { projectIdsWithPermission } from "../../rbac/enforce.js";

export type RelationPeerDto = { id: string; title: string | null; kind: string; type: string; project_id: string };
export type VisibleRelationLink = {
  relation_kind: string;
  direction: "incoming" | "outgoing";
  self_version_id: string;
  peer_version_id: string;
  peer: RelationPeerDto;
  catalog_imprint_id?: string | null;
  trace_suspect: boolean;
};
export type RestrictedRelationLink = {
  restricted: true;
  relation_kind: string;
  direction: "incoming" | "outgoing";
};
export type RelationLinkDto = VisibleRelationLink | RestrictedRelationLink;
export type RelationsGroupedDto = Record<string, RelationLinkDto[]>;
export type RequirementRelationsDto = {
  id: string;
  project_id: string;
  outgoing: RelationsGroupedDto;
  incoming: RelationsGroupedDto;
};
export type GetRequirementRelationsInput = { projectId: string; requirementId: string };

type EdgeRow = {
  from_project_id: string;
  from_uid: string;
  to_project_id: string | null;
  to_uid: string;
  kind: string;
  catalog_imprint_id: string;
  trace_suspect: boolean;
};
type LinePeerRow = {
  lookup_uid: string;
  base_uid: string;
  project_id: string;
  line_kind: string;
  line_title: string;
  mint_kind: string | null;
};

const sortLinks = (links: RelationLinkDto[]) =>
  [...links].sort((a, b) => {
    const ar = "restricted" in a;
    const br = "restricted" in b;
    if (ar !== br) return ar ? 1 : -1;
    if (ar) return 0;
    const av = a as VisibleRelationLink;
    const bv = b as VisibleRelationLink;
    return (
      av.relation_kind.localeCompare(bv.relation_kind) ||
      av.peer.id.localeCompare(bv.peer.id) ||
      av.self_version_id.localeCompare(bv.self_version_id)
    );
  });

const finalizeGrouped = (g: RelationsGroupedDto): RelationsGroupedDto => {
  const out: RelationsGroupedDto = {};
  for (const [k, links] of Object.entries(g)) if (links.length) out[k] = sortLinks(links);
  return out;
};

export async function getRequirementRelations(
  ctx: RequestContext,
  input: GetRequirementRelationsInput,
): Promise<ServiceResult<RequirementRelationsDto>> {
  const { projectId, requirementId } = input;
  if (
    !(await ctx.pool.query(`SELECT 1 FROM requirement_lines WHERE project_id = $1 AND base_uid = $2`, [
      projectId,
      requirementId,
    ])).rowCount
  ) {
    return err("not_found", "Requirement not found");
  }

  const versions = await ctx.pool.query<{ uid: string; version_n: number }>(
    `SELECT uid, version_n FROM requirement_versions WHERE project_id = $1 AND base_uid = $2`,
    [projectId, requirementId],
  );
  const touchUids = [requirementId, ...versions.rows.map((r) => r.uid)];
  const versionN = new Map(versions.rows.map((r) => [r.uid, r.version_n] as const));
  versionN.set(requirementId, Math.max(0, ...versions.rows.map((r) => r.version_n)));

  const edges = await ctx.pool.query<EdgeRow>(
    `SELECT from_project_id, from_uid, to_project_id, to_uid, kind, catalog_imprint_id, trace_suspect
       FROM trace_edges
      WHERE (from_project_id = $1 AND from_uid = ANY($2::text[]))
         OR (to_project_id = $1 AND to_uid = ANY($2::text[]))`,
    [projectId, touchUids],
  );

  const allowed = new Set(await projectIdsWithPermission(ctx, "requirement:read"));
  const deduped = dedupeEdges(edges.rows, touchUids, requirementId, versionN);
  const imprintIds = [...new Set(deduped.map((e) => e.catalog_imprint_id).filter(Boolean))];
  const { imprintCatalog, catalogMeta, catalogLabels } = await loadCatalog(ctx, deduped, imprintIds);

  const peerKeys: string[] = [];
  for (const e of deduped) {
    const out = e.from_project_id === projectId && touchUids.includes(e.from_uid);
    if (out && e.to_project_id) peerKeys.push(`${e.to_project_id}\0${e.to_uid}`);
    else if (!out && e.to_project_id === projectId) peerKeys.push(`${e.from_project_id}\0${e.from_uid}`);
  }
  const linePeers = await loadLinePeers(ctx, peerKeys);

  const outgoing: RelationsGroupedDto = {};
  const incoming: RelationsGroupedDto = {};
  for (const edge of deduped) {
    const outbound = edge.from_project_id === projectId && touchUids.includes(edge.from_uid);
    const direction = outbound ? "outgoing" : "incoming";
    const selfVersionId = outbound ? edge.from_uid : edge.to_uid;
    const peerVersionId = outbound ? edge.to_uid : edge.from_uid;
    const peerProject = outbound ? edge.to_project_id : edge.from_project_id;
    const link = buildLink(
      edge,
      direction,
      selfVersionId,
      peerVersionId,
      peerProject,
      projectId,
      allowed,
      linePeers,
      imprintCatalog,
      catalogMeta,
      catalogLabels,
    );
    const bucket = outbound ? outgoing : incoming;
    (bucket[edge.kind] ??= []).push(link);
  }

  return ok({ id: requirementId, project_id: projectId, outgoing: finalizeGrouped(outgoing), incoming: finalizeGrouped(incoming) });
}

function dedupeEdges(
  rows: EdgeRow[],
  touchUids: string[],
  anchorBase: string,
  versionN: Map<string, number>,
): EdgeRow[] {
  const kept = new Map<string, EdgeRow>();
  const passthrough: EdgeRow[] = [];
  const rank = (uid: string) => versionN.get(uid) ?? (uid.includes(".") ? -1 : 0);
  const family = (uid: string) => uid === anchorBase || uid.startsWith(`${anchorBase}.`);
  for (const e of rows) {
    const out = touchUids.includes(e.from_uid);
    const inn = touchUids.includes(e.to_uid);
    const sus = e.trace_suspect ? "1" : "0";
    if (out && family(e.from_uid)) {
      const key = `o\0${e.kind}\0${e.to_uid}\0${e.catalog_imprint_id}\0${sus}`;
      const cur = kept.get(key);
      if (!cur || rank(e.from_uid) > rank(cur.from_uid)) kept.set(key, e);
    } else if (inn && family(e.to_uid)) {
      const key = `i\0${e.kind}\0${e.from_uid}\0${e.catalog_imprint_id}\0${sus}`;
      const cur = kept.get(key);
      if (!cur || rank(e.to_uid) > rank(cur.to_uid)) kept.set(key, e);
    } else passthrough.push(e);
  }
  return [...kept.values(), ...passthrough];
}

function buildLink(
  edge: EdgeRow,
  direction: "incoming" | "outgoing",
  selfVersionId: string,
  peerVersionId: string,
  peerProject: string | null,
  anchorProject: string,
  allowed: Set<string>,
  linePeers: Map<string, LinePeerRow>,
  imprintCatalog: Map<string, string>,
  catalogMeta: Map<string, { is_standard: boolean; project_id: string | null }>,
  catalogLabels: Map<string, string>,
): RelationLinkDto {
  const stub = (): RestrictedRelationLink => ({ restricted: true, relation_kind: edge.kind, direction });
  const visible = (peer: RelationPeerDto, imprint?: string): VisibleRelationLink => ({
    relation_kind: edge.kind,
    direction,
    self_version_id: selfVersionId,
    peer_version_id: peerVersionId,
    peer,
    ...(imprint ? { catalog_imprint_id: imprint } : {}),
    trace_suspect: edge.trace_suspect,
  });

  if (peerProject) {
    if (!allowed.has(peerProject)) return stub();
    const line = linePeers.get(`${peerProject}\0${peerVersionId}`);
    if (!line) {
      return visible({
        id: peerVersionId,
        title: null,
        kind: "requirement",
        type: "requirement",
        project_id: peerProject,
      });
    }
    return visible({
      id: line.base_uid,
      title: line.line_title,
      kind: line.line_kind,
      type: line.mint_kind ?? line.line_kind,
      project_id: line.project_id,
    });
  }
  if (!edge.catalog_imprint_id) return stub();
  const catalogId = imprintCatalog.get(edge.catalog_imprint_id);
  const meta = catalogId ? catalogMeta.get(catalogId) : undefined;
  const canRead =
    meta &&
    (meta.is_standard ? allowed.has(anchorProject) : meta.project_id != null && allowed.has(meta.project_id));
  if (!catalogId || !canRead) return stub();
  const title = catalogLabels.get(`${catalogId}\0${peerVersionId}`) ?? null;
  const catalogProject =
    meta.is_standard || meta.project_id == null ? anchorProject : meta.project_id;
  return visible(
    { id: peerVersionId, title, kind: "control", type: "catalog_control", project_id: catalogProject },
    edge.catalog_imprint_id,
  );
}

async function loadCatalog(
  ctx: RequestContext,
  edges: EdgeRow[],
  imprintIds: string[],
): Promise<{
  imprintCatalog: Map<string, string>;
  catalogMeta: Map<string, { is_standard: boolean; project_id: string | null }>;
  catalogLabels: Map<string, string>;
}> {
  const imprintCatalog = new Map<string, string>();
  const catalogMeta = new Map<string, { is_standard: boolean; project_id: string | null }>();
  const catalogLabels = new Map<string, string>();
  if (imprintIds.length === 0) return { imprintCatalog, catalogMeta, catalogLabels };

  const imprints = await ctx.pool.query<{ id: string; catalog_id: string }>(
    `SELECT id, catalog_id FROM catalog_imprints WHERE id = ANY($1::text[])`,
    [imprintIds],
  );
  for (const r of imprints.rows) imprintCatalog.set(r.id, r.catalog_id);
  const catalogIds = [...new Set(imprints.rows.map((r) => r.catalog_id))];
  if (catalogIds.length) {
    const defs = await ctx.pool.query<{ id: string; is_standard: boolean; project_id: string | null }>(
      `SELECT id, is_standard, project_id FROM catalog_defs WHERE id = ANY($1::text[])`,
      [catalogIds],
    );
    for (const r of defs.rows) catalogMeta.set(r.id, r);
  }
  const labelCatalogs = new Set<string>();
  const itemUids = new Set<string>();
  for (const e of edges) {
    if (!e.catalog_imprint_id) continue;
    const cid = imprintCatalog.get(e.catalog_imprint_id);
    if (!cid) continue;
    labelCatalogs.add(cid);
    itemUids.add(e.to_uid);
  }
  if (labelCatalogs.size) {
    const labels = await ctx.pool.query<{ catalog_id: string; item_uid: string; title: string }>(
      `SELECT catalog_id, item_uid, title FROM catalog_item_labels
        WHERE catalog_id = ANY($1::text[]) AND item_uid = ANY($2::text[])`,
      [[...labelCatalogs], [...itemUids]],
    );
    for (const r of labels.rows) catalogLabels.set(`${r.catalog_id}\0${r.item_uid}`, r.title);
  }
  return { imprintCatalog, catalogMeta, catalogLabels };
}

async function loadLinePeers(ctx: RequestContext, keys: string[]): Promise<Map<string, LinePeerRow>> {
  if (!keys.length) return new Map();
  const projects: string[] = [];
  const uids: string[] = [];
  for (const k of keys) {
    const [p, u] = k.split("\0");
    projects.push(p!);
    uids.push(u!);
  }
  const res = await ctx.pool.query<LinePeerRow>(
    `WITH peer AS (SELECT unnest($1::text[]) AS project_id, unnest($2::text[]) AS lookup_uid)
     SELECT p.lookup_uid, l.base_uid, l.project_id, l.kind AS line_kind,
            COALESCE(v.title, l.title) AS line_title, v.mint_kind
       FROM peer p
       JOIN requirement_lines l ON l.project_id = p.project_id
        AND (l.base_uid = p.lookup_uid OR EXISTS (
          SELECT 1 FROM requirement_versions rv
           WHERE rv.project_id = p.project_id AND rv.uid = p.lookup_uid AND rv.base_uid = l.base_uid))
       LEFT JOIN LATERAL (
         SELECT mint_kind, title FROM requirement_versions
          WHERE project_id = l.project_id AND base_uid = l.base_uid
          ORDER BY version_n DESC LIMIT 1
       ) v ON true`,
    [projects, uids],
  );
  return new Map(res.rows.map((r) => [`${r.project_id}\0${r.lookup_uid}`, r]));
}
