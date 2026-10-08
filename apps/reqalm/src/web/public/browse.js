/** Client-side browse screens (read-only). */

export const APP_NAV = [
  { href: "/app/clients", label: "Clients" },
  { href: "/app/projects", label: "Projects" },
];
export const SLUG_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SLUG_MAX_LENGTH = 64;
export const REQUIREMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidSlugId(id) {
  return typeof id === "string" && SLUG_ID.test(id);
}
export function isValidRequirementId(id) {
  return typeof id === "string" && REQUIREMENT_ID.test(id);
}
export function decodeRouteSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
export function appClientHref(clientId) {
  return `/app/clients/${encodeURIComponent(clientId)}`;
}
export function appProjectHref(projectId) {
  return `/app/projects/${encodeURIComponent(projectId)}`;
}
export function appRequirementHref(projectId, requirementId) {
  return `/app/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}`;
}
export function appRequirementVersionsHref(projectId, requirementId, offset = 0) {
  const base = `${appRequirementHref(projectId, requirementId)}/versions`;
  return offset > 0 ? `${base}?offset=${offset}` : base;
}
export function appReleaseHref(projectId, releaseId) {
  return `/app/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(releaseId)}`;
}
export function readReleaseFilters(search) {
  const raw = new URLSearchParams(search).get("status") || "";
  const status = raw === "planned" || raw === "shipped" ? raw : "";
  return { status };
}
export function releasesListHref(projectId, { status = "", offset = 0 } = {}) {
  const base = `/app/projects/${encodeURIComponent(projectId)}/releases`;
  const p = new URLSearchParams();
  if (status) p.set("status", status);
  if (offset > 0) p.set("offset", String(offset));
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}
function releasesApiPath(projectId, status, offset, limit) {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) p.set("status", status);
  return `/api/v1/projects/${encodeURIComponent(projectId)}/releases?${p}`;
}
export function readRequirementsFilters(search) {
  const p = new URLSearchParams(search);
  return { kind: p.get("kind") || "", type: p.get("type") || "", status: p.get("status") || "", q: p.get("q") || "" };
}
export function requirementsListHref(projectId, { kind = "", type = "", status = "", q = "", offset = 0 } = {}) {
  const base = `/app/projects/${encodeURIComponent(projectId)}/requirements`;
  const p = new URLSearchParams();
  if (kind) p.set("kind", kind);
  if (type) p.set("type", type);
  if (status) p.set("status", status);
  if (q) p.set("q", q);
  if (offset > 0) p.set("offset", String(offset));
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}
function requirementsApiPath(projectId, filters, offset, limit) {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filters.kind) p.set("kind", filters.kind);
  if (filters.type) p.set("type", filters.type);
  if (filters.status) p.set("status", filters.status);
  if (filters.q) p.set("q", filters.q);
  return `/api/v1/projects/${encodeURIComponent(projectId)}/requirements?${p}`;
}

