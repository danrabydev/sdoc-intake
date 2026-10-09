/** Requirement detail — trace relations panel (read-only). */

import { el } from "./browse-dom.js";
import { appRequirementHref, loadJson } from "./browse-core.js";

export const RELATION_KINDS = ["conforms_to", "refines", "satisfies", "uses"];
export const RELATION_KIND_COLLAPSE = 10;

export const RELATION_KIND_LABELS = {
  conforms_to: "Conforms to",
  refines: "Refines",
  satisfies: "Satisfies",
  uses: "Uses",
};

export function requirementsRelationsApiPath(projectId, requirementId) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}/relations`;
}

export function imprintShortLabel(imprintId) {
  if (!imprintId) return "";
  const base = String(imprintId).split("@")[0] ?? imprintId;
  if (base.includes("nist")) return "NIST";
  if (base.includes("stig")) return "STIG";
  if (base.length <= 12) return base;
  return `${base.slice(0, 10)}…`;
}

export function relationLinkCount(grouped) {
  if (!grouped) return 0;
  return Object.values(grouped).reduce((n, links) => n + (links?.length ?? 0), 0);
}

export function isCatalogControlLink(link) {
  return !("restricted" in link) && (link.catalog_imprint_id || link.peer?.type === "catalog_control");
}

export function peerVersionSuffix(link) {
  if ("restricted" in link) return null;
  const pv = link.peer_version_id;
  const base = link.peer?.id;
  if (!pv || !base || pv === base) return null;
  if (pv.startsWith(`${base}.`)) return pv.slice(base.length);
  return null;
}

function kindHeading(kind, direction, count) {
  const arrow = direction === "outgoing" ? "this →" : "→ this";
  const label = RELATION_KIND_LABELS[kind] ?? kind;
  return el("div", { className: "relation-kind-head" }, [
    el("span", { className: "relation-kind-badge", text: label }),
    el("span", { className: "relation-kind-meta muted", text: `${arrow} ${count} peer${count === 1 ? "" : "s"}` }),
  ]);
}

function peerStatusBadge(peer) {
  const label = peer?.kind === "control" ? "control" : peer?.kind || peer?.type || "line";
  return el("span", { className: "relation-chip-status", text: label });
}

function suspectBadge() {
  return el("span", { className: "relation-chip-suspect", text: "needs re-check" });
}

function restrictedChip() {
  return el("div", { className: "relation-chip relation-chip-restricted", role: "listitem" }, [
    el("span", { className: "relation-chip-restricted-text", text: "Restricted — you don't have access" }),
  ]);
}

function catalogChip(link) {
  const peer = link.peer;
  const title = peer.title?.trim() ? peer.title : peer.id;
  const imprint = imprintShortLabel(link.catalog_imprint_id);
  const parts = [el("code", { className: "relation-chip-id", text: peer.id }), el("span", { className: "relation-chip-title", text: title })];
  if (imprint) parts.push(el("span", { className: "relation-chip-imprint", text: imprint }));
  if (link.trace_suspect) parts.push(suspectBadge());
  return el("div", { className: "relation-chip relation-chip-catalog", role: "listitem" }, parts);
}

function requirementPeerChip(link) {
  const peer = link.peer;
  const peerProject = peer.project_id;
  const href = appRequirementHref(peerProject, peer.id);
  const titleText = peer.title?.trim() ? peer.title : null;
  const inner = [
    el("code", { className: "relation-chip-id", text: peer.id }),
    ...(titleText ? [el("span", { className: "relation-chip-title", text: titleText })] : []),
    peerStatusBadge(peer),
  ];
  const ver = peerVersionSuffix(link);
  if (ver) inner.push(el("span", { className: "relation-chip-version", text: ver }));
  if (link.trace_suspect) inner.push(suspectBadge());
  return el("a", { className: "relation-chip relation-chip-link", href, role: "listitem" }, inner);
}

export function relationPeerChip(link) {
  if ("restricted" in link) return restrictedChip();
  if (isCatalogControlLink(link)) return catalogChip(link);
  return requirementPeerChip(link);
}

function renderKindBlock(kind, direction, links) {
  const block = el("div", { className: "relation-kind-block" });
  block.append(kindHeading(kind, direction, links.length));
  const list = el("div", { className: "relation-chip-list", role: "list" });
  if (links.length <= RELATION_KIND_COLLAPSE) {
    for (const link of links) list.append(relationPeerChip(link));
    block.append(list);
    return block;
  }
  for (const link of links.slice(0, RELATION_KIND_COLLAPSE)) list.append(relationPeerChip(link));
  const hidden = el("div", { className: "relation-chip-list relation-chip-list-more", role: "list", hidden: "" });
  for (const link of links.slice(RELATION_KIND_COLLAPSE)) hidden.append(relationPeerChip(link));
  block.append(list, hidden);
  const toggle = el("button", {
    type: "button",
    className: "relation-show-all btn-secondary",
    text: `Show all ${links.length}`,
  });
  toggle.addEventListener("click", () => {
    const open = hidden.hidden;
    hidden.hidden = !open;
    toggle.textContent = open ? "Show less" : `Show all ${links.length}`;
  });
  block.append(toggle);
  return block;
}

function renderDirectionColumn(title, direction, grouped) {
  const total = relationLinkCount(grouped);
  const col = el("section", { className: "relations-direction", "data-direction": direction });
  const h3 = el("h3", { className: "relations-direction-title" });
  h3.append(document.createTextNode(`${title} `), el("span", { className: "relations-direction-count muted", text: String(total) }));
  col.append(h3);

  if (!total) {
    col.append(el("p", { className: "relations-empty muted", text: "None" }));
    return col;
  }

  for (const kind of RELATION_KINDS) {
    const links = grouped[kind];
    if (!links?.length) continue;
    col.append(renderKindBlock(kind, direction, links));
  }
  return col;
}

export function renderRelationsPanelBody(relations) {
  const wrap = el("div", { className: "relations-panel-body" });
  const columns = el("div", { className: "relations-columns" });
  columns.append(
    renderDirectionColumn("Outgoing", "outgoing", relations.outgoing),
    renderDirectionColumn("Incoming", "incoming", relations.incoming),
  );
  wrap.append(columns);
  return wrap;
}

export function relationsPanelShell() {
  return el("section", { className: "relations-panel stub-section", "aria-labelledby": "relations-heading" }, [
    el("h2", { id: "relations-heading", text: "Relationships" }),
    el("p", { className: "relations-loading muted", text: "Loading relationships…" }),
  ]);
}

export function relationsPanelError() {
  return el("p", { className: "relations-error error", role: "alert", text: "Could not load relationships." });
}

export function relationsPanelEmpty() {
  return el("p", { className: "relations-empty-state empty-state", text: "No trace links for this requirement." });
}

export async function fillRequirementRelationsPanel(panel, { apiFn, projectId, requirementId }) {
  const loading = panel.querySelector(".relations-loading");
  const result = await loadJson(apiFn, requirementsRelationsApiPath(projectId, requirementId));
  loading?.remove();
  if (result.kind === "auth") return;
  if (result.kind !== "ok") {
    panel.append(relationsPanelError());
    return;
  }
  const rel = result.data;
  const total = relationLinkCount(rel.outgoing) + relationLinkCount(rel.incoming);
  if (!total) {
    panel.append(relationsPanelEmpty());
    return;
  }
  panel.append(renderRelationsPanelBody(rel));
}
