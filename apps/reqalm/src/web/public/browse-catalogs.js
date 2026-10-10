/** Catalog browse screens (read-only). */

import { el } from "./browse-dom.js";
import {
  isValidCatalogId,
  isValidControlId,
  isValidImprintId,
  isValidSlugId,
  loadJson,
} from "./browse-core.js";

function appProjectHref(projectId) {
  return `/app/projects/${encodeURIComponent(projectId)}`;
}
import { imprintShortLabel, relationPeerChip } from "./browse-relations.js";

function renderNotFound(container) {
  container.replaceChildren(
    el("h1", { text: "Not found" }),
    el("p", { className: "muted", text: "Not found or you don't have access." }),
    el("p", {}, [el("a", { href: "/app/clients", text: "Back to clients" })]),
  );
}

export function catalogsListHref(projectId) {
  return `/app/projects/${encodeURIComponent(projectId)}/catalogs`;
}

export function catalogImprintHref(projectId, catalogId, imprintId) {
  return `/app/projects/${encodeURIComponent(projectId)}/catalogs/${encodeURIComponent(catalogId)}/imprints/${encodeURIComponent(imprintId)}`;
}

export function catalogControlHref(projectId, catalogId, imprintId, controlId) {
  return `${catalogImprintHref(projectId, catalogId, imprintId)}/controls/${encodeURIComponent(controlId)}`;
}

export function catalogsApiPath(projectId) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/catalogs`;
}

export function imprintControlsApiPath(projectId, catalogId, imprintId, limit, offset) {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return `/api/v1/projects/${encodeURIComponent(projectId)}/catalogs/${encodeURIComponent(catalogId)}/imprints/${encodeURIComponent(imprintId)}/controls?${p}`;
}

export function imprintControlApiPath(projectId, catalogId, imprintId, controlId) {
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

function groupControlsByFamily(items) {
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
    const res = await loadJson(apiFn, imprintControlsApiPath(projectId, catalogId, imprintId, limit, offset));
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
  const res = await loadJson(apiFn, imprintControlsApiPath(projectId, catalogId, imprintId, 1, 0));
  if (res.kind !== "ok") return res;
  return { kind: "ok", data: res.data.total ?? 0 };
}

export async function renderCatalogsList(container, { apiFn, projectId }) {
  if (!isValidSlugId(projectId)) return renderNotFound(container);
  const result = await loadJson(apiFn, catalogsApiPath(projectId));
  if (result.kind === "auth") return;
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
    const nameCell = el("td", {}, [
      imprint && isValidCatalogId(cat.id) && isValidImprintId(imprint.id)
        ? el("a", { href: catalogImprintHref(projectId, cat.id, imprint.id), text: cat.title || cat.id })
        : el("span", { text: cat.title || cat.id }),
    ]);
    rows.push([
      nameCell,
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
  return el("nav", { className: "breadcrumb" }, [
    el("a", { href: appProjectHref(projectId), text: "Project" }),
    el("span", { text: " / " }),
    el("a", { href: catalogsListHref(projectId), text: "Catalogs" }),
    el("span", { text: ` / ${catalogTitle || catalogId}` }),
    el("span", { text: ` / ${imprintShortLabel(imprintId) || imprintId}` }),
  ]);
}

export async function renderCatalogImprintDetail(container, { apiFn, projectId, catalogId, imprintId, offset = 0, limit = 100 }) {
  if (!isValidSlugId(projectId) || !isValidCatalogId(catalogId) || !isValidImprintId(imprintId)) {
    return renderNotFound(container);
  }
  const catsRes = await loadJson(apiFn, catalogsApiPath(projectId));
  if (catsRes.kind === "auth") return;
  if (catsRes.kind !== "ok") return renderNotFound(container);
  const catalog = (catsRes.data.catalogs ?? []).find((c) => c.id === catalogId);
  if (!catalog?.imprints?.some((i) => i.id === imprintId)) return renderNotFound(container);

  const controlsRes = await fetchAllControls(apiFn, projectId, catalogId, imprintId, limit);
  if (controlsRes.kind === "auth") return;
  if (controlsRes.kind !== "ok") return renderNotFound(container);

  container.replaceChildren(
    catalogImprintBreadcrumb(projectId, catalog.title, catalogId, imprintId),
    el("h1", { text: catalog.title || catalogId }),
    el("p", { className: "muted" }, [
      el("code", { text: catalogId }),
      document.createTextNode(` · imprint ${imprintId}`),
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
      tr.append(
        el("td", {}, [
          isValidControlId(ctrl.id)
            ? el("a", {
                href: catalogControlHref(projectId, catalogId, imprintId, ctrl.id),
                text: ctrl.id,
              })
            : el("span", { text: ctrl.id }),
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
  const catsRes = await loadJson(apiFn, catalogsApiPath(projectId));
  if (catsRes.kind === "auth") return;
  if (catsRes.kind !== "ok") return renderNotFound(container);
  const catalog = (catsRes.data.catalogs ?? []).find((c) => c.id === catalogId);
  if (!catalog?.imprints?.some((i) => i.id === imprintId)) return renderNotFound(container);

  const res = await loadJson(apiFn, imprintControlApiPath(projectId, catalogId, imprintId, controlId));
  if (res.kind === "auth") return;
  if (res.kind !== "ok") return renderNotFound(container);
  const ctrl = res.data;

  const imprintHref = catalogImprintHref(projectId, catalogId, imprintId);
  container.replaceChildren(
    el("nav", { className: "breadcrumb" }, [
      el("a", { href: appProjectHref(projectId), text: "Project" }),
      el("span", { text: " / " }),
      el("a", { href: catalogsListHref(projectId), text: "Catalogs" }),
      el("span", { text: " / " }),
      el("a", { href: imprintHref, text: catalog.title || catalogId }),
      el("span", { text: ` / ${ctrl.id}` }),
    ]),
    el("h1", { text: ctrl.title || ctrl.id }),
    el("p", { className: "muted" }, [
      el("code", { text: ctrl.id }),
      document.createTextNode(` · family ${ctrl.family ?? "—"}`),
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
