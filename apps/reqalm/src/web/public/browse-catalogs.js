/** Catalog browse screens (read-only). */

import { el } from "./browse-dom.js";
import {
  isValidCatalogId,
  isValidControlId,
  isValidImprintId,
  isValidSlugId,
  loadJson,
} from "./browse-core.js";
import { imprintShortLabel, relationPeerChip } from "./browse-relations.js";

function appProjectHref(projectId) {
  if (!isValidSlugId(projectId)) return null;
  return `/app/projects/${encodeURIComponent(projectId)}`;
}

function renderNotFound(container) {
  container.replaceChildren(
    el("h1", { text: "Not found" }),
    el("p", { className: "muted", text: "Not found or you don't have access." }),
    el("p", {}, [el("a", { href: "/app/clients", text: "Back to clients" })]),
  );
}

function renderLoadError(container, title = "Catalogs") {
  container.replaceChildren(
    el("h1", { text: title }),
    el("p", { className: "catalog-load-error error", role: "alert", text: "Could not load catalog data." }),
  );
}

export function catalogsListHref(projectId) {
  if (!isValidSlugId(projectId)) return null;
  return `/app/projects/${encodeURIComponent(projectId)}/catalogs`;
}

export function catalogImprintHref(projectId, catalogId, imprintId) {
  if (!isValidSlugId(projectId) || !isValidCatalogId(catalogId) || !isValidImprintId(imprintId)) return null;
  return `/app/projects/${encodeURIComponent(projectId)}/catalogs/${encodeURIComponent(catalogId)}/imprints/${encodeURIComponent(imprintId)}`;
}

export function catalogControlHref(projectId, catalogId, imprintId, controlId) {
  const base = catalogImprintHref(projectId, catalogId, imprintId);
  if (!base || !isValidControlId(controlId)) return null;
  return `${base}/controls/${encodeURIComponent(controlId)}`;
}

export function catalogsApiPath(projectId) {
  if (!isValidSlugId(projectId)) return null;
  return `/api/v1/projects/${encodeURIComponent(projectId)}/catalogs`;
}

export function imprintControlsApiPath(projectId, catalogId, imprintId, limit, offset) {
  if (!isValidSlugId(projectId) || !isValidCatalogId(catalogId) || !isValidImprintId(imprintId)) return null;
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return `/api/v1/projects/${encodeURIComponent(projectId)}/catalogs/${encodeURIComponent(catalogId)}/imprints/${encodeURIComponent(imprintId)}/controls?${p}`;
}

export function imprintControlApiPath(projectId, catalogId, imprintId, controlId) {
  if (!isValidSlugId(projectId) || !isValidCatalogId(catalogId) || !isValidImprintId(imprintId) || !isValidControlId(controlId)) {
    return null;
  }
  return `/api/v1/projects/${encodeURIComponent(projectId)}/catalogs/${encodeURIComponent(catalogId)}/imprints/${encodeURIComponent(imprintId)}/controls/${encodeURIComponent(controlId)}`;
}

export function pickPrimaryImprint(imprints) {
  if (!imprints?.length) return null;
  const published = imprints.find((i) => i.status === "published");
  return published ?? imprints[0];
}

function imprintLabel(imprint) {
  if (!imprint) return "—";
  const short = imprintShortLabel(imprint.id);
  const ver = imprint.version_label?.trim();
  if (ver && short) return `${short} (${ver})`;
  return imprint.id || "—";
}

function linePeerKind(lineId) {
  return typeof lineId === "string" && lineId.startsWith("CAP-") ? "capability" : "requirement";
}

export function conformingLineChip(line, anchorProjectId) {
  const peerProject = line.project_id ?? anchorProjectId;
  const kind = linePeerKind(line.id);
  const link = {
    trace_suspect: (line.pins ?? []).some((p) => p.trace_suspect),
    peer: {
      id: line.id,
      title: line.title,
      kind,
      type: kind,
      project_id: peerProject,
    },
  };
  return relationPeerChip(link, anchorProjectId);
}

export function groupControlsByFamily(items) {
  const byFamily = new Map();
  for (const item of items) {
    const family = item.family?.trim() || "Other";
    const bucket = byFamily.get(family) ?? [];
    if (!byFamily.has(family)) byFamily.set(family, bucket);
    bucket.push(item);
  }
  return [...byFamily.entries()].sort(([a], [b]) => a.localeCompare(b));
}

async function fetchAllControls(apiFn, projectId, catalogId, imprintId, limit = 100) {
  const items = [];
  let offset = 0;
  let total = 0;
  for (;;) {
    const path = imprintControlsApiPath(projectId, catalogId, imprintId, limit, offset);
    if (!path) return { kind: "error" };
    const res = await loadJson(apiFn, path);
    if (res.kind !== "ok") return res;
    const page = res.data;
    total = page.total ?? 0;
    items.push(...(page.items ?? []));
    offset += page.limit ?? limit;
    if (offset >= total || !(page.items?.length)) break;
  }
  return { kind: "ok", data: { items, total } };
}