export function parseAppRoute(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/app" || path === "/app/clients") return { view: "clients-list", offset: 0 };
  const clientMatch = path.match(/^\/app\/clients\/([^/]+)$/);
  if (clientMatch) {
    const clientId = decodeRouteSegment(clientMatch[1]);
    return clientId === null ? { view: "unknown" } : { view: "client-detail", clientId, offset: 0 };
  }
  if (path === "/app/projects") return { view: "projects-list", offset: 0 };
  const reqVer = path.match(/^\/app\/projects\/([^/]+)\/requirements\/([^/]+)\/versions$/);
  if (reqVer) {
    const projectId = decodeRouteSegment(reqVer[1]);
    const requirementId = decodeRouteSegment(reqVer[2]);
    return projectId === null || requirementId === null
      ? { view: "unknown" }
      : { view: "requirement-versions", projectId, requirementId };
  }
  const reqDetail = path.match(/^\/app\/projects\/([^/]+)\/requirements\/([^/]+)$/);
  if (reqDetail) {
    const projectId = decodeRouteSegment(reqDetail[1]);
    const requirementId = decodeRouteSegment(reqDetail[2]);
    return projectId === null || requirementId === null
      ? { view: "unknown" }
      : { view: "requirement-detail", projectId, requirementId };
  }
  const reqList = path.match(/^\/app\/projects\/([^/]+)\/requirements$/);
  if (reqList) {
    const projectId = decodeRouteSegment(reqList[1]);
    return projectId === null ? { view: "unknown" } : { view: "requirements-list", projectId };
  }
  const relDetail = path.match(/^\/app\/projects\/([^/]+)\/releases\/([^/]+)$/);
  if (relDetail) {
    const projectId = decodeRouteSegment(relDetail[1]);
    const releaseId = decodeRouteSegment(relDetail[2]);
    return projectId === null || releaseId === null
      ? { view: "unknown" }
      : { view: "release-detail", projectId, releaseId };
  }
  const relList = path.match(/^\/app\/projects\/([^/]+)\/releases$/);
  if (relList) {
    const projectId = decodeRouteSegment(relList[1]);
    return projectId === null ? { view: "unknown" } : { view: "releases-list", projectId };
  }
  const projectMatch = path.match(/^\/app\/projects\/([^/]+)$/);
  if (projectMatch) {
    const projectId = decodeRouteSegment(projectMatch[1]);
    return projectId === null ? { view: "unknown" } : { view: "project-detail", projectId };
  }
  return path.startsWith("/app") ? { view: "unknown" } : { view: "home" };
}

export function navItemsForRoute(route, currentPath) {
  const items = APP_NAV.map((item) => ({
    ...item,
    match:
      item.href === "/app/clients"
        ? (p) => p === "/app/clients" || p.startsWith("/app/clients/")
        : (p) =>
            p === "/app/projects" ||
            (p.startsWith("/app/projects/") && !p.includes("/requirements") && !p.includes("/releases")),
  }));
  if (route.projectId && isValidSlugId(route.projectId)) {
    const enc = encodeURIComponent(route.projectId);
    const reqBase = `/app/projects/${enc}/requirements`;
    const relBase = `/app/projects/${enc}/releases`;
    items.push({ href: reqBase, label: "Requirements", match: (p) => p.startsWith(reqBase) });
    items.push({ href: relBase, label: "Releases", match: (p) => p.startsWith(relBase) });
  }
  return items.map((item) => ({ ...item, active: item.match(currentPath) }));
}

