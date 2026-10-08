/** Client-side browse screens for clients & projects (read-only). */

export const APP_NAV = [
  { href: "/app/clients", label: "Clients" },
  { href: "/app/projects", label: "Projects" },
  { href: "/app/requirements", label: "Requirements" },
  { href: "/app/releases", label: "Releases" },
];

/** Slug id — must match apps/reqalm/src/http/project-id.ts SLUG_ID */
export const SLUG_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidSlugId(id) {
  return typeof id === "string" && SLUG_ID.test(id);
}

export function parseAppRoute(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/app" || path === "/app/clients") {
    return { view: "clients-list", offset: 0 };
  }
  const clientMatch = path.match(/^\/app\/clients\/([^/]+)$/);
  if (clientMatch) {
    return { view: "client-detail", clientId: clientMatch[1], offset: 0 };
  }
  if (path === "/app/projects") {
    return { view: "projects-list", offset: 0 };
  }
  const projectMatch = path.match(/^\/app\/projects\/([^/]+)$/);
  if (projectMatch) {
    return { view: "project-detail", projectId: projectMatch[1] };
  }
  if (path.startsWith("/app")) {
    return { view: "unknown" };
  }
  return { view: "home" };
}

export function readPageOffset(search) {
  const params = new URLSearchParams(search);
  const raw = params.get("offset");
  if (raw == null || raw === "") return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function pageHref(basePath, offset, limit) {
  if (offset <= 0) return basePath;
  return `${basePath}?offset=${offset}`;
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "className") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v != null) node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

export function renderNotFound(container) {
  container.replaceChildren(
    el("h1", { text: "Not found" }),
    el("p", {
      className: "muted",
      text: "Not found or you don't have access.",
    }),
    el("p", {}, [
      el("a", { href: "/app/clients", text: "Back to clients" }),
    ]),
  );
}