async function imprintControlTotal(apiFn, projectId, catalogId, imprintId) {
  const path = imprintControlsApiPath(projectId, catalogId, imprintId, 1, 0);
  if (!path) return { kind: "error" };
  const res = await loadJson(apiFn, path);
  if (res.kind !== "ok") return res;
  return { kind: "ok", data: res.data.total ?? 0 };
}

function catalogTitleLink(projectId, cat, imprint) {
  const title = cat.title || cat.id;
  const href = catalogImprintHref(projectId, cat.id, imprint?.id ?? "");
  if (href && imprint && isValidCatalogId(cat.id) && isValidImprintId(imprint.id)) {
    return el("a", { href, text: title });
  }
  return el("span", { text: title });
}

export async function renderCatalogsList(container, { apiFn, projectId }) {
  if (!isValidSlugId(projectId)) return renderNotFound(container);
  const listPath = catalogsApiPath(projectId);
  if (!listPath) return renderNotFound(container);
  const result = await loadJson(apiFn, listPath);
  if (result.kind === "auth") return;
  if (result.kind === "error") return renderLoadError(container);
  if (result.kind !== "ok") return renderNotFound(container);
  const payload = result.data;
  container.replaceChildren(el("h1", { text: "Catalogs" }));
  const catalogs = payload.catalogs ?? [];
  if (!catalogs.length) {
    container.append(el("p", { className: "empty-state", text: "No catalogs visible for this project." }));
    return;
  }

  const rows = [];
  for (const cat of catalogs) {
    const imprint = pickPrimaryImprint(cat.imprints);
    let controlCount = "—";
    if (imprint && isValidCatalogId(cat.id) && isValidImprintId(imprint.id)) {
      const totalRes = await imprintControlTotal(apiFn, projectId, cat.id, imprint.id);
      if (totalRes.kind === "ok") controlCount = String(totalRes.data);
    }
    rows.push([
      el("td", {}, [catalogTitleLink(projectId, cat, imprint)]),
      el("td", { text: cat.is_standard ? "Standard" : "Project" }),
      el("td", { text: imprintLabel(imprint) }),
      el("td", { text: controlCount }),
      el("td", {}, [el("code", { text: cat.id })]),
    ]);
  }

  const table = el("table", { className: "data-table" });
  const thead = el("thead");
  const hr = el("tr");
  for (const h of ["Catalog", "Scope", "Imprint", "Controls", "ID"]) hr.append(el("th", { text: h }));
  thead.append(hr);
  table.append(thead);
  const tbody = el("tbody");
  for (const cells of rows) {
    const tr = el("tr");
    for (const cell of cells) tr.append(cell);
    tbody.append(tr);
  }
  table.append(tbody);
  container.append(table);
}

function catalogImprintBreadcrumb(projectId, catalogTitle, catalogId, imprintId) {
  const crumbs = [];
  const projectHref = appProjectHref(projectId);
  if (projectHref) crumbs.push(el("a", { href: projectHref, text: "Project" }));
  else crumbs.push(el("span", { text: "Project" }));
  crumbs.push(el("span", { text: " / " }));
  const listHref = catalogsListHref(projectId);
  if (listHref) crumbs.push(el("a", { href: listHref, text: "Catalogs" }));
  else crumbs.push(el("span", { text: "Catalogs" }));
  crumbs.push(el("span", { text: ` / ${catalogTitle || catalogId}` }));
  crumbs.push(el("span", { text: ` / ${imprintShortLabel(imprintId) || imprintId}` }));
  return el("nav", { className: "breadcrumb" }, crumbs);
}