export function readPageOffset(search) {
  const raw = new URLSearchParams(search).get("offset");
  if (raw == null || raw === "") return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
export function pageHref(basePath, offset) {
  return offset <= 0 ? basePath : `${basePath}?offset=${offset}`;
}
export function pagingOffsets(offset, limit, total) {
  const prevOff = Math.max(0, offset - limit);
  const nextOff = offset + limit;
  return { prevOff, nextOff, showPrev: offset > 0, showNext: nextOff < total };
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "className") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}
function excerpt(text, max = 72) {
  if (!text) return "—";
  const t = String(text).trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
export function renderNotFound(container) {
  container.replaceChildren(
    el("h1", { text: "Not found" }),
    el("p", { className: "muted", text: "Not found or you don't have access." }),
    el("p", {}, [el("a", { href: "/app/clients", text: "Back to clients" })]),
  );
}
function renderNoMoreResults(container, basePath) {
  container.append(
    el("p", { className: "empty-state", text: "No more results." }),
    el("p", {}, [el("a", { href: pageHref(basePath, 0), text: "Back to first page" })]),
  );
}
function pagingBar({ basePath, offset, limit, total, pageLink }) {
  if (total === 0) return null;
  const start = Math.min(offset + 1, total);
  const end = Math.min(offset + limit, total);
  const { prevOff, nextOff, showPrev, showNext } = pagingOffsets(offset, limit, total);
  const hrefAt = pageLink ?? ((off) => pageHref(basePath, off));
  const wrap = el("div", { className: "pager" });
  wrap.append(el("span", { className: "pager-meta", text: `Showing ${start}–${end} of ${total}` }));
  const nav = el("div", { className: "pager-nav" });
  if (showPrev) nav.append(el("a", { href: hrefAt(prevOff), className: "btn-secondary", text: "Previous" }));
  if (showNext) nav.append(el("a", { href: hrefAt(nextOff), className: "btn-secondary", text: "Next" }));
  if (nav.childNodes.length) wrap.append(nav);
  return wrap;
}
function dataTable(headers, rows) {
  const table = el("table", { className: "data-table" });
  const thead = el("thead");
  const hr = el("tr");
  for (const h of headers) hr.append(el("th", { text: h }));
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
export async function loadJson(apiFn, path) {
  const res = await apiFn(path);
  if (!res) return { kind: "auth" };
  if (res.status === 404) return { kind: "not_found" };
  if (!res.ok) return { kind: "error", status: res.status };
  const body = await res.json();
  return { kind: "ok", data: body.data ?? body };
}
function isPastEnd(page, offset) {
  return (page.total ?? 0) > 0 && (page.offset ?? offset) >= (page.total ?? 0);
}
function filtersActive(f) {
  return !!(f.kind || f.type || f.status || f.q);
}
function filterForm(filters, listPath) {
  const form = el("form", { className: "filter-bar", method: "get", action: listPath });
  for (const [name, label] of [
    ["kind", "Kind"],
    ["type", "Type"],
    ["status", "Status"],
  ]) {
    form.append(
      el("label", {}, [
        document.createTextNode(`${label} `),
        el("input", { name, value: filters[name], size: "12", maxlength: "64" }),
      ]),
    );
  }
  form.append(
    el("label", {}, [
      document.createTextNode("Search "),
      el("input", { name: "q", value: filters.q, size: "24", maxlength: "200" }),
    ]),
  );
  form.append(el("button", { type: "submit", text: "Apply" }));
  return form;
}
async function renderSimpleList(container, { title, apiPath, basePath, emptyText, headers, mapRow, apiFn, offset, limit, pageLink }) {
  const result = await loadJson(apiFn, apiPath);
  if (result.kind === "auth") return;
  if (result.kind !== "ok") return renderNotFound(container);
  const page = result.data;
  container.replaceChildren(el("h1", { text: title }));
  if (!page.items?.length) {
    if (isPastEnd(page, offset)) return renderNoMoreResults(container, basePath);
    container.append(el("p", { className: "empty-state", text: emptyText }));
    return;
  }
  container.append(dataTable(headers, page.items.map(mapRow)));
  const bar = pagingBar({
    basePath,
    offset: page.offset ?? offset,
    limit: page.limit ?? limit,
    total: page.total ?? 0,
    pageLink,
  });
  if (bar) container.append(bar);
}

export async function renderClientsList(container, { apiFn, offset = 0, limit = 20 }) {
  await renderSimpleList(container, {
    title: "Clients",
    apiPath: `/api/v1/clients?limit=${limit}&offset=${offset}`,
    basePath: "/app/clients",
    emptyText: "You have no clients you can see.",
    headers: ["Name", "Slug"],
    mapRow: (c) => [
      el("td", {}, [el("a", { href: appClientHref(c.id), text: c.name })]),
      el("td", {}, [el("code", { text: c.id })]),
    ],
    apiFn,
    offset,
    limit,
  });
}

export async function renderClientDetail(container, { apiFn, clientId, offset = 0, limit = 20 }) {
  if (!isValidSlugId(clientId)) return renderNotFound(container);
  const clientRes = await loadJson(apiFn, `/api/v1/clients/${encodeURIComponent(clientId)}`);
  if (clientRes.kind === "auth") return;
  if (clientRes.kind !== "ok") return renderNotFound(container);
  const client = clientRes.data;
  const clientBase = appClientHref(clientId);
  container.replaceChildren(
    el("nav", { className: "breadcrumb" }, [
      el("a", { href: "/app/clients", text: "Clients" }),
      el("span", { text: " / " }),
      el("span", { text: client.name }),
    ]),
    el("h1", { text: client.name }),
  );
  const meta = el("dl", { className: "detail-meta" });
  meta.append(el("dt", { text: "Slug" }), el("dd", {}, [el("code", { text: client.id })]));
  if (client.created_at) meta.append(el("dt", { text: "Created" }), el("dd", { text: client.created_at }));
  container.append(meta, el("h2", { text: "Projects" }));
  const projRes = await loadJson(apiFn, `/api/v1/clients/${encodeURIComponent(clientId)}/projects?limit=${limit}&offset=${offset}`);
  if (projRes.kind === "auth") return;
  if (projRes.kind !== "ok") return renderNotFound(container);
  const page = projRes.data;
  if (!page.items?.length) {
    if (isPastEnd(page, offset)) return renderNoMoreResults(container, clientBase);
    container.append(el("p", { className: "muted", text: "No projects in this client." }));
    return;
  }
  container.append(
    dataTable(
      ["Name", "Slug", "Status"],
      page.items.map((p) => [
        el("td", {}, [el("a", { href: appProjectHref(p.id), text: p.name })]),
        el("td", {}, [el("code", { text: p.id })]),
        el("td", { text: p.status ?? "—" }),
      ]),
    ),
  );
  const bar = pagingBar({ basePath: clientBase, offset: page.offset ?? offset, limit: page.limit ?? limit, total: page.total ?? 0 });
  if (bar) container.append(bar);
}

async function clientNameMap(apiFn) {
  const res = await loadJson(apiFn, "/api/v1/clients?limit=100&offset=0");
  if (res.kind !== "ok") return new Map();
  const map = new Map();
  for (const c of res.data.items ?? []) map.set(c.id, c.name);
  return map;
}

export async function renderProjectsList(container, { apiFn, offset = 0, limit = 20 }) {
  const [projRes, names] = await Promise.all([
    loadJson(apiFn, `/api/v1/projects?limit=${limit}&offset=${offset}`),
    clientNameMap(apiFn),
  ]);
  if (projRes.kind === "auth") return;
  if (projRes.kind !== "ok") return renderNotFound(container);
  const page = projRes.data;
  container.replaceChildren(el("h1", { text: "Projects" }));
  if (!page.items?.length) {
    if (isPastEnd(page, offset)) return renderNoMoreResults(container, "/app/projects");
    container.append(el("p", { className: "empty-state", text: "You have no projects you can see." }));
    return;
  }
  container.append(
    dataTable(
      ["Project", "Client", "Slug"],
      page.items.map((p) => {
        const clientName = names.get(p.client_id) ?? p.client_id;
        const clientCell = names.has(p.client_id)
          ? el("a", { href: appClientHref(p.client_id), text: clientName })
          : el("span", { text: clientName });
        return [
          el("td", {}, [el("a", { href: appProjectHref(p.id), text: p.name })]),
          el("td", {}, [clientCell]),
          el("td", {}, [el("code", { text: p.id })]),
        ];
      }),
    ),
  );
  const bar = pagingBar({ basePath: "/app/projects", offset: page.offset ?? offset, limit: page.limit ?? limit, total: page.total ?? 0 });
  if (bar) container.append(bar);
}

export async function renderProjectDetail(container, { apiFn, projectId }) {
  if (!isValidSlugId(projectId)) return renderNotFound(container);
  const projRes = await loadJson(apiFn, `/api/v1/projects/${encodeURIComponent(projectId)}`);
  if (projRes.kind === "auth") return;
  if (projRes.kind !== "ok") return renderNotFound(container);
  const project = projRes.data;
  let clientLabel = project.client_id;
  const clientRes = await loadJson(apiFn, `/api/v1/clients/${encodeURIComponent(project.client_id)}`);
  if (clientRes.kind === "ok") clientLabel = clientRes.data.name;
  container.replaceChildren(
    el("h1", { text: project.name }),
    el("p", { className: "muted" }, [
      document.createTextNode("Client: "),
      el("a", { href: appClientHref(project.client_id), text: clientLabel }),
      document.createTextNode(" · slug "),
      el("code", { text: project.id }),
    ]),
    el("section", { className: "stub-section" }, [
      el("h2", { text: "Requirements" }),
      el("p", {}, [el("a", { href: requirementsListHref(projectId), text: "Browse requirements" })]),
    ]),
    el("section", { className: "stub-section" }, [
      el("h2", { text: "Releases" }),
      el("p", {}, [el("a", { href: releasesListHref(projectId), text: "Browse releases" })]),
    ]),
  );
}

function releaseStatusFilterForm(status, listPath) {
  const form = el("form", { className: "filter-bar", method: "get", action: listPath });
  const select = el("select", { name: "status" });
  for (const [val, label] of [
    ["", "Any status"],
    ["planned", "Planned"],
    ["shipped", "Shipped"],
  ]) {
    const opt = el("option", { value: val, text: label });
    if (val === status) opt.selected = true;
    select.append(opt);
  }
  form.append(el("label", {}, [document.createTextNode("Status "), select]));
  form.append(el("button", { type: "submit", text: "Apply" }));
  return form;
}

function formatDate(val) {
  return val ? String(val) : "—";
}

export async function renderReleasesList(container, { apiFn, projectId, filters, offset = 0, limit = 20 }) {
  if (!isValidSlugId(projectId)) return renderNotFound(container);
  const listPath = `/app/projects/${encodeURIComponent(projectId)}/releases`;
  const result = await loadJson(apiFn, releasesApiPath(projectId, filters.status, offset, limit));
  if (result.kind === "auth") return;
  if (result.kind !== "ok") return renderNotFound(container);
  const page = result.data;
  const pageBase = releasesListHref(projectId, filters);
  container.replaceChildren(
    el("nav", { className: "breadcrumb" }, [
      el("a", { href: appProjectHref(projectId), text: "Project" }),
      el("span", { text: " / Releases" }),
    ]),
    el("h1", { text: "Releases" }),
    releaseStatusFilterForm(filters.status, listPath),
  );
  if (!page.items?.length) {
    if (isPastEnd(page, offset)) return renderNoMoreResults(container, pageBase);
    container.append(
      el("p", {
        className: "empty-state",
        text: filters.status ? "No releases match your filter." : "No releases in this project.",
      }),
    );
    return;
  }
  container.append(
    dataTable(
      ["Name", "ID", "Status", "Planned", "Shipped", "Capabilities"],
      page.items.map((r) => [
        el("td", {}, [el("a", { href: appReleaseHref(projectId, r.id), text: r.name })]),
        el("td", {}, [el("code", { text: r.id })]),
        el("td", { text: r.status ?? "—" }),
        el("td", { text: formatDate(r.planned_on) }),
        el("td", { text: formatDate(r.shipped_on) }),
        el("td", { text: String(r.delivered_capability_count ?? 0) }),
      ]),
    ),
  );
  const bar = pagingBar({
    basePath: pageBase,
    offset: page.offset ?? offset,
    limit: page.limit ?? limit,
    total: page.total ?? 0,
    pageLink: (off) => releasesListHref(projectId, { ...filters, offset: off }),
  });
  if (bar) container.append(bar);
}

export async function renderReleaseDetail(container, { apiFn, projectId, releaseId, listFilters }) {
  if (!isValidSlugId(projectId) || !isValidSlugId(releaseId)) return renderNotFound(container);
  const res = await loadJson(
    apiFn,
    `/api/v1/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(releaseId)}`,
  );
  if (res.kind === "auth") return;
  if (res.kind !== "ok") return renderNotFound(container);
  const rel = res.data;
  const listHref = releasesListHref(projectId, listFilters ?? {});
  container.replaceChildren(
    el("nav", { className: "breadcrumb" }, [
      el("a", { href: appProjectHref(projectId), text: "Project" }),
      el("span", { text: " / " }),
      el("a", { href: listHref, text: "Releases" }),
      el("span", { text: ` / ${rel.id}` }),
    ]),
    el("h1", { text: rel.name || rel.id }),
    el("p", { className: "muted" }, [
      el("code", { text: rel.id }),
      document.createTextNode(` · ${rel.status ?? "—"} · planned ${formatDate(rel.planned_on)} · shipped ${formatDate(rel.shipped_on)}`),
    ]),
  );
  if (rel.notes) {
    container.append(el("h2", { text: "Notes" }), el("div", { className: "statement-body", text: rel.notes }));
  }
  const caps = rel.delivered_capabilities ?? [];
  container.append(el("h2", { text: "Delivered capabilities" }));
  if (!caps.length) {
    container.append(el("p", { className: "muted", text: "No capabilities delivered in this release." }));
    return;
  }
  container.append(
    dataTable(
      ["UID", "Title", "Status"],
      caps.map((c) => [
        el("td", {}, [el("a", { href: appRequirementHref(projectId, c.uid), text: c.uid })]),
        el("td", { text: c.title ?? "—" }),
        el("td", { text: c.status ?? "—" }),
      ]),
    ),
  );
}

export async function renderRequirementsList(container, { apiFn, projectId, filters, offset = 0, limit = 20 }) {
  if (!isValidSlugId(projectId)) return renderNotFound(container);
  const listPath = `/app/projects/${encodeURIComponent(projectId)}/requirements`;
  const result = await loadJson(apiFn, requirementsApiPath(projectId, filters, offset, limit));
  if (result.kind === "auth") return;
  if (result.kind !== "ok") return renderNotFound(container);
  const page = result.data;
  const pageBase = requirementsListHref(projectId, filters);
  container.replaceChildren(
    el("nav", { className: "breadcrumb" }, [
      el("a", { href: appProjectHref(projectId), text: "Project" }),
      el("span", { text: " / Requirements" }),
    ]),
    el("h1", { text: "Requirements" }),
    filterForm(filters, listPath),
  );
  if (!page.items?.length) {
    if (isPastEnd(page, offset)) return renderNoMoreResults(container, pageBase);
    container.append(
      el("p", {
        className: "empty-state",
        text: filtersActive(filters) ? "No requirements match your filters." : "No requirements in this project.",
      }),
    );
    return;
  }
  container.append(
    dataTable(
      ["UID", "Title", "Kind", "Type", "Status", "Ver."],
      page.items.map((r) => [
        el("td", {}, [el("a", { href: appRequirementHref(projectId, r.id), text: r.id })]),
        el("td", { text: excerpt(r.title) }),
        el("td", { text: r.kind }),
        el("td", { text: r.type }),
        el("td", { text: r.status }),
        el("td", { text: String(r.version_n) }),
      ]),
    ),
  );
  const bar = pagingBar({
    basePath: pageBase,
    offset: page.offset ?? offset,
    limit: page.limit ?? limit,
    total: page.total ?? 0,
    pageLink: (off) => requirementsListHref(projectId, { ...filters, offset: off }),
  });
  if (bar) container.append(bar);
}

const ATTR_LABELS = { priority: "Priority", iteration: "Iteration", rbac_op: "RBAC op", grooming_state: "Grooming", mint_kind: "Mint kind" };

export async function renderRequirementDetail(container, { apiFn, projectId, requirementId, listFilters }) {
  if (!isValidSlugId(projectId) || !isValidRequirementId(requirementId)) return renderNotFound(container);
  const res = await loadJson(
    apiFn,
    `/api/v1/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}`,
  );
  if (res.kind === "auth") return;
  if (res.kind !== "ok") return renderNotFound(container);
  const req = res.data;
  const listHref = requirementsListHref(projectId, listFilters ?? {});
  container.replaceChildren(
    el("nav", { className: "breadcrumb" }, [
      el("a", { href: appProjectHref(projectId), text: "Project" }),
      el("span", { text: " / " }),
      el("a", { href: listHref, text: "Requirements" }),
      el("span", { text: ` / ${req.id}` }),
    ]),
    el("h1", { text: req.title || req.id }),
    el("p", { className: "muted" }, [
      el("code", { text: req.id }),
      document.createTextNode(` · ${req.kind} · ${req.type} · ${req.status} · v${req.version_n}`),
    ]),
    el("p", {}, [el("a", { href: appRequirementVersionsHref(projectId, requirementId), text: "Version history" })]),
    el("h2", { text: "Statement" }),
    el("div", { className: "statement-body", text: req.statement }),
  );
  const meta = el("dl", { className: "detail-meta" });
  for (const [key, val] of Object.entries(req.attributes ?? {})) {
    if (val == null || val === "") continue;
    meta.append(el("dt", { text: ATTR_LABELS[key] ?? key }), el("dd", { text: String(val) }));
  }
  if (meta.childNodes.length) container.append(el("h2", { text: "Attributes" }), meta);
}

export async function renderRequirementVersions(container, { apiFn, projectId, requirementId, offset = 0, limit = 20 }) {
  if (!isValidSlugId(projectId) || !isValidRequirementId(requirementId)) return renderNotFound(container);
  const res = await loadJson(
    apiFn,
    `/api/v1/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}/versions?limit=${limit}&offset=${offset}`,
  );
  if (res.kind === "auth") return;
  if (res.kind !== "ok") return renderNotFound(container);
  const page = res.data;
  const detailHref = appRequirementHref(projectId, requirementId);
  const pageBase = appRequirementVersionsHref(projectId, requirementId, 0);
  container.replaceChildren(
    el("nav", { className: "breadcrumb" }, [
      el("a", { href: appProjectHref(projectId), text: "Project" }),
      el("span", { text: " / " }),
      el("a", { href: requirementsListHref(projectId), text: "Requirements" }),
      el("span", { text: " / " }),
      el("a", { href: detailHref, text: requirementId }),
      el("span", { text: " / Versions" }),
    ]),
    el("h1", { text: "Version history" }),
  );
  if (!page.items?.length) {
    if (isPastEnd(page, offset)) return renderNoMoreResults(container, pageBase);
    container.append(el("p", { className: "empty-state", text: "No versions recorded." }));
    return;
  }
  container.append(
    dataTable(
      ["Ver.", "Status", "Title", "Statement"],
      page.items.map((v) => [
        el("td", { text: String(v.version_n) }),
        el("td", { text: v.status }),
        el("td", { text: v.title ?? "—" }),
        el("td", { text: excerpt(v.statement, 96) }),
      ]),
    ),
  );
  const bar = pagingBar({
    basePath: pageBase,
    offset: page.offset ?? offset,
    limit: page.limit ?? limit,
    total: page.total ?? 0,
    pageLink: (off) => appRequirementVersionsHref(projectId, requirementId, off),
  });
  if (bar) container.append(bar);
}

export async function mountBrowseView(container, route, deps) {
  const { apiFn, search = "" } = deps;
  const offset = readPageOffset(search);
  const filters = readRequirementsFilters(search);
  const releaseFilters = readReleaseFilters(search);
  switch (route.view) {
    case "clients-list":
      await renderClientsList(container, { apiFn, offset });
      break;
    case "client-detail":
      await renderClientDetail(container, { apiFn, clientId: route.clientId, offset });
      break;
    case "projects-list":
      await renderProjectsList(container, { apiFn, offset });
      break;
    case "project-detail":
      await renderProjectDetail(container, { apiFn, projectId: route.projectId });
      break;
    case "requirements-list":
      await renderRequirementsList(container, { apiFn, projectId: route.projectId, filters, offset });
      break;
    case "requirement-detail":
      await renderRequirementDetail(container, {
        apiFn,
        projectId: route.projectId,
        requirementId: route.requirementId,
        listFilters: filters,
      });
      break;
    case "requirement-versions":
      await renderRequirementVersions(container, { apiFn, projectId: route.projectId, requirementId: route.requirementId, offset });
      break;
    case "releases-list":
      await renderReleasesList(container, { apiFn, projectId: route.projectId, filters: releaseFilters, offset });
      break;
    case "release-detail":
      await renderReleaseDetail(container, {
        apiFn,
        projectId: route.projectId,
        releaseId: route.releaseId,
        listFilters: releaseFilters,
      });
      break;
    case "unknown":
      renderNotFound(container);
      break;
    default:
      container.replaceChildren(
        el("h1", { text: "ReqALM" }),
        el("p", { className: "muted", text: "Choose Clients or Projects from the navigation to browse your grant-scoped data." }),
      );
  }
}
