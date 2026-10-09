/** App shell: breadcrumb, minimal nav, and project-scoped tabs. */

import {
  appClientHref,
  appProjectHref,
  appTreeHref,
  isValidSlugId,
  requirementsListHref,
} from "./browse.js";

export const APP_MIN_NAV = [
  {
    href: "/app/clients",
    label: "Clients",
    match: (p) => p === "/app/clients" || p.startsWith("/app/clients/"),
  },
  {
    href: "/app/projects",
    label: "Projects",
    match: (p) =>
      p === "/app/projects" ||
      (p.startsWith("/app/projects/") &&
        !p.includes("/requirements") &&
        !p.includes("/releases") &&
        !p.includes("/tree")),
  },
];

/** @typedef {'requirements'|'traceability'|'capabilities'|'releases'|'contracts'|'audit'} ProjectTabId */

/** @type {Array<{ id: ProjectTabId, label: string, enabled: boolean, href?: (projectId: string) => string, match?: (path: string, projectId: string) => boolean }>} */
export const PROJECT_TABS = [
  {
    id: "requirements",
    label: "Requirements",
    enabled: true,
    href: (pid) => requirementsListHref(pid),
    match: (p, pid) => {
      const enc = encodeURIComponent(pid);
      const base = `/app/projects/${enc}/requirements`;
      const tree = `/app/projects/${enc}/tree`;
      return p === base || p.startsWith(`${base}/`) || p === tree || p.startsWith(`${tree}/`);
    },
  },
  { id: "traceability", label: "Traceability", enabled: false },
  { id: "capabilities", label: "Capabilities", enabled: false },
  { id: "releases", label: "Releases", enabled: true, href: (pid) => `/app/projects/${encodeURIComponent(pid)}/releases`, match: (p, pid) => p.startsWith(`/app/projects/${encodeURIComponent(pid)}/releases`) },
  { id: "contracts", label: "Contracts", enabled: false },
  { id: "audit", label: "Audit", enabled: false },
];

export function initialsFromIdentity(identityId, agentName) {
  const agent = typeof agentName === "string" ? agentName.trim() : "";
  if (agent) {
    const parts = agent.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (parts[0]?.length >= 2) return parts[0].slice(0, 2).toUpperCase();
  }
  const bits = String(identityId ?? "")
    .split(/[-_]/)
    .filter(Boolean);
  if (bits.length >= 2) return (bits[0][0] + bits[1][0]).toUpperCase();
  const id = String(identityId ?? "??");
  return id.slice(0, 2).toUpperCase();
}

export function pageLabelForRoute(route) {
  switch (route.view) {
    case "clients-list":
      return "Clients";
    case "projects-list":
      return "Projects";
    case "client-detail":
      return route.clientId ?? "Client";
    case "project-detail":
      return "Overview";
    case "requirements-list":
      return "Requirements";
    case "requirements-tree":
      return "Requirements";
    case "requirement-detail":
      return route.requirementId ?? "Requirement";
    case "requirement-versions":
      return "Versions";
    case "releases-list":
      return "Releases";
    case "release-detail":
      return route.releaseId ?? "Release";
    default:
      return "ReqALM";
  }
}

/** @param {{ view: string, projectId?: string, clientId?: string, requirementId?: string, releaseId?: string }} route */
export function breadcrumbSegments(route, meta) {
  const page = pageLabelForRoute(route);
  const client = meta.client;
  const project = meta.project;

  if (route.view === "clients-list") {
    return [{ label: "Clients", current: true }];
  }
  if (route.view === "projects-list") {
    return [{ label: "Projects", current: true }];
  }
  if (route.view === "client-detail" && client) {
    return [{ label: client.name || client.id, current: true }];
  }

  const projectViews = new Set([
    "project-detail",
    "requirements-list",
    "requirements-tree",
    "requirement-detail",
    "requirement-versions",
    "releases-list",
    "release-detail",
  ]);
  const inProject = route.projectId && isValidSlugId(route.projectId) && projectViews.has(route.view);

  if (inProject && project) {
    const clientLabel = client?.name || client?.id || project.client_id;
    const clientHref = client?.id ? appClientHref(client.id) : appClientHref(project.client_id);
    const projectHref = appProjectHref(project.id);
    return [
      { label: clientLabel, href: clientHref },
      { label: project.name || project.id, href: projectHref },
      { label: page, current: true },
    ];
  }

  return [{ label: page, current: true }];
}

export function minNavItems(currentPath) {
  return APP_MIN_NAV.map((item) => ({ ...item, active: item.match(currentPath) }));
}

export function projectTabItems(projectId, currentPath) {
  if (!projectId || !isValidSlugId(projectId)) return [];
  return PROJECT_TABS.map((tab) => {
    const active = tab.enabled && tab.match ? tab.match(currentPath, projectId) : false;
    const href = tab.enabled && tab.href ? tab.href(projectId) : null;
    return { ...tab, active, href };
  });
}

export function buildShellHeader(el, route, currentPath, meta) {
  const crumbs = breadcrumbSegments(route, meta);
  const breadcrumbNav = el("nav", { className: "header-breadcrumb", "aria-label": "Breadcrumb" });
  for (let i = 0; i < crumbs.length; i++) {
    const seg = crumbs[i];
    if (i > 0) breadcrumbNav.append(el("span", { className: "crumb-sep", text: " / " }));
    if (seg.href && !seg.current) {
      breadcrumbNav.append(el("a", { href: seg.href, text: seg.label }));
    } else {
      const span = el("span", { text: seg.label });
      if (seg.current) span.setAttribute("aria-current", "page");
      breadcrumbNav.append(span);
    }
  }

  const brand = el("a", { className: "brand", href: "/app/clients" }, [
    el("span", { className: "brand-mark", text: "R" }),
    el("span", { className: "brand-name", text: "ReqALM" }),
  ]);

  const start = el("div", { className: "topbar-start" }, [brand, breadcrumbNav]);

  const showProjectTabs = route.projectId && isValidSlugId(route.projectId);
  const projectNav = el("nav", {
    id: "project-nav",
    className: "project-tabs",
    "aria-label": "Project",
  });
  if (showProjectTabs) {
    for (const tab of projectTabItems(route.projectId, currentPath)) {
      if (tab.enabled && tab.href) {
        const a = el("a", { href: tab.href, text: tab.label, className: "project-tab" });
        if (tab.active) {
          a.classList.add("project-tab-active");
          a.setAttribute("aria-current", "page");
        }
        projectNav.append(a);
      } else {
        projectNav.append(
          el("span", {
            className: "project-tab project-tab-disabled",
            text: tab.label,
            "aria-disabled": "true",
            title: "Coming soon",
          }),
        );
      }
    }
  }

  const minNav = el("nav", { id: "top-nav", className: "min-nav", "aria-label": "Application" });
  if (!showProjectTabs) {
    for (const item of minNavItems(currentPath)) {
      const a = el("a", { href: item.href, text: item.label });
      if (item.active) {
        a.classList.add("nav-active");
        a.setAttribute("aria-current", "page");
      }
      minNav.append(a);
    }
  }

  const initials = initialsFromIdentity(meta.identityId, meta.agentName);
  const end = el("div", { className: "topbar-end" }, [
    el("span", { className: "user-avatar", title: meta.identityId ?? "", text: initials }),
    el("button", { id: "signout", type: "button", className: "signout-btn", text: "Sign out" }),
  ]);

  const headerChildren = [start];
  if (showProjectTabs) headerChildren.push(projectNav);
  else headerChildren.push(minNav);
  headerChildren.push(end);

  return el("header", { className: "topbar" }, headerChildren);
}
