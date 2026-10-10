/** Contract browse screens (read-only) — mockup 02 two-pane layout. */

import { el } from "./browse-dom.js";
import {
  appRequirementHref,
  isValidRequirementId,
  isValidSlugId,
  loadJson,
} from "./browse-core.js";

export const CONTRACT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Sample requirement chips in the detail panel (mockup 02). */
export const CONTRACT_SCOPE_CHIP_PREVIEW = 3;

/** Scope rows in the expanded document-view membership table. */
export const CONTRACT_SCOPE_DETAIL_PREVIEW = 25;

export const CONTRACT_LIST_FETCH_LIMIT = 100;

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

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseContractMonth(iso) {
  const d = formatDate(iso);
  if (d === "—") return null;
  const [y, m] = d.split("-").map(Number);
  if (!y || !m) return null;
  return y * 12 + (m - 1);
}

export function contractEffectiveEndMonth(startsOn, endsOn) {
  const end = parseContractMonth(endsOn);
  if (end != null) return end;
  const start = parseContractMonth(startsOn);
  if (start == null) return null;
  return start + 12;
}

export function contractPeriodsOverlap(a, b) {
  const aStart = parseContractMonth(a.starts_on);
  const aEnd = contractEffectiveEndMonth(a.starts_on, a.ends_on);
  const bStart = parseContractMonth(b.starts_on);
  const bEnd = contractEffectiveEndMonth(b.starts_on, b.ends_on);
  if (aStart == null || aEnd == null || bStart == null || bEnd == null) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

export function contractScopeTag(contract, allContracts) {
  const others = (allContracts ?? []).filter((c) => c.id !== contract.id);
  const overlapCount = others.filter((o) => contractPeriodsOverlap(contract, o)).length;
  if (overlapCount >= 2) return "shared";
  if (overlapCount === 1) return "overlapping support";
  return "sequential";
}

export function scopeTagClass(tag) {
  if (tag === "shared") return "contract-scope-tag contract-scope-tag-shared";
  if (tag === "overlapping support") return "contract-scope-tag contract-scope-tag-overlap";
  return "contract-scope-tag contract-scope-tag-sequential";
}

export function formatContractPeriod(startsOn, endsOn) {
  const start = formatMonth(startsOn);
  const end = formatMonth(endsOn);
  if (start === "—" && end === "—") return "—";
  if (start !== "—" && end !== "—") return `${start} — ${end}`;
  return start !== "—" ? `${start} —` : `— ${end}`;
}

export function formatMonthTick(monthIndex) {
  const y = Math.floor(monthIndex / 12);
  const m = monthIndex % 12;
  return `${MONTH_SHORT[m]} ${y}`;
}

export function buildOverlapTimeline(contracts, selectedId) {
  const bars = [];
  let minMonth = Number.POSITIVE_INFINITY;
  let maxMonth = Number.NEGATIVE_INFINITY;
  for (const c of contracts ?? []) {
    const start = parseContractMonth(c.starts_on);
    const end = contractEffectiveEndMonth(c.starts_on, c.ends_on);
    if (start == null || end == null) continue;
    minMonth = Math.min(minMonth, start);
    maxMonth = Math.max(maxMonth, end);
    bars.push({
      id: c.id,
      title: c.title || c.id,
      start,
      end,
      selected: c.id === selectedId,
    });
  }
  if (!bars.length) return { ticks: [], bars: [], span: 1 };
  const span = Math.max(1, maxMonth - minMonth);
  const tickCount = 5;
  const ticks = [];
  for (let i = 0; i < tickCount; i++) {
    const at = minMonth + Math.round((span * i) / (tickCount - 1));
    ticks.push(formatMonthTick(at));
  }
  const positioned = bars.map((b) => ({
    ...b,
    leftPct: ((b.start - minMonth) / span) * 100,
    widthPct: Math.max(2, ((b.end - b.start) / span) * 100),
  }));
  return { ticks, bars: positioned, span };
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

export function resolveSelectedContractId(requestedId, items) {
  if (requestedId && isValidContractId(requestedId) && items.some((i) => i.id === requestedId)) return requestedId;
  const first = items[0]?.id;
  return first && isValidContractId(first) ? first : null;
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
  if (peerProject !== anchorProjectId) link.setAttribute("title", `${base} (${peerProject})`);
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

function contractCard(projectId, c, allContracts, selectedId) {
  const href = contractDetailHref(projectId, c.id);
  const selected = c.id === selectedId;
  const cardClass = selected ? "contract-card contract-card-selected" : "contract-card";
  const icon = el("span", { className: "contract-card-icon", "aria-hidden": "true" });
  const main = el("div", { className: "contract-card-main" }, [
    el("span", { className: "contract-card-title", text: c.title || c.id }),
    el("span", { className: "contract-card-client muted", text: c.client_id || "—" }),
  ]);
  const scopeTag = contractScopeTag(c, allContracts);
  const meta = el("div", { className: "contract-card-meta" }, [
    el("span", { className: contractStatusClass(c.status), text: c.status ?? "—" }),
    el("span", { className: "contract-card-period", text: formatContractPeriod(c.starts_on, c.ends_on) }),
    el("span", { className: "contract-card-reqs", text: `${c.scope_count ?? 0} reqs` }),
    el("span", { className: scopeTagClass(scopeTag), text: scopeTag }),
  ]);
  const chevron = el("span", { className: "contract-card-chevron", text: "›", "aria-hidden": "true" });
  if (href && isValidContractId(c.id)) {
    const card = el("a", { className: cardClass, href, "aria-current": selected ? "page" : undefined });
    card.append(icon, main, meta, chevron);
    return card;
  }
  const card = el("div", { className: `${cardClass} contract-card-static`, "aria-disabled": "true" });
  card.append(icon, main, meta, chevron);
  return card;
}

function overlapTimelineSection(contracts, selectedId) {
  const model = buildOverlapTimeline(contracts, selectedId);
  const section = el("section", { className: "contract-overlap-section" });
  section.append(el("h3", { className: "contract-panel-heading", text: "Overlap timeline" }));
  if (!model.bars.length) {
    section.append(el("p", { className: "muted", text: "No contract periods to display." }));
    return section;
  }
  const axis = el("div", { className: "contract-overlap-axis" });
  for (const tick of model.ticks) axis.append(el("span", { text: tick }));
  const tracks = el("div", { className: "contract-overlap-tracks" });
  for (const bar of model.bars) {
    const row = el("div", { className: "contract-overlap-row" });
    row.append(el("span", { className: "contract-overlap-label", text: bar.title }));
    const track = el("div", { className: "contract-overlap-track" });
    const pill = el("span", {
      className: bar.selected ? "contract-overlap-bar contract-overlap-bar-selected" : "contract-overlap-bar",
      style: `margin-left:${bar.leftPct.toFixed(2)}%;width:${bar.widthPct.toFixed(2)}%`,
      title: bar.title,
    });
    track.append(pill);
    row.append(track);
    tracks.append(row);
  }
  section.append(axis, tracks);
  return section;
}

function sampleRequirementsSection(anchorProjectId, scopeLines, scopeTotal) {
  const section = el("section", { className: "contract-sample-reqs" });
  section.append(el("h3", { className: "contract-panel-heading", text: "Sample linked requirements" }));
  const chips = el("div", { className: "contract-req-chips" });
  for (const line of scopeLines) {
    chips.append(el("span", { className: "contract-req-chip" }, [scopeLineLink(anchorProjectId, line)]));
  }
  section.append(chips);
  const more = scopeMoreLabel(scopeLines.length, scopeTotal);
  if (more) section.append(el("p", { className: "contract-scope-more muted", text: more }));
  return section;
}

function documentViewSection(anchorProjectId, scopeLines, scopeTotal, releases, expanded) {
  const section = el("section", {
    className: "contract-document-view",
    id: "contract-document-view",
    hidden: expanded ? undefined : true,
  });
  section.append(el("h3", { className: "contract-panel-heading", text: "Document membership" }));
  if (!scopeLines.length && !scopeTotal) {
    section.append(el("p", { className: "empty-state", text: "No scope lines visible for this contract." }));
  } else {
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
    if (more) section.append(el("p", { className: "contract-scope-more muted", text: more }));
  }
  section.append(el("h3", { className: "contract-panel-heading", text: "Covered releases" }));
  if (!releases.length) {
    section.append(el("p", { className: "empty-state", text: "No releases covered by this contract." }));
  } else {
    const relRows = releases.map((r) => [
      el("td", {}, [releaseNameLink(anchorProjectId, r)]),
      el("td", {}, [el("code", { text: r.id })]),
      el("td", { text: r.status ?? "—" }),
      el("td", { text: formatDate(r.planned_on) }),
      el("td", { text: formatDate(r.shipped_on) }),
      el("td", { className: "contract-scope-project", text: r.project_id ?? "—" }),
    ]);
    section.append(
      contractsDataTable(
        ["Release", "ID", "Status", "Planned", "Shipped", "Project"],
        relRows,
        "data-table contracts-table contracts-releases-table",
      ),
    );
  }
  return section;
}

function detailPanel(projectId, listItems, selectedId, detail, chipScope, docScope, releases) {
  const panel = el("aside", { className: "contracts-detail-panel" });
  if (!selectedId || !detail) {
    panel.append(el("p", { className: "muted contract-panel-empty", text: "Select a contract to view details." }));
    return panel;
  }
  panel.append(
    el("header", { className: "contract-panel-head" }, [
      el("h2", { className: "contract-panel-title", text: detail.title || detail.id }),
      el("span", { className: "contract-panel-star", text: "☆", "aria-hidden": "true" }),
    ]),
  );
  const kv = el("dl", { className: "contract-panel-kv" });
  const add = (label, value) => {
    kv.append(el("dt", { text: label }), el("dd", { text: value }));
  };
  add("Client", detail.client_id ?? listItems.find((i) => i.id === selectedId)?.client_id ?? "—");
  add("Project", detail.project_id ?? projectId);
  add("Date range", formatContractPeriod(detail.starts_on, detail.ends_on));
  add("Linked requirements", `${detail.scope_count ?? 0} requirements`);
  panel.append(kv);
  panel.append(overlapTimelineSection(listItems, selectedId));
  const chipLines = chipScope?.items ?? [];
  const chipTotal = chipScope?.total ?? 0;
  panel.append(sampleRequirementsSection(projectId, chipLines, chipTotal));

  const docSection = documentViewSection(
    projectId,
    docScope?.items ?? [],
    docScope?.total ?? 0,
    releases ?? [],
    false,
  );
  const openBtn = el("button", {
    type: "button",
    className: "contract-doc-view-btn",
    "aria-expanded": "false",
    "aria-controls": "contract-document-view",
  }, [el("span", { className: "contract-doc-view-icon", "aria-hidden": "true" }), document.createTextNode("Open document view")]);
  openBtn.addEventListener("click", () => {
    const open = docSection.hasAttribute("hidden");
    if (open) docSection.removeAttribute("hidden");
    else docSection.setAttribute("hidden", "");
    openBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  panel.append(openBtn, docSection);
  if (detail.notes) {
    panel.append(el("section", { className: "contract-notes-compact" }, [
      el("h3", { className: "contract-panel-heading", text: "Notes" }),
      el("p", { className: "contract-notes-text", text: detail.notes }),
    ]));
  }
  return panel;
}

export async function renderContractsBrowse(container, { apiFn, projectId, contractId = null }) {
  if (!isValidSlugId(projectId)) return renderNotFound(container);
  if (contractId && !isValidContractId(contractId)) return renderNotFound(container);
  const listPath = contractsApiPath(projectId, CONTRACT_LIST_FETCH_LIMIT, 0);
  if (!listPath) return renderNotFound(container);
  const listRes = await loadJson(apiFn, listPath);
  if (listRes.kind === "auth") return;
  if (listRes.kind === "error") return renderLoadError(container);
  if (listRes.kind !== "ok") return renderNotFound(container);
  const listItems = listRes.data.items ?? [];
  if (!listItems.length) {
    container.replaceChildren(
      el("header", { className: "contracts-page-head" }, [
        el("h1", { text: "Contracts" }),
        el("button", { type: "button", className: "contract-new-btn", disabled: true, title: "Coming soon", text: "+ New contract" }),
      ]),
      el("p", { className: "empty-state", text: "No contracts visible for this project." }),
    );
    return;
  }

  const selectedId = resolveSelectedContractId(contractId, listItems);
  if (contractId && isValidContractId(contractId) && selectedId === null) return renderNotFound(container);
  let detail = null;
  let chipScope = null;
  let docScope = null;
  let releases = [];

  if (selectedId) {
    const detailPath = contractApiPath(projectId, selectedId);
    const chipPath = contractScopeApiPath(projectId, selectedId, CONTRACT_SCOPE_CHIP_PREVIEW, 0);
    const docPath = contractScopeApiPath(projectId, selectedId, CONTRACT_SCOPE_DETAIL_PREVIEW, 0);
    const relPath = contractReleasesApiPath(projectId, selectedId);
    if (!detailPath || !chipPath || !docPath || !relPath) return renderNotFound(container);

    const detailRes = await loadJson(apiFn, detailPath);
    if (detailRes.kind === "auth") return;
    if (detailRes.kind === "error") return renderLoadError(container);
    if (detailRes.kind !== "ok") return renderNotFound(container);
    detail = detailRes.data;

    const chipRes = await loadJson(apiFn, chipPath);
    if (chipRes.kind === "auth") return;
    if (chipRes.kind === "error") return renderLoadError(container, detail.title || detail.id);
    if (chipRes.kind !== "ok") return renderNotFound(container);
    chipScope = chipRes.data;

    const docRes = await loadJson(apiFn, docPath);
    if (docRes.kind === "auth") return;
    if (docRes.kind === "error") return renderLoadError(container, detail.title || detail.id);
    if (docRes.kind !== "ok") return renderNotFound(container);
    docScope = docRes.data;

    const relRes = await loadJson(apiFn, relPath);
    if (relRes.kind === "auth") return;
    if (relRes.kind === "error") return renderLoadError(container, detail.title || detail.id);
    if (relRes.kind !== "ok") return renderNotFound(container);
    releases = relRes.data.items ?? [];
  }

  const head = el("header", { className: "contracts-page-head contracts-page-head-split" }, [
    el("h1", { text: "Contracts" }),
    el("button", { type: "button", className: "contract-new-btn", disabled: true, title: "Coming soon", text: "+ New contract" }),
  ]);

  const listPane = el("div", { className: "contracts-list-pane" });
  const cardList = el("div", { className: "contract-card-list", role: "list" });
  for (const c of listItems) {
    const item = contractCard(projectId, c, listItems, selectedId);
    item.setAttribute("role", "listitem");
    cardList.append(item);
  }
  listPane.append(cardList);

  const layout = el("div", { className: "contracts-two-pane" }, [
    listPane,
    detailPanel(projectId, listItems, selectedId, detail, chipScope, docScope, releases),
  ]);

  container.replaceChildren(head, layout);
}

export async function renderContractsList(container, opts) {
  return renderContractsBrowse(container, { ...opts, contractId: null });
}

export async function renderContractDetail(container, { contractId, ...opts }) {
  return renderContractsBrowse(container, { ...opts, contractId });
}
