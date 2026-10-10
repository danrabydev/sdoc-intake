import type { RelationLinkDto, VisibleRelationLink } from "./requirements-relations.js";

export type VersionPickMeta = { status: string; version_n: number };

export function visibleDedupeKey(link: VisibleRelationLink): string {
  const sus = link.trace_suspect ? "1" : "0";
  const cat = link.catalog_imprint_id ?? "";
  return `${link.peer.project_id}\0${link.peer.id}\0${link.relation_kind}\0${link.direction}\0${cat}\0${sus}`;
}

export function statusRank(status: string): number {
  switch (status) {
    case "active":
      return 3;
    case "draft":
      return 2;
    case "superseded":
      return 1;
    case "obsolete":
      return 0;
    default:
      return -1;
  }
}

/** Prefer active tip, then highest version_n (tie-break for duplicate peer lines). */
export function preferVisibleRelationLink(
  candidate: VisibleRelationLink,
  incumbent: VisibleRelationLink,
  meta: Map<string, VersionPickMeta>,
): boolean {
  const c = meta.get(`${candidate.peer.project_id}\0${candidate.peer_version_id}`);
  const i = meta.get(`${incumbent.peer.project_id}\0${incumbent.peer_version_id}`);
  const cRank = c ? statusRank(c.status) : -1;
  const iRank = i ? statusRank(i.status) : -1;
  if (cRank !== iRank) return cRank > iRank;
  const cN = c?.version_n ?? -1;
  const iN = i?.version_n ?? -1;
  return cN > iN;
}

export function dedupeVisibleRelationLinks(
  links: RelationLinkDto[],
  meta: Map<string, VersionPickMeta>,
  prefer: typeof preferVisibleRelationLink = preferVisibleRelationLink,
): RelationLinkDto[] {
  const restricted: RelationLinkDto[] = [];
  const kept = new Map<string, VisibleRelationLink>();
  for (const link of links) {
    if ("restricted" in link) {
      restricted.push(link);
      continue;
    }
    const key = visibleDedupeKey(link);
    const cur = kept.get(key);
    if (!cur || prefer(link, cur, meta)) kept.set(key, link);
  }
  return [...restricted, ...kept.values()];
}
