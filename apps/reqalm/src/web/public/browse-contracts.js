/** Contract browse screens (read-only) — mockup 02 table layout. */

import { el } from "./browse-dom.js";
import {
  appRequirementHref,
  isValidRequirementId,
  isValidSlugId,
  loadJson,
} from "./browse-core.js";

export const CONTRACT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Scope lines shown on contract detail before "+N more" (mockup sample; table uses a page). */
export const CONTRACT_SCOPE_DETAIL_PREVIEW = 25;

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

function formatMonth(iso) {
  const d = formatDate(iso);
  if (d === "—") return d;
  return d.slice(0, 7);
}

export function formatContractPeriod(startsOn, endsOn) {
  const start = formatMonth(startsOn);
  const end = formatMonth(endsOn);
  if (start === "—" && end === "—") return "—";
  if (start !== "—" && end !== "—") return `${start} — ${end}`;
  return start !== "—" ? `${start} —` : `— ${end}`;
}

export function contractStatusClass(status) {
  const s = String(status ?? "").toLowerCase();
  if (s === "active") return "contract-status contract-status-active";
  if (s === "closed") return "contract-status contract-status-closed";
  return "contract-status contract-status-other";
}

export function scopeMoreCount(shown, total) {
  const extra = (total ?? 0) - (shown ?? 0);
  return extra > 0 ? extra : 0;
}