export async function renderCatalogImprintDetail(container, { apiFn, projectId, catalogId, imprintId, offset = 0, limit = 100 }) {
  if (!isValidSlugId(projectId) || !isValidCatalogId(catalogId) || !isValidImprintId(imprintId)) {
    return renderNotFound(container);
  }
  const listPath = catalogsApiPath(projectId);
  if (!listPath) return renderNotFound(container);
  const catsRes = await loadJson(apiFn, listPath);
  if (catsRes.kind === "auth") return;
  if (catsRes.kind === "error") return renderLoadError(container, catalogId);
  if (catsRes.kind !== "ok") return renderNotFound(container);
  const catalog = (catsRes.data.catalogs ?? []).find((c) => c.id === catalogId);
  if (!catalog?.imprints?.some((i) => i.id === imprintId)) return renderNotFound(container);

  const controlsRes = await fetchAllControls(apiFn, projectId, catalogId, imprintId, limit);
  if (controlsRes.kind === "auth") return;
  if (controlsRes.kind === "error") {
    container.replaceChildren(
      catalogImprintBreadcrumb(projectId, catalog.title, catalogId, imprintId),
      el("h1", { text: catalog.title || catalogId }),
      el("p", { className: "catalog-load-error error", role: "alert", text: "Could not load catalog data." }),
    );
    return;
  }
  if (controlsRes.kind !== "ok") return renderNotFound(container);

  container.replaceChildren(
    catalogImprintBreadcrumb(projectId, catalog.title, catalogId, imprintId),
    el("h1", { text: catalog.title || catalogId }),
    el("p", { className: "muted" }, [
      el("code", { text: catalogId }),
      el("span", { text: ` · imprint ${imprintId}` }),
    ]),
  );

  const items = controlsRes.data.items ?? [];
  if (!items.length) {
    container.append(el("p", { className: "empty-state", text: "No controls in this imprint." }));
    return;
  }

  for (const [family, controls] of groupControlsByFamily(items)) {
    const section = el("section", { className: "catalog-family-section" });
    section.append(el("h2", { className: "catalog-family-heading", text: family }));
    const table = el("table", { className: "data-table catalog-family-table" });
    const thead = el("thead");
    const hr = el("tr");
    for (const h of ["Control", "Title", "Conforming"]) hr.append(el("th", { text: h }));
    thead.append(hr);
    table.append(thead);
    const tbody = el("tbody");
    for (const ctrl of controls.sort((a, b) => a.id.localeCompare(b.id))) {
      const tr = el("tr");
      const controlHref = catalogControlHref(projectId, catalogId, imprintId, ctrl.id);
      tr.append(
        el("td", {}, [
          el("a", { href: controlHref || "/app/evil", text: ctrl.id }),
        ]),
        el("td", { text: ctrl.title ?? "—" }),
        el("td", { text: String(ctrl.conforming_count ?? 0) }),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    container.append(section);
  }
}

export async function renderCatalogControlDetail(container, { apiFn, projectId, catalogId, imprintId, controlId }) {
  if (
    !isValidSlugId(projectId) ||
    !isValidCatalogId(catalogId) ||
    !isValidImprintId(imprintId) ||
    !isValidControlId(controlId)
  ) {
    return renderNotFound(container);
  }
  const listPath = catalogsApiPath(projectId);
  if (!listPath) return renderNotFound(container);
  const catsRes = await loadJson(apiFn, listPath);
  if (catsRes.kind === "auth") return;
  if (catsRes.kind === "error") return renderLoadError(container, controlId);
  if (catsRes.kind !== "ok") return renderNotFound(container);
  const catalog = (catsRes.data.catalogs ?? []).find((c) => c.id === catalogId);
  if (!catalog?.imprints?.some((i) => i.id === imprintId)) return renderNotFound(container);

  const detailPath = imprintControlApiPath(projectId, catalogId, imprintId, controlId);
  if (!detailPath) return renderNotFound(container);
  const res = await loadJson(apiFn, detailPath);
  if (res.kind === "auth") return;
  if (res.kind === "error") {
    container.replaceChildren(
      el("p", { className: "catalog-load-error error", role: "alert", text: "Could not load catalog data." }),
    );
    return;
  }
  if (res.kind !== "ok") return renderNotFound(container);
  const ctrl = res.data;

  const imprintHref = catalogImprintHref(projectId, catalogId, imprintId);
  const crumbParts = [];
  const projectHref = appProjectHref(projectId);
  if (projectHref) crumbParts.push(el("a", { href: projectHref, text: "Project" }));
  else crumbParts.push(el("span", { text: "Project" }));
  crumbParts.push(el("span", { text: " / " }));
  const catalogsHref = catalogsListHref(projectId);
  if (catalogsHref) crumbParts.push(el("a", { href: catalogsHref, text: "Catalogs" }));
  else crumbParts.push(el("span", { text: "Catalogs" }));
  crumbParts.push(el("span", { text: " / " }));
  if (imprintHref) crumbParts.push(el("a", { href: imprintHref, text: catalog.title || catalogId }));
  else crumbParts.push(el("span", { text: catalog.title || catalogId }));
  crumbParts.push(el("span", { text: ` / ${ctrl.id}` }));

  container.replaceChildren(
    el("nav", { className: "breadcrumb" }, crumbParts),
    el("h1", { text: ctrl.title || ctrl.id }),
    el("p", { className: "muted" }, [
      el("code", { text: ctrl.id }),
      el("span", { text: ` · family ${ctrl.family ?? "—"}` }),
    ]),
  );
  if (ctrl.text) {
    container.append(el("h2", { text: "Statement" }), el("div", { className: "statement-body", text: ctrl.text }));
  }
  container.append(el("h2", { text: "Conforming lines" }));
  const lines = ctrl.conforming_lines ?? [];
  if (!lines.length) {
    container.append(el("p", { className: "muted", text: "No project lines conform to this control." }));
    return;
  }
  const list = el("ul", { className: "relation-chip-list catalog-conforming-list", role: "list" });
  for (const line of lines) {
    list.append(el("li", { className: "relation-chip-item" }, [conformingLineChip(line, projectId)]));
  }
  container.append(list);
}