function pagingBar({ basePath, offset, limit, total }) {
  if (total === 0) return null;
  const start = Math.min(offset + 1, total);
  const end = Math.min(offset + limit, total);
  const prevOff = Math.max(0, offset - limit);
  const nextOff = offset + limit;
  const wrap = el("div", { className: "pager" });
  wrap.append(
    el("span", { className: "pager-meta", text: `Showing ${start}–${end} of ${total}` }),
  );
  const nav = el("div", { className: "pager-nav" });
  if (offset > 0) {
    nav.append(el("a", { href: pageHref(basePath, prevOff, limit), className: "btn-secondary", text: "Previous" }));
  }
  if (nextOff < total) {
    nav.append(el("a", { href: pageHref(basePath, nextOff, limit), className: "btn-secondary", text: "Next" }));
  }
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

export async function renderClientsList(container, { apiFn, offset = 0, limit = 20 }) {
  const path = `/api/v1/clients?limit=${limit}&offset=${offset}`;
  const result = await loadJson(apiFn, path);
  if (result.kind === "auth") return;
  if (result.kind === "error") {
    renderNotFound(container);
    return;
  }
  const page = result.data;
  container.replaceChildren(el("h1", { text: "Clients" }));
  if (!page.items?.length) {
    container.append(
      el("p", { className: "empty-state", text: "You have no clients you can see." }),
    );
    return;
  }
  const rows = page.items.map((c) => [
    el("td", {}, [el("a", { href: `/app/clients/${c.id}`, text: c.name })]),
    el("td", {}, [el("code", { text: c.id })]),
  ]);
  container.append(dataTable(["Name", "Slug"], rows));
  const bar = pagingBar({
    basePath: "/app/clients",
    offset: page.offset ?? offset,
    limit: page.limit ?? limit,
    total: page.total ?? 0,
  });
  if (bar) container.append(bar);
}

export async function renderClientDetail(container, { apiFn, clientId, offset = 0, limit = 20 }) {
  if (!isValidSlugId(clientId)) {
    renderNotFound(container);
    return;
  }
  const clientRes = await loadJson(apiFn, `/api/v1/clients/${encodeURIComponent(clientId)}`);
  if (clientRes.kind === "auth") return;
  if (clientRes.kind === "not_found" || clientRes.kind === "error") {
    renderNotFound(container);
    return;
  }
  const client = clientRes.data;
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
  if (client.created_at) {
    meta.append(el("dt", { text: "Created" }), el("dd", { text: client.created_at }));
  }
  if (client.notes) {
    meta.append(el("dt", { text: "Notes" }), el("dd", { text: client.notes }));
  }
  container.append(meta);

  container.append(el("h2", { text: "Projects" }));
  const projPath = `/api/v1/clients/${encodeURIComponent(clientId)}/projects?limit=${limit}&offset=${offset}`;
  const projRes = await loadJson(apiFn, projPath);
  if (projRes.kind === "auth") return;
  if (projRes.kind === "not_found" || projRes.kind === "error") {
    renderNotFound(container);
    return;
  }
  const page = projRes.data;
  if (!page.items?.length) {
    container.append(el("p", { className: "muted", text: "No projects in this client." }));
    return;
  }
  const rows = page.items.map((p) => [
    el("td", { text: p.name }),
    el("td", {}, [el("code", { text: p.id })]),
    el("td", { text: p.status ?? "—" }),
  ]);
  container.append(dataTable(["Name", "Slug", "Status"], rows));
  const basePath = `/app/clients/${clientId}`;
  const bar = pagingBar({
    basePath,
    offset: page.offset ?? offset,
    limit: page.limit ?? limit,
    total: page.total ?? 0,
  });
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
  if (projRes.kind === "error") {
    renderNotFound(container);
    return;
  }
  const page = projRes.data;
  container.replaceChildren(el("h1", { text: "Projects" }));
  if (!page.items?.length) {
    container.append(
      el("p", { className: "empty-state", text: "You have no projects you can see." }),
    );
    return;
  }
  const rows = page.items.map((p) => {
    const clientName = names.get(p.client_id) ?? p.client_id;
    const clientCell = names.has(p.client_id)
      ? el("a", { href: `/app/clients/${p.client_id}`, text: clientName })
      : el("span", { text: clientName });
    return [
      el("td", {}, [el("a", { href: `/app/projects/${p.id}`, text: p.name })]),
      el("td", {}, [clientCell]),
      el("td", {}, [el("code", { text: p.id })]),
    ];
  });
  container.append(dataTable(["Project", "Client", "Slug"], rows));
  const bar = pagingBar({
    basePath: "/app/projects",
    offset: page.offset ?? offset,
    limit: page.limit ?? limit,
    total: page.total ?? 0,
  });
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
      el("a", { href: `/app/clients/${project.client_id}`, text: clientLabel }),
      document.createTextNode(` · slug `),
      el("code", { text: project.id }),
    ]),
    el("section", { className: "stub-section" }, [
      el("h2", { text: "Requirements" }),
      el("p", { className: "muted", text: "Coming next." }),
    ]),
    el("section", { className: "stub-section" }, [
      el("h2", { text: "Releases" }),
      el("p", { className: "muted", text: "Coming next." }),
    ]),
  );
}

export async function mountBrowseView(container, route, deps) {
  const { apiFn, search = "" } = deps;
  const offset = readPageOffset(search);
  switch (route.view) {
    case "clients-list":
      await renderClientsList(container, { apiFn, offset });
      break;
    case "client-detail":
      await renderClientDetail(container, {
        apiFn,
        clientId: route.clientId,
        offset,
      });
      break;
    case "projects-list":
      await renderProjectsList(container, { apiFn, offset });
      break;
    case "project-detail":
      await renderProjectDetail(container, { apiFn, projectId: route.projectId });
      break;
    case "unknown":
      renderNotFound(container);
      break;
    default:
      container.replaceChildren(
        el("h1", { text: "ReqALM" }),
        el("p", {
          className: "muted",
          text: "Choose Clients or Projects from the navigation to browse your grant-scoped data.",
        }),
      );
  }
}
