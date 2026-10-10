/** Contract browse screens (read-only). */

import { el } from "./browse-dom.js";
import {
  appRequirementHref,
  isValidRequirementId,
  isValidSlugId,
  loadJson,
} from "./browse-core.js";

export const CONTRACT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidContractId(id) {
  return typeof id === "string" && CONTRACT_ID.test(id);
}

function appProjectHref(projectId) {
  if (!isValidSlugId(projectId)) return null;
  return `/app/projects/${encodeURIComponent(projectId)}`;
}

function appReleaseHref(projectId, releaseId) {
  if (!isValidSlugId(projectId) || !isValidSlugId(releaseId)) return null;
  return `/app/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(releaseId)}`;
}

function formatDate(val) {
  if (!val) return "—";
  const d = String(val).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "—";
}

function renderNotFound(container) {
  container.replaceChildren(
    el("h1", { text: "Not found" }),
    el("p", { className: "muted", text: "Not found or you don't have access." }),
    el("p", {}, [el("a", { href: "/app/clients", text: "Back to clients" })]),
  );
}

function renderLoadError(container, title = "Contracts") {
  container.replaceChildren(
    el("h1", { text: title }),
    el("p", { className: "contract-load-error error", role: "alert", text: "Could not load contract data." }),
  );
}

export function contractsListHref(projectId) {
  if (!isValidSlugId(projectId)) return null;
  return `/app/projects/${encodeURIComponent(projectId)}/contracts`;
}

export function contractDetailHref(projectId, contractId) {
  if (!isValidSlugId(projectId) || !isValidContractId(contractId)) return null;
  return `/app/projects/${encodeURIComponent(projectId)}/contracts/${encodeURIComponent(contractId)}`;
}

export function contractsApiPath(projectId, limit, offset) {
  if (!isValidSlugId(projectId)) return null;
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return `/api/v1/projects/${encodeURIComponent(projectId)}/contracts?${p}`;
}

export function contractApiPath(projectId, contractId) {
  if (!isValidSlugId(projectId) || !isValidContractId(contractId)) return null;
  return `/api/v1/projects/${encodeURIComponent(projectId)}/contracts/${encodeURIComponent(contractId)}`;
}

export function contractScopeApiPath(projectId, contractId, limit, offset) {
  if (!isValidSlugId(projectId) || !isValidContractId(contractId)) return null;
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return `/api/v1/projects/${encodeURIComponent(projectId)}/contracts/${encodeURIComponent(contractId)}/scope?${p}`;
}

export function contractReleasesApiPath(projectId, contractId) {
  if (!isValidSlugId(projectId) || !isValidContractId(contractId)) return null;
  return `/api/v1/projects/${encodeURIComponent(projectId)}/contracts/${encodeURIComponent(contractId)}/releases`;
}

/** Hard cap on scope pagination loops (contract detail must not spin on bad totals/limits). */
export const MAX_SCOPE_FETCH_PAGES = 50;

export async function fetchAllScope(apiFn, projectId, contractId, limit = 100) {
  const items = [];
  let offset = 0;
  let total = 0;
  let pages = 0;
  for (;;) {
    if (pages >= MAX_SCOPE_FETCH_PAGES) break;
    const path = contractScopeApiPath(projectId, contractId, limit, offset);
    if (!path) return { kind: "error" };
    const res = await loadJson(apiFn, path);
    if (res.kind !== "ok") return res;
    const page = res.data;
    total = page.total ?? 0;
    const pageLimit = page.limit ?? limit;
    if (!(Number(pageLimit) > 0)) break;
    items.push(...(page.items ?? []));
    offset += pageLimit;
    pages += 1;
    if (offset >= total || !(page.items?.length)) break;
  }
  return { kind: "ok", data: { items, total } };
}

function scopeLineLink(projectId, line) {
  const base = line?.base;
  if (!isValidRequirementId(base)) return el("code", { text: line?.base ?? "—" });
  const href = appRequirementHref(projectId, base);
  return el("a", { href, text: base });
}

function contractTitleLink(projectId, row) {
  const title = row.title || row.id;
  const href = contractDetailHref(projectId, row.id);
  if (href && isValidContractId(row.id)) return el("a", { href, text: title });
  return el("span", { text: title });
}

export async function renderContractsList(container, { apiFn, projectId, offset = 0, limit = 20 }) {
  if (!isValidSlugId(projectId)) return renderNotFound(container);
  const listPath = contractsApiPath(projectId, limit, offset);
  if (!listPath) return renderNotFound(container);
  const result = await loadJson(apiFn, listPath);
  if (result.kind === "auth") return;
  if (result.kind === "error") return renderLoadError(container);
  if (result.kind !== "ok") return renderNotFound(container);
  const page = result.data;
  const items = page.items ?? [];
  const total = page.total ?? items.length;
  container.replaceChildren(el("h1", { text: "Contracts" }));
  if (!items.length) {
    container.append(el("p", { className: "empty-state", text: "No contracts visible for this project." }));
    return;
  }
  const rows = items.map((c) => [
    el("td", {}, [contractTitleLink(projectId, c)]),
    el("td", { text: String(c.scope_count ?? 0) }),
    el("td", { text: String(c.release_count ?? 0) }),
    el("td", {}, [el("code", { text: c.id })]),
  ]);
  const table = el("table", { className: "data-table" });
  const thead = el("thead");
  const hr = el("tr");
  for (const h of ["Contract", "Scope lines", "Releases", "ID"]) hr.append(el("th", { text: h }));
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
  if (total > limit) {
    const end = Math.min(offset + items.length, total);
    const text = offset ? `Showing ${offset + 1}–${end} of ${total}` : `Showing ${end} of ${total}`;
    container.append(el("p", { className: "contracts-list-summary muted", text }));
  }
}