export function scopeMoreLabel(shown, total) {
  const n = scopeMoreCount(shown, total);
  return n > 0 ? `+${n} more` : null;
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

export async function fetchAllScope(apiFn, projectId, contractId, limit = 100) {
  const items = [];
  let offset = 0;
  let total = 0;
  for (;;) {
    const path = contractScopeApiPath(projectId, contractId, limit, offset);
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

export function scopeLineLink(anchorProjectId, line) {
  const base = line?.base;
  const peerProject = line?.project_id;
  if (!isValidRequirementId(base)) return el("code", { text: base ?? "—" });
  if (!peerProject || !isValidSlugId(peerProject)) {
    return el("code", { className: "contract-scope-plain", text: base });
  }
  const href = appRequirementHref(peerProject, base);
  if (!href) return el("code", { className: "contract-scope-plain", text: base });
  const link = el("a", { href, text: base });
  if (peerProject !== anchorProjectId) {
    link.setAttribute("title", `${base} (${peerProject})`);
  }
  return link;
}

export function releaseNameLink(anchorProjectId, release) {
  const name = release.name || release.id;
  const relProject = release.project_id ?? anchorProjectId;
  const relHref = appReleaseHref(relProject, release.id);
  if (relHref && isValidSlugId(release.id) && isValidSlugId(relProject)) {
    const a = el("a", { href: relHref, text: name });
    if (relProject !== anchorProjectId) a.setAttribute("title", `${name} (${relProject})`);
    return a;
  }
  return el("span", { text: name });
}

function contractTitleLink(projectId, row) {
  const title = row.title || row.id;
  const href = contractDetailHref(projectId, row.id);
  if (href && isValidContractId(row.id)) {
    return el("a", { className: "contract-list-title", href, text: title });
  }
  return el("span", { className: "contract-list-title", text: title });
}

function contractsDataTable(headers, rows, tableClass = "data-table contracts-table") {
  const table = el("table", { className: tableClass });
  const thead = el("thead");
  const hr = el("tr");
  for (const h of headers) hr.append(el("th", { scope: "col", text: h }));
  thead.append(hr);
  table.append(thead);
  const tbody = el("tbody");
  for (const cells of rows) {
    const tr = el("tr");
    for (const cell of cells) tr.append(cell);
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

function contractListRow(projectId, c) {
  const status = c.status ?? "—";
  return [
    el("td", { className: "contract-list-name" }, [contractTitleLink(projectId, c)]),
    el("td", {}, [el("span", { className: contractStatusClass(status), text: status })]),
    el("td", { className: "contract-list-period", text: formatContractPeriod(c.starts_on, c.ends_on) }),
    el("td", { className: "contract-list-count num", text: String(c.scope_count ?? 0) }),
    el("td", { className: "contract-list-count num", text: String(c.release_count ?? 0) }),
    el("td", {}, [el("code", { className: "contract-list-id", text: c.id })]),
  ];
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

  const header = el("header", { className: "contracts-page-head" });
  header.append(el("h1", { text: "Contracts" }));
  header.append(el("p", { className: "muted contracts-page-lede", text: "Grant-scoped contract overlays for this project." }));

  container.replaceChildren(header);
  if (!items.length) {
    container.append(el("p", { className: "empty-state", text: "No contracts visible for this project." }));
    return;
  }

  const wrap = el("div", { className: "contracts-list-panel" });
  wrap.append(
    contractsDataTable(
      ["Contract", "Status", "Period", "Scope lines", "Releases", "ID"],
      items.map((c) => contractListRow(projectId, c)),
      "data-table contracts-table contracts-list-table",
    ),
  );
  container.append(wrap);

  if (total > limit) {
    const end = Math.min(offset + items.length, total);
    const text = offset ? `Showing ${offset + 1}–${end} of ${total}` : `Showing ${end} of ${total}`;
    container.append(el("p", { className: "contracts-list-summary muted", text }));
  }
}

function contractDetailMeta(contract) {
  const dl = el("dl", { className: "detail-meta contracts-detail-meta" });
  const add = (label, value) => {
    dl.append(el("dt", { text: label }), el("dd", { text: value }));
  };
  add("Contract ID", contract.id);
  add("Status", contract.status ?? "—");
  add("Period", formatContractPeriod(contract.starts_on, contract.ends_on));
  add("Scope lines", String(contract.scope_count ?? 0));
  add("Covered releases", String(contract.release_count ?? 0));
  if (contract.client_id) add("Client", contract.client_id);
  if (contract.project_id) add("Project", contract.project_id);
  return dl;
}

function scopePreviewSection(anchorProjectId, scopeLines, scopeTotal) {
  const section = el("section", { className: "contracts-scope-section stub-section" });
  section.append(el("h2", { text: "Scope" }));
  if (!scopeLines.length && !scopeTotal) {
    section.append(el("p", { className: "empty-state", text: "No scope lines visible for this contract." }));
    return section;
  }
  const rows = scopeLines.map((line) => [
    el("td", {}, [scopeLineLink(anchorProjectId, line)]),
    el("td", {}, [el("code", { text: line.uid ?? "—" })]),
    el("td", { text: line.kind ?? "—" }),
    el("td", { text: line.status ?? "—" }),
    el("td", { className: "num", text: String(line.version ?? "—") }),
    el("td", { className: "contract-scope-project", text: line.project_id ?? "—" }),
  ]);
  section.append(
    contractsDataTable(
      ["Line", "Version UID", "Kind", "Status", "Ver.", "Project"],
      rows,
      "data-table contracts-table contracts-scope-table",
    ),
  );
  const more = scopeMoreLabel(scopeLines.length, scopeTotal);
  if (more) {
    section.append(el("p", { className: "contract-scope-more muted", text: more }));
  }
  return section;
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

  const scopePath = contractScopeApiPath(projectId, contractId, CONTRACT_SCOPE_DETAIL_PREVIEW, 0);
  if (!scopePath) return renderNotFound(container);
  const scopeRes = await loadJson(apiFn, scopePath);
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

  const head = el("header", { className: "contracts-detail-head" });
  head.append(
    el("h1", { text: contract.title || contract.id }),
    el("p", { className: "contracts-detail-sub muted" }, [
      el("span", { className: contractStatusClass(contract.status), text: contract.status ?? "—" }),
      document.createTextNode(` · ${formatContractPeriod(contract.starts_on, contract.ends_on)}`),
    ]),
  );

  const layout = el("div", { className: "contracts-detail-layout" });
  layout.append(head, contractDetailMeta(contract));

  const overlapStub = el("section", { className: "contract-overlap-stub stub-section" });
  overlapStub.append(
    el("h2", { text: "Overlap timeline" }),
    el("p", {
      className: "muted",
      text: "Timeline view is planned (mockup 02); not available in read-only browse yet.",
    }),
  );
  layout.append(overlapStub);

  if (contract.notes) {
    layout.append(
      el("section", { className: "contracts-notes-section stub-section" }, [
        el("h2", { text: "Notes" }),
        el("div", { className: "statement-body", text: contract.notes }),
      ]),
    );
  }

  const scopePage = scopeRes.data;
  const scopeLines = scopePage.items ?? [];
  const scopeTotal = scopePage.total ?? scopeLines.length;
  layout.append(scopePreviewSection(projectId, scopeLines, scopeTotal));

  const relSection = el("section", { className: "contracts-releases-section stub-section" });
  relSection.append(el("h2", { text: "Covered releases" }));
  const releases = relRes.data.items ?? [];
  if (!releases.length) {
    relSection.append(el("p", { className: "empty-state", text: "No releases covered by this contract." }));
  } else {
    const relRows = releases.map((r) => [
      el("td", {}, [releaseNameLink(projectId, r)]),
      el("td", {}, [el("code", { text: r.id })]),
      el("td", { text: r.status ?? "—" }),
      el("td", { text: formatDate(r.planned_on) }),
      el("td", { text: formatDate(r.shipped_on) }),
      el("td", { className: "contract-scope-project", text: r.project_id ?? "—" }),
    ]);
    relSection.append(
      contractsDataTable(
        ["Release", "ID", "Status", "Planned", "Shipped", "Project"],
        relRows,
        "data-table contracts-table contracts-releases-table",
      ),
    );
  }
  layout.append(relSection);

  container.replaceChildren(crumbs, layout);
}