export async function renderContractDetail(container, { apiFn, projectId, contractId }) {
  if (!isValidSlugId(projectId) || !isValidContractId(contractId)) return renderNotFound(container);
  const detailPath = contractApiPath(projectId, contractId);
  if (!detailPath) return renderNotFound(container);
  const detailRes = await loadJson(apiFn, detailPath);
  if (detailRes.kind === "auth") return;
  if (detailRes.kind === "error") return renderLoadError(container, contractId);
  if (detailRes.kind !== "ok") return renderNotFound(container);
  const contract = detailRes.data;

  const scopeRes = await fetchAllScope(apiFn, projectId, contractId);
  if (scopeRes.kind === "auth") return;
  if (scopeRes.kind === "error") return renderLoadError(container, contract.title || contract.id || contractId);
  if (scopeRes.kind !== "ok") return renderNotFound(container);

  const relPath = contractReleasesApiPath(projectId, contractId);
  if (!relPath) return renderNotFound(container);
  const relRes = await loadJson(apiFn, relPath);
  if (relRes.kind === "auth") return;
  if (relRes.kind === "error") return renderLoadError(container, contract.title || contract.id || contractId);
  if (relRes.kind !== "ok") return renderNotFound(container);

  const listHref = contractsListHref(projectId);
  const crumbs = el("nav", { className: "breadcrumb" });
  const projectHref = appProjectHref(projectId);
  if (projectHref) crumbs.append(el("a", { href: projectHref, text: "Project" }));
  else crumbs.append(el("span", { text: "Project" }));
  crumbs.append(el("span", { text: " / " }));
  if (listHref) crumbs.append(el("a", { href: listHref, text: "Contracts" }));
  else crumbs.append(el("span", { text: "Contracts" }));
  crumbs.append(el("span", { text: ` / ${contract.id}` }));

  container.replaceChildren(
    crumbs,
    el("h1", { text: contract.title || contract.id }),
    el("p", { className: "muted" }, [
      el("code", { text: contract.id }),
      document.createTextNode(
        ` · ${contract.status ?? "—"} · ${formatDate(contract.starts_on)} – ${formatDate(contract.ends_on)}`,
      ),
    ]),
  );
  if (contract.notes) {
    container.append(el("h2", { text: "Notes" }), el("div", { className: "statement-body", text: contract.notes }));
  }

  container.append(el("h2", { text: "Scope" }));
  const scopeLines = scopeRes.data.items ?? [];
  if (!scopeLines.length) {
    container.append(el("p", { className: "empty-state", text: "No scope lines visible for this contract." }));
  } else {
    const scopeRows = scopeLines.map((line) => [
      el("td", {}, [scopeLineLink(projectId, line)]),
      el("td", {}, [el("code", { text: line.uid ?? "—" })]),
      el("td", { text: line.kind ?? "—" }),
      el("td", { text: line.status ?? "—" }),
      el("td", { text: String(line.version ?? "—") }),
    ]);
    const scopeTable = el("table", { className: "data-table" });
    const stHead = el("thead");
    const stHr = el("tr");
    for (const h of ["Line", "Version UID", "Kind", "Status", "Ver."]) stHr.append(el("th", { text: h }));
    stHead.append(stHr);
    scopeTable.append(stHead);
    const stBody = el("tbody");
    for (const cells of scopeRows) {
      const tr = el("tr");
      for (const cell of cells) tr.append(cell);
      stBody.append(tr);
    }
    scopeTable.append(stBody);
    container.append(scopeTable);
  }

  container.append(el("h2", { text: "Covered releases" }));
  const releases = relRes.data.items ?? [];
  if (!releases.length) {
    container.append(el("p", { className: "empty-state", text: "No releases covered by this contract." }));
    return;
  }
  const relRows = releases.map((r) => {
    const relHref = appReleaseHref(projectId, r.id);
    const nameCell =
      relHref && isValidSlugId(r.id)
        ? el("td", {}, [el("a", { href: relHref, text: r.name || r.id })])
        : el("td", { text: r.name || r.id });
    return [
      nameCell,
      el("td", {}, [el("code", { text: r.id })]),
      el("td", { text: r.status ?? "—" }),
      el("td", { text: formatDate(r.planned_on) }),
      el("td", { text: formatDate(r.shipped_on) }),
    ];
  });
  const relTable = el("table", { className: "data-table" });
  const relHead = el("thead");
  const relHr = el("tr");
  for (const h of ["Release", "ID", "Status", "Planned", "Shipped"]) relHr.append(el("th", { text: h }));
  relHead.append(relHr);
  relTable.append(relHead);
  const relBody = el("tbody");
  for (const cells of relRows) {
    const tr = el("tr");
    for (const cell of cells) tr.append(cell);
    relBody.append(tr);
  }
  relTable.append(relBody);
  container.append(relTable);
}
