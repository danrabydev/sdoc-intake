// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeEach, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import {
  SLUG_MAX_LENGTH,
  appClientHref,
  appProjectHref,
  appRequirementHref,
  appRequirementVersionsHref,
  appReleaseHref,
  appTreeHref,
  requirementsListHref,
  requirementsTreeApiPath,
  releasesListHref,
  readReleaseFilters,
  ancestorBrowseHref,
  isValidSlugId,
  isValidRequirementId,
  parseAppRoute,
  readPageOffset,
  readRequirementsFilters,
  pagingOffsets,
  renderClientsList,
  renderClientDetail,
  renderProjectsList,
  renderProjectDetail,
  renderRequirementsList,
  renderRequirementDetail,
  renderRequirementVersions,
  renderReleasesList,
  renderReleaseDetail,
  renderRequirementsTree,
  renderNotFound,
  mountBrowseView,
  decodeRouteSegment,
  pageHref,
} from "./public/browse.js";
import {
  fillRequirementRelationsPanel,
  imprintShortLabel,
  relationPeerChip,
  relationsPanelShell,
  requirementsRelationsApiPath,
  renderKindBlock,
} from "./public/browse-relations.js";
import {
  APP_MIN_NAV,
  breadcrumbSegments,
  projectTabItems,
  PROJECT_TABS,
} from "./public/shell-nav.js";
import { api, setUnauthorizedRedirect, clearUnauthorizedRedirect } from "./public/api-client.js";
import { rootRedirectPath, renderAppShell, signOut } from "./public/app.js";
import { pathGetsWebSpaShell } from "./spa-shell-paths.js";

type FetchHandler = (url: string) => { status: number; body?: unknown };

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function installDom(url = "http://localhost/app/clients") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  return dom;
}

const slugLen = (n: number) => "a" + "b".repeat(n - 1);

function emptyRelationsPayload(requirementId: string, projectId = "reqalm") {
  return { data: { id: requirementId, project_id: projectId, outgoing: {}, incoming: {} } };
}

function relationsPath(projectId: string, requirementId: string) {
  return requirementsRelationsApiPath(projectId, requirementId);
}

describe("browse routes and helpers", () => {
  it("parses clients, projects, and requirements paths", () => {
    assert.deepEqual(parseAppRoute("/app/clients"), { view: "clients-list", offset: 0 });
    assert.deepEqual(parseAppRoute("/app/clients/acme"), { view: "client-detail", clientId: "acme", offset: 0 });
    assert.deepEqual(parseAppRoute("/app/projects/reqalm"), { view: "project-detail", projectId: "reqalm" });
    assert.deepEqual(parseAppRoute("/app/projects/reqalm/requirements"), { view: "requirements-list", projectId: "reqalm" });
    assert.deepEqual(parseAppRoute("/app/projects/reqalm/requirements/R1"), {
      view: "requirement-detail",
      projectId: "reqalm",
      requirementId: "R1",
    });
    assert.deepEqual(parseAppRoute("/app/projects/reqalm/requirements/R1/versions"), {
      view: "requirement-versions",
      projectId: "reqalm",
      requirementId: "R1",
    });
    assert.deepEqual(parseAppRoute("/app/projects/reqalm/releases"), { view: "releases-list", projectId: "reqalm" });
    assert.deepEqual(parseAppRoute("/app/projects/reqalm/releases/rel-r1"), {
      view: "release-detail",
      projectId: "reqalm",
      releaseId: "rel-r1",
    });
    assert.deepEqual(parseAppRoute("/app/projects/reqalm/tree"), { view: "requirements-tree", projectId: "reqalm" });
    assert.equal(parseAppRoute("/app/nope").view, "unknown");
    assert.deepEqual(APP_MIN_NAV.map((n) => n.label), ["Clients", "Projects"]);
  });

  it("validates slug and requirement ids", () => {
    assert.ok(isValidSlugId("reqalm-client") && !isValidSlugId("Bad_Slug!"));
    assert.ok(isValidSlugId(slugLen(SLUG_MAX_LENGTH)) && !isValidSlugId(slugLen(SLUG_MAX_LENGTH + 1)));
    assert.ok(isValidRequirementId("CAP-READ-REQS") && !isValidRequirementId("bad id!"));
  });

  it("builds encoded hrefs and filter URLs", () => {
    assert.equal(appProjectHref("a/b"), "/app/projects/a%2Fb");
    assert.equal(appClientHref("c%2"), "/app/clients/c%252");
    assert.equal(appRequirementHref("p1", "A.B"), "/app/projects/p1/requirements/A.B");
    assert.equal(
      requirementsListHref("p1", { kind: "cap", q: "a b", offset: 20 }),
      "/app/projects/p1/requirements?kind=cap&q=a+b&offset=20",
    );
    assert.equal(appRequirementVersionsHref("p1", "R1", 20), "/app/projects/p1/requirements/R1/versions?offset=20");
    assert.equal(appReleaseHref("p1", "rel/a"), "/app/projects/p1/releases/rel%2Fa");
    assert.equal(releasesListHref("p1", { status: "planned", offset: 20 }), "/app/projects/p1/releases?status=planned&offset=20");
    assert.equal(appTreeHref("p1"), "/app/projects/p1/tree");
    assert.equal(requirementsTreeApiPath("p1", null), "/api/v1/projects/p1/requirements/tree?limit=100&offset=0");
    assert.equal(requirementsTreeApiPath("p1", "SEC-CP"), "/api/v1/projects/p1/requirements/tree?limit=100&offset=0&parent=SEC-CP");
    assert.equal(ancestorBrowseHref("p1", { uid: "SEC-1", title: "S", kind: "section" }), "/app/projects/p1/tree");
    assert.equal(ancestorBrowseHref("p1", { uid: "R1", title: "R", kind: "requirement" }), "/app/projects/p1/requirements/R1");
    assert.deepEqual(readReleaseFilters("?status=shipped"), { status: "shipped" });
    assert.deepEqual(readReleaseFilters("?status=nope"), { status: "" });
    assert.deepEqual(readRequirementsFilters("?kind=k&type=t&status=s&q=find"), {
      kind: "k",
      type: "t",
      status: "s",
      q: "find",
    });
    assert.equal(readPageOffset("?offset=20"), 20);
    assert.equal(pageHref("/app/clients", 20), "/app/clients?offset=20");
    assert.deepEqual(pagingOffsets(20, 20, 45), { prevOff: 0, nextOff: 40, showPrev: true, showNext: true });
  });

  it("pathGetsWebSpaShell table", () => {
    const yes = [
      "/",
      "/login",
      "/login/x",
      "/app",
      "/app/projects/p/requirements",
      "/app/projects/p/requirements/R/versions",
      "/app/projects/p/tree",
    ];
    const no = ["/loginx", "/applesauce", "/.env"];
    for (const p of yes) assert.equal(pathGetsWebSpaShell(p), true, p);
    for (const p of no) assert.equal(pathGetsWebSpaShell(p), false, p);
  });
});

describe("browse UI render (jsdom)", () => {
  let fetchCalls: string[];

  beforeEach(() => {
    installDom();
    fetchCalls = [];
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  });

  function mockFetch(handler: FetchHandler) {
    return (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      const { status, body } = handler(url);
      return jsonResponse(status, body) as Response;
    }) as unknown as typeof fetch;
  }

  type TreeNodeRow = {
    uid: string;
    title: string;
    kind: string;
    type: string;
    status: string;
    child_count: number;
  };

  function treeRow(uid: string, kind: string, child_count: number, title = uid): TreeNodeRow {
    return { uid, title, kind, type: kind, status: "active", child_count };
  }

  function treeFetchHandler(
    roots: TreeNodeRow[],
    opts: {
      children?: Record<string, TreeNodeRow[]>;
      parentResponses?: Record<string, (call: number) => { status: number; body?: unknown }>;
    } = {},
  ): FetchHandler {
    const parentCalls: Record<string, number> = {};
    return (url) => {
      if (url.includes("/requirements/tree?limit=100&offset=0") && !url.includes("parent=")) {
        return { status: 200, body: { data: { items: roots, limit: 100, offset: 0, total: roots.length } } };
      }
      const parentParam = url.match(/[?&]parent=([^&]+)/)?.[1];
      const parentUid = parentParam ? decodeURIComponent(parentParam) : null;
      if (parentUid) {
        const custom = opts.parentResponses?.[parentUid];
        if (custom) {
          parentCalls[parentUid] = (parentCalls[parentUid] ?? 0) + 1;
          const res = custom(parentCalls[parentUid]);
          return res.body != null ? { status: res.status, body: res.body } : { status: res.status };
        }
        const rows = opts.children?.[parentUid];
        if (rows) {
          return { status: 200, body: { data: { items: rows, limit: 100, offset: 0, total: rows.length } } };
        }
      }
      return { status: 404 };
    };
  }

  async function mountTreeView(handler: FetchHandler, projectId = "reqalm") {
    const main = document.createElement("main");
    await renderRequirementsTree(main, { apiFn: mockFetch(handler), projectId });
    return {
      main,
      tree: main.querySelector('[role="tree"]'),
      tick: (ms = 30) => new Promise((r) => setTimeout(r, ms)),
      focused: () => main.querySelector('[role="treeitem"][tabindex="0"]'),
      focusedUid: () => main.querySelector('[role="treeitem"][tabindex="0"]')?.querySelector(".req-tree-uid")?.textContent,
    };
  }

  it("list views handle API 404 without throwing", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch(() => ({ status: 404 }));
    await renderClientsList(main, { apiFn });
    assert.match(main.textContent ?? "", /don't have access/i);
    await renderProjectsList(main, { apiFn });
    assert.match(main.textContent ?? "", /don't have access/i);
    await renderRequirementsList(main, { apiFn, projectId: "reqalm", filters: {}, offset: 0 });
    assert.match(main.textContent ?? "", /don't have access/i);
    await renderReleasesList(main, { apiFn, projectId: "reqalm", filters: { status: "" }, offset: 0 });
    assert.match(main.textContent ?? "", /don't have access/i);
  });

  it("clients list paging and empty states", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch((url) => {
      if (url === "/api/v1/clients?limit=20&offset=20") {
        return {
          status: 200,
          body: { data: { items: [{ id: "acme", name: "Acme", created_at: null, notes: null }], limit: 20, offset: 20, total: 45 } },
        };
      }
      if (url.startsWith("/api/v1/clients?")) {
        return { status: 200, body: { data: { items: [], limit: 20, offset: 0, total: 0 } } };
      }
      return { status: 404 };
    });
    await renderClientsList(main, { apiFn, offset: 20, limit: 20 });
    assert.match(main.textContent ?? "", /Showing 21–40 of 45/);
    assert.ok(main.querySelector('a.btn-secondary[href="/app/clients?offset=40"]'));
    assert.ok(main.querySelector('a.btn-secondary[href="/app/clients"]'));
    await renderClientsList(main, { apiFn: mockFetch(() => ({ status: 200, body: { data: { items: [], limit: 20, offset: 0, total: 0 } } })) });
    assert.match(main.textContent ?? "", /no clients you can see/i);
    await renderClientsList(main, { apiFn: mockFetch(() => ({ status: 200, body: { data: { items: [], limit: 20, offset: 40, total: 25 } } })), offset: 40 });
    assert.match(main.textContent ?? "", /No more results/i);
  });

  it("renders client-detail projects paging with exact hrefs", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch((url) => {
      if (url === "/api/v1/clients/reqalm-client") {
        return { status: 200, body: { data: { id: "reqalm-client", name: "ReqALM Client", notes: null, created_at: null } } };
      }
      if (url === "/api/v1/clients/reqalm-client/projects?limit=20&offset=20") {
        return {
          status: 200,
          body: {
            data: {
              items: [{ id: "p2", client_id: "reqalm-client", name: "P2", status: "draft" }],
              limit: 20,
              offset: 20,
              total: 45,
            },
          },
        };
      }
      return { status: 404 };
    });
    await renderClientDetail(main, { apiFn, clientId: "reqalm-client", offset: 20, limit: 20 });
    assert.ok(main.querySelector('a.btn-secondary[href="/app/clients/reqalm-client?offset=40"]'));
    assert.ok(main.querySelector('a.btn-secondary[href="/app/clients/reqalm-client"]'));
    assert.match(main.textContent ?? "", /draft/);
    assert.ok(main.querySelector('a[href="/app/projects/p2"]'));
  });

  it("client detail omits notes and validates slug", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch((url) => {
      if (url === "/api/v1/clients/reqalm-client") {
        return { status: 200, body: { data: { id: "reqalm-client", name: "ReqALM Client", notes: "Secret notes", created_at: "2026-01-01" } } };
      }
      if (url.startsWith("/api/v1/clients/reqalm-client/projects")) {
        return { status: 200, body: { data: { items: [{ id: "reqalm", client_id: "reqalm-client", name: "ReqALM", status: "active" }], limit: 20, offset: 0, total: 1 } } };
      }
      return { status: 404 };
    });
    await renderClientDetail(main, { apiFn, clientId: "reqalm-client" });
    assert.doesNotMatch(main.textContent ?? "", /Secret notes/);
    assert.doesNotMatch(main.textContent ?? "", /Notes/);
  });

  it("invalid slugs skip API fetch", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch(() => {
      throw new Error("should not fetch");
    });
    await renderClientDetail(main, { apiFn, clientId: "INVALID!" });
    await renderProjectDetail(main, { apiFn, projectId: "Bad_Slug!" });
    await renderRequirementsList(main, { apiFn, projectId: "bad!", filters: {}, offset: 0 });
    await renderReleasesList(main, { apiFn, projectId: "bad!", filters: { status: "" }, offset: 0 });
    await renderRequirementsTree(main, { apiFn, projectId: "bad!" });
    assert.equal(fetchCalls.length, 0);
  });

  it("requirements list passes filters to API and reflects URL in form", async () => {
    const main = document.createElement("main");
    const filters = { kind: "capability", type: "capability", status: "active", q: "read" };
    const apiFn = mockFetch((url) => {
      const u = new URL(url, "http://localhost");
      assert.equal(u.pathname, "/api/v1/projects/reqalm/requirements");
      assert.equal(u.searchParams.get("limit"), "20");
      assert.equal(u.searchParams.get("offset"), "0");
      assert.equal(u.searchParams.get("kind"), "capability");
      assert.equal(u.searchParams.get("type"), "capability");
      assert.equal(u.searchParams.get("status"), "active");
      assert.equal(u.searchParams.get("q"), "read");
      return {
        status: 200,
        body: {
          data: {
            items: [{ id: "CAP-1", title: "Title", kind: "capability", type: "capability", status: "active", version_n: 2, version_id: "CAP-1" }],
            limit: 20,
            offset: 0,
            total: 1,
          },
        },
      };
    });
    await renderRequirementsList(main, { apiFn, projectId: "reqalm", filters, offset: 0 });
    const form = main.querySelector("form.filter-bar");
    assert.equal(form?.getAttribute("action"), "/app/projects/reqalm/requirements");
    assert.equal(form?.querySelector('input[name="kind"]')?.getAttribute("value"), "capability");
    assert.equal(form?.querySelector('input[name="q"]')?.getAttribute("value"), "read");
    assert.equal(form?.querySelector('input[name="kind"]')?.getAttribute("maxlength"), "64");
    assert.equal(form?.querySelector('input[name="type"]')?.getAttribute("maxlength"), "64");
    assert.equal(form?.querySelector('input[name="status"]')?.getAttribute("maxlength"), "64");
    assert.equal(form?.querySelector('input[name="q"]')?.getAttribute("maxlength"), "200");
    assert.ok(main.querySelector('a[href="/app/projects/reqalm/requirements/CAP-1"]'));
    await renderRequirementsList(main, {
      apiFn: mockFetch(() => ({ status: 200, body: { data: { items: [], limit: 20, offset: 0, total: 0 } } })),
      projectId: "reqalm",
      filters,
      offset: 0,
    });
    assert.match(main.textContent ?? "", /No requirements match your filters/);
    await renderRequirementsList(main, {
      apiFn: mockFetch(() => ({ status: 200, body: { data: { items: [], limit: 20, offset: 0, total: 0 } } })),
      projectId: "reqalm",
      filters: {},
      offset: 0,
    });
    assert.match(main.textContent ?? "", /No requirements in this project/);
  });

  it("shows projects list empty state and happy path with client link", async () => {
    const emptyMain = document.createElement("main");
    await renderProjectsList(emptyMain, {
      apiFn: mockFetch((url) => {
        if (url.startsWith("/api/v1/clients?")) {
          return { status: 200, body: { data: { items: [], limit: 100, offset: 0, total: 0 } } };
        }
        if (url.startsWith("/api/v1/projects?")) {
          return { status: 200, body: { data: { items: [], limit: 20, offset: 0, total: 0 } } };
        }
        return { status: 404 };
      }),
    });
    assert.match(emptyMain.textContent ?? "", /no projects you can see/i);

    const main = document.createElement("main");
    await renderProjectsList(main, {
      apiFn: mockFetch((url) => {
        if (url.startsWith("/api/v1/clients?")) {
          return { status: 200, body: { data: { items: [{ id: "c1", name: "Client One" }], limit: 100, offset: 0, total: 1 } } };
        }
        if (url.startsWith("/api/v1/projects?")) {
          return {
            status: 200,
            body: { data: { items: [{ id: "p1", client_id: "c1", name: "Project One", status: null }], limit: 20, offset: 0, total: 1 } },
          };
        }
        return { status: 404 };
      }),
    });
    assert.match(main.textContent ?? "", /Project One/);
    assert.match(main.textContent ?? "", /Client One/);
    assert.ok(main.querySelector('a[href="/app/projects/p1"]'));
    assert.ok(main.querySelector('a[href="/app/clients/c1"]'));
  });

  it("requirements list past end shows No more results", async () => {
    const main = document.createElement("main");
    await renderRequirementsList(main, {
      apiFn: mockFetch(() => ({
        status: 200,
        body: { data: { items: [], limit: 20, offset: 40, total: 25 } },
      })),
      projectId: "reqalm",
      filters: { kind: "", type: "", status: "", q: "" },
      offset: 40,
    });
    assert.match(main.textContent ?? "", /No more results/i);
    assert.ok(main.querySelector('a[href="/app/projects/reqalm/requirements"]'));
    assert.doesNotMatch(main.textContent ?? "", /don't have access/i);
  });

  it("requirements paging preserves filters in hrefs", async () => {
    const main = document.createElement("main");
    const filters = { kind: "cap", type: "feature", status: "", q: "x" };
    const apiFn = mockFetch(() => ({
      status: 200,
      body: { data: { items: [{ id: "R1", title: "T", kind: "k", type: "t", status: "draft", version_n: 0, version_id: "R1" }], limit: 20, offset: 20, total: 45 } },
    }));
    await renderRequirementsList(main, { apiFn, projectId: "reqalm", filters, offset: 20 });
    assert.match(main.textContent ?? "", /Showing 21–40 of 45/);
    assert.ok(
      main.querySelector('a.btn-secondary[href="/app/projects/reqalm/requirements?kind=cap&type=feature&q=x&offset=40"]'),
    );
  });

  it("requirement detail and versions", async () => {
    const main = document.createElement("main");
    const detailFn = mockFetch((url) => {
      if (url === "/api/v1/projects/reqalm/requirements/CAP-1") {
        return {
          status: 200,
          body: {
            data: {
              id: "CAP-1",
              title: "Read reqs",
              kind: "capability",
              type: "capability",
              status: "active",
              version_n: 3,
              statement: "Full statement text.",
              attributes: { priority: 10, iteration: null, rbac_op: "r:list" },
            },
          },
        };
      }
      if (url === relationsPath("reqalm", "CAP-1")) {
        return { status: 200, body: emptyRelationsPayload("CAP-1") };
      }
      return { status: 404 };
    });
    await renderRequirementDetail(main, {
      apiFn: detailFn,
      projectId: "reqalm",
      requirementId: "CAP-1",
      listFilters: { kind: "cap", type: "", status: "", q: "" },
    });
    assert.match(main.textContent ?? "", /v3/);
    assert.match(main.textContent ?? "", /Full statement text/);
    assert.ok(main.querySelector('a[href="/app/projects/reqalm/requirements?kind=cap"]'));
    assert.ok(main.querySelector('a[href="/app/projects/reqalm/requirements/CAP-1/versions"]'));
    await renderRequirementDetail(main, { apiFn: mockFetch(() => { throw new Error("no"); }), projectId: "reqalm", requirementId: "bad!" });
    assert.equal(fetchCalls.filter((u) => u.includes("requirements")).length, 2);

    const verMain = document.createElement("main");
    const verFn = mockFetch(() => ({
      status: 200,
      body: {
        data: {
          items: [
            { version_n: 2, status: "active", title: "v2", statement: "s2" },
            { version_n: 1, status: "superseded", title: "v1", statement: "s1" },
          ],
          limit: 20,
          offset: 0,
          total: 2,
        },
      },
    }));
    await renderRequirementVersions(verMain, { apiFn: verFn, projectId: "reqalm", requirementId: "CAP-1" });
    const verCells = [...verMain.querySelectorAll("tbody tr td:first-child")].map((td) => td.textContent);
    assert.deepEqual(verCells, ["2", "1"]);
    assert.match(verMain.textContent ?? "", /s2/);
    assert.match(verMain.textContent ?? "", /superseded/);
  });

  it("project detail links to requirements list", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch((url) => {
      if (url === "/api/v1/projects/p1") return { status: 200, body: { data: { id: "p1", client_id: "c1", name: "P One" } } };
      if (url === "/api/v1/clients/c1") return { status: 200, body: { data: { id: "c1", name: "Client One" } } };
      return { status: 404 };
    });
    await renderProjectDetail(main, { apiFn, projectId: "p1" });
    assert.ok(main.querySelector('a[href="/app/projects/p1/requirements"]'));
    assert.ok(main.querySelector('a[href="/app/projects/p1/tree"]'));
    assert.ok(main.querySelector('a[href="/app/projects/p1/releases"]'));
    assert.match(main.textContent ?? "", /Browse requirements/);
    assert.match(main.textContent ?? "", /Browse releases/);
  });

  it("requirements tree loads roots and lazy children once with aria-level", async () => {
    let childFetches = 0;
    const stub = treeFetchHandler([treeRow("SEC-A", "section", 1, "Section A")], {
      children: { "SEC-A": [treeRow("CAP-1", "capability", 0, "Cap one")] },
    });
    const { main, tick } = await mountTreeView((url) => {
      if (url.includes("parent=SEC-A")) childFetches += 1;
      return stub(url);
    });
    const rootsUrl = requirementsTreeApiPath("reqalm", null);
    assert.equal(fetchCalls.filter((u) => u === rootsUrl).length, 1);
    const root = main.querySelector('[role="treeitem"][aria-level="1"]');
    assert.ok(root);
    assert.equal(root?.getAttribute("aria-expanded"), "false");
    assert.match(root?.textContent ?? "", /section/);
    assert.match(root?.textContent ?? "", /SEC-A/);
    root?.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick(0);
    assert.equal(childFetches, 1);
    assert.equal(fetchCalls.filter((u) => u.includes("parent=SEC-A")).length, 1);
    const child = main.querySelector('[role="treeitem"][aria-level="2"]');
    assert.ok(child);
    assert.match(child?.textContent ?? "", /capability/);
    assert.ok(main.querySelector('a[href="/app/projects/reqalm/requirements/CAP-1"]'));
    root?.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick(0);
    assert.equal(root?.getAttribute("aria-expanded"), "false");
    const group = root?.querySelector('[role="group"]');
    assert.equal(group?.hidden, true);
    assert.ok(group?.closest("[hidden]") ?? group?.hasAttribute("hidden"));
    root?.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick(0);
    assert.equal(childFetches, 1);
  });

  it("tree keyboard navigation moves focus and expands with ArrowRight", async () => {
    const { main, tree, tick, focusedUid } = await mountTreeView(
      treeFetchHandler([treeRow("SEC-1", "section", 1, "S1")], {
        children: { "SEC-1": [treeRow("R-1", "requirement", 0, "Req")] },
      }),
    );
    const items = () => [...main.querySelectorAll('[role="treeitem"]')];
    assert.equal(focusedUid(), "SEC-1");
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await tick();
    assert.equal(items()[0]?.getAttribute("aria-expanded"), "true");
    assert.equal(items().length, 2);
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(focusedUid(), "R-1");
    assert.equal(main.querySelector('[role="treeitem"][tabindex="0"]')?.getAttribute("aria-level"), "2");
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    assert.equal(focusedUid(), "SEC-1");
  });

  it("requirement detail relationships panel: links, catalog, restricted, suspect, empty, error", async () => {
    const xss = '<img src=x onerror=alert(1)>';
    const encodedId = "A B/C?x#y";
    const req = (id: string, title: string | null, project_id = "reqalm") => ({ id, title, kind: "requirement", type: "requirement", project_id });
    const link = (kind: string, dir: string, pvid: string, peer: object, extra: Record<string, unknown> = {}) => ({
      relation_kind: kind, direction: dir, self_version_id: "ANCHOR", peer_version_id: pvid, trace_suspect: false, peer, ...extra,
    });
    const relPayload = {
      id: "ANCHOR",
      project_id: "reqalm",
      outgoing: {
        satisfies: [link("satisfies", "outgoing", xss, req(xss, "safe title"))],
        uses: [link("uses", "outgoing", "USE-TGT", req("USE-TGT", xss))],
        conforms_to: [link("conforms_to", "outgoing", xss, { id: xss, title: null, kind: "control", type: "catalog_control", project_id: "p2" }, { catalog_imprint_id: "nist-800-53@rev5-dogfood-20261006", trace_suspect: true })],
      },
      incoming: {
        refines: [
          link("refines", "incoming", "PEER-IN", req("PEER-IN", null), { trace_suspect: true }),
          link("refines", "incoming", "TWIN-A01", req("A01", "Twin A01", "twin-b")),
          link("refines", "incoming", encodedId, req(encodedId, "Encoded id peer")),
          { restricted: true, relation_kind: "refines", direction: "incoming" },
        ],
      },
    };
    const detailBody = { id: "ANCHOR", title: "Anchor", kind: "capability", type: "capability", status: "active", version_n: 0, statement: "S", attributes: {} };
    const main = document.createElement("main");
    await renderRequirementDetail(main, {
      apiFn: mockFetch((url) => {
        if (url === "/api/v1/projects/reqalm/requirements/ANCHOR") return { status: 200, body: { data: detailBody } };
        if (url === relationsPath("reqalm", "ANCHOR")) return { status: 200, body: { data: relPayload } };
        return { status: 404 };
      }),
      projectId: "reqalm",
      requirementId: "ANCHOR",
      listFilters: {},
    });
    assert.equal(main.querySelectorAll("img").length, 0);
    assert.ok((main.textContent ?? "").includes(xss));
    assert.ok([...main.querySelectorAll(".relation-chip-id")].some((n) => n.textContent === xss));
    const outgoing = main.querySelector('[data-direction="outgoing"]');
    const incoming = main.querySelector('[data-direction="incoming"]');
    for (const re of [/Outgoing/, /Satisfies/, /this → 1 peer/, /Uses/, /Conforms to/]) {
      assert.match(outgoing?.textContent ?? "", re);
    }
    for (const re of [/Incoming/, /Refines/, /→ this 4 peers/]) {
      assert.match(incoming?.textContent ?? "", re);
    }
    assert.equal(outgoing?.querySelector(".relations-direction-count")?.textContent, "3");
    assert.equal(incoming?.querySelector(".relations-direction-count")?.textContent, "4");
    assert.ok([...main.querySelectorAll(".relation-chip-suspect")].every((n) => n.textContent === "needs re-check"));
    const xssChip = outgoing?.querySelector(".relation-kind-block .relation-chip-noproj");
    assert.ok(xssChip && !xssChip.querySelector("a") && outgoing.contains(xssChip) && !incoming?.contains(xssChip));
    const usesLink = outgoing?.querySelector('a.relation-chip-link[href="/app/projects/reqalm/requirements/USE-TGT"]');
    assert.ok(usesLink);
    assert.ok((usesLink?.textContent ?? "").includes(xss));
    assert.equal(usesLink?.querySelector(".relation-chip-title")?.getAttribute("title"), xss);
    assert.equal(usesLink?.querySelector(".relation-chip-status")?.textContent, "Requirement");
    assert.equal(usesLink?.querySelector(".relation-chip-project"), null);
    const inLink = incoming?.querySelector('a.relation-chip-link[href="/app/projects/reqalm/requirements/PEER-IN"]');
    assert.ok(inLink);
    assert.equal(inLink?.querySelector(".relation-chip-title"), null);
    assert.match(inLink?.textContent ?? "", /PEER-IN/);
    const twinLink = incoming?.querySelector('a.relation-chip-link[href="/app/projects/twin-b/requirements/A01"]');
    assert.ok(twinLink);
    assert.equal(twinLink?.querySelector(".relation-chip-version"), null);
    const twinTag = twinLink?.querySelector(".relation-chip-project");
    assert.equal(twinTag?.textContent, "twin-b");
    assert.ok(twinTag?.childNodes.length && twinTag.childNodes[0]?.nodeType === 3);
    assert.equal(incoming?.querySelector(`a[href="/app/projects/reqalm/requirements/A01"]`), null);
    assert.ok([...(incoming?.querySelectorAll(".relation-chip-noproj") ?? [])].some((c) => c.querySelector(".relation-chip-id")?.textContent === encodedId));
    assert.equal(incoming?.querySelector(`a.relation-chip-link[href="/app/projects/reqalm/requirements/${encodeURIComponent(encodedId)}"]`), null);
    assert.equal(main.querySelectorAll(".relation-chip-suspect").length, 2);
    const catalog = main.querySelector(".relation-chip-catalog");
    assert.ok(catalog);
    assert.notEqual(catalog?.tagName, "A");
    assert.equal(catalog?.getAttribute("href"), null);
    assert.ok((catalog?.textContent ?? "").includes(xss) && (catalog?.textContent ?? "").includes("NIST"));
    assert.equal(catalog?.querySelector(".relation-chip-title")?.textContent, xss);
    const catTag = catalog?.querySelector(".relation-chip-project");
    assert.equal(catTag?.textContent, "p2");
    assert.equal(catTag?.childNodes[0]?.nodeType, 3);
    assert.equal(catalog?.querySelector(".relation-chip-id")?.getAttribute("title"), xss);
    assert.equal(twinLink?.querySelector(".relation-chip-id")?.getAttribute("title"), "A01");
    const restricted = main.querySelector(".relation-chip-restricted");
    assert.ok(restricted);
    assert.notEqual(restricted?.tagName, "A");
    assert.equal(restricted?.getAttribute("href"), null);
    assert.match(restricted?.textContent ?? "", /Restricted/);
    assert.doesNotMatch(restricted?.textContent ?? "", /PEER/);

    const reqStub = (id: string) => ({ id, title: "E", kind: "requirement", type: "requirement", status: "active", version_n: 0, statement: "s", attributes: {} });
    for (const [rid, relFn] of [
      ["ERR-1", () => ({ status: 500, body: {} })],
      ["NET-1", () => { throw new Error("network down"); }],
    ] as const) {
      const m = document.createElement("main");
      await renderRequirementDetail(m, {
        apiFn: mockFetch((url) => {
          if (url === `/api/v1/projects/reqalm/requirements/${rid}`) return { status: 200, body: { data: reqStub(rid) } };
          if (url === relationsPath("reqalm", rid)) return relFn();
          return { status: 404 };
        }),
        projectId: "reqalm",
        requirementId: rid,
        listFilters: {},
      });
      assert.ok(m.querySelector(".relations-error"));
      assert.equal(m.querySelector(".relations-loading"), null);
    }

    const emptyMain = document.createElement("main");
    await renderRequirementDetail(emptyMain, {
      apiFn: mockFetch((url) => {
        if (url === "/api/v1/projects/reqalm/requirements/EMPTY-1") {
          return { status: 200, body: { data: { id: "EMPTY-1", title: "E", kind: "requirement", type: "requirement", status: "active", version_n: 0, statement: "s", attributes: {} } } };
        }
        if (url === relationsPath("reqalm", "EMPTY-1")) return { status: 200, body: emptyRelationsPayload("EMPTY-1") };
        return { status: 404 };
      }),
      projectId: "reqalm",
      requirementId: "EMPTY-1",
      listFilters: {},
    });
    assert.ok(emptyMain.querySelector(".relations-empty-state"));

    assert.equal(imprintShortLabel("nist-800-53@rev5"), "NIST");
    assert.ok(relationsPanelShell().querySelector(".relations-loading"));
  });

  it("relations collapse toggle, chip version, and missing project_id", async () => {
    const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "public/styles.css");
    assert.match(fs.readFileSync(cssPath, "utf8"), /\.relation-chip-list\[hidden\]\s*\{\s*display:\s*none/);
    const peer = (id: string) => ({ relation_kind: "satisfies", direction: "outgoing", self_version_id: "A", peer_version_id: id, trace_suspect: false, peer: { id, title: id, kind: "requirement", type: "requirement", project_id: "reqalm" } });
    const block = renderKindBlock(
      "satisfies",
      "outgoing",
      Array.from({ length: 12 }, (_, i) => peer(`P${i}`)),
      "reqalm",
    );
    const lists = block.querySelectorAll(".relation-chip-list");
    assert.equal(lists.length, 2);
    assert.equal(lists[0].querySelectorAll(".relation-chip").length, 10);
    assert.equal(lists[1].querySelectorAll(".relation-chip").length, 2);
    assert.equal(lists[1].hidden, true);
    const btn = block.querySelector(".relation-show-all");
    assert.equal(btn?.textContent, "Show all 12");
    assert.equal(btn?.getAttribute("aria-expanded"), "false");
    for (const [hidden, label, expanded] of [
      [false, "Show less", "true"],
      [true, "Show all 12", "false"],
    ] as const) {
      btn?.dispatchEvent(new window.Event("click", { bubbles: true }));
      assert.equal(lists[1].hidden, hidden);
      assert.equal(btn?.textContent, label);
      assert.equal(btn?.getAttribute("aria-expanded"), expanded);
    }
    assert.equal(
      relationPeerChip(
        {
          relation_kind: "refines",
          direction: "incoming",
          self_version_id: "X",
          peer_version_id: "BASE.1",
          trace_suspect: false,
          peer: { id: "BASE", title: "Base line", kind: "requirement", type: "requirement", project_id: "reqalm" },
        },
        "reqalm",
      ).querySelector(".relation-chip-version")?.textContent,
      ".1",
    );
    const authPanel = relationsPanelShell();
    await fillRequirementRelationsPanel(authPanel, { apiFn: async () => null, projectId: "reqalm", requirementId: "R" });
    assert.equal(authPanel.querySelector(".relations-error"), null);
    assert.equal(authPanel.querySelector(".relations-panel-body"), null);
    const reqLink = (peer: object) => relationPeerChip({ relation_kind: "uses", direction: "outgoing", self_version_id: "A", peer_version_id: "Z", trace_suspect: false, peer }, "reqalm");
    for (const chip of [
      reqLink({ id: "Z", title: "Z", kind: "requirement", type: "requirement" }),
      reqLink({ id: "Z", title: "Z", kind: "requirement", type: "requirement", project_id: "<b>p</b>" }),
      reqLink({ id: "bad/id", title: "Bad", kind: "requirement", type: "requirement", project_id: "reqalm" }),
    ]) {
      assert.equal(chip.tagName, "DIV");
      assert.equal(chip.getAttribute("href"), null);
      assert.equal(chip.querySelector("a"), null);
    }
    const evil = reqLink({ id: "Z", title: "Z", kind: "requirement", type: "requirement", project_id: "<b>p</b>" });
    assert.equal(evil.querySelector("b"), null);
    assert.equal(evil.querySelector(".relation-chip-project")?.textContent, "<b>p</b>");
    const sameCat = { id: "C", title: "C", kind: "control", type: "catalog_control", project_id: "reqalm" };
    assert.equal(relationPeerChip({ relation_kind: "conforms_to", direction: "outgoing", self_version_id: "A", peer_version_id: "C", trace_suspect: false, catalog_imprint_id: "nist@x", peer: sameCat }, "reqalm").querySelector(".relation-chip-project"), null);
  });

  it("requirement detail breadcrumbs use ancestor order and section vs requirement links", async () => {
    const main = document.createElement("main");
    await renderRequirementDetail(main, {
      apiFn: mockFetch((url) => {
        if (url === "/api/v1/projects/reqalm/requirements/LEAF") {
          return {
            status: 200,
            body: {
              data: {
                id: "LEAF",
                title: "Leaf title",
                kind: "requirement",
                type: "requirement",
                status: "active",
                version_n: 1,
                statement: "S",
                attributes: {},
                ancestors: [
                  { uid: "SEC-ROOT", title: "Root section", kind: "section" },
                  { uid: "MID", title: "Mid req", kind: "requirement" },
                ],
              },
            },
          };
        }
        if (url === relationsPath("reqalm", "LEAF")) return { status: 200, body: emptyRelationsPayload("LEAF") };
        return { status: 404 };
      }),
      projectId: "reqalm",
      requirementId: "LEAF",
      listFilters: {},
    });
    const links = [...main.querySelectorAll(".breadcrumb a")].map((a) => a.getAttribute("href"));
    assert.deepEqual(links, ["/app/projects/reqalm", "/app/projects/reqalm/tree", "/app/projects/reqalm/requirements/MID"]);
    assert.match(main.textContent ?? "", /Root section/);
    assert.match(main.textContent ?? "", /Mid req/);
    const crumbText = main.querySelector(".breadcrumb")?.textContent ?? "";
    assert.match(crumbText, / \/ LEAF$/);
    assert.ok(!main.querySelector('.breadcrumb a[href*="LEAF"]'));

    const plain = document.createElement("main");
    await renderRequirementDetail(plain, {
      apiFn: mockFetch((url) => {
        if (url === "/api/v1/projects/reqalm/requirements/CAP-1") {
          return {
            status: 200,
            body: {
              data: {
                id: "CAP-1",
                title: "T",
                kind: "capability",
                type: "capability",
                status: "active",
                version_n: 0,
                statement: "S",
                attributes: {},
                ancestors: [],
              },
            },
          };
        }
        if (url === relationsPath("reqalm", "CAP-1")) return { status: 200, body: emptyRelationsPayload("CAP-1") };
        return { status: 404 };
      }),
      projectId: "reqalm",
      requirementId: "CAP-1",
      listFilters: { kind: "cap", type: "", status: "", q: "" },
    });
    assert.ok(plain.querySelector('a[href="/app/projects/reqalm/requirements?kind=cap"]'));
    assert.doesNotMatch(plain.textContent ?? "", /Root section/);
  });

  it("leaf treeitems have no expander and no aria-expanded", async () => {
    const { main } = await mountTreeView(
      treeFetchHandler([treeRow("SEC-P", "section", 1, "Parent"), treeRow("LEAF-R", "requirement", 0, "Leaf req")]),
    );
    const leaf = [...main.querySelectorAll('[role="treeitem"]')].find((n) => n.textContent?.includes("LEAF-R"));
    assert.ok(leaf);
    assert.equal(leaf?.querySelector(".req-tree-expander"), null);
    assert.equal(leaf?.hasAttribute("aria-expanded"), false);
  });

  it("ArrowLeft collapses expanded nodes and moves from child to parent", async () => {
    const { main, tree, tick, focusedUid } = await mountTreeView(
      treeFetchHandler([treeRow("SEC-P", "section", 1, "P")], {
        children: { "SEC-P": [treeRow("CHILD-R", "requirement", 0, "C")] },
      }),
    );
    const parent = main.querySelector('[role="treeitem"][aria-level="1"]');
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await tick();
    assert.equal(parent?.getAttribute("aria-expanded"), "true");
    assert.equal(parent?.querySelector('[role="group"]')?.hasAttribute("hidden"), false);
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    assert.equal(parent?.getAttribute("aria-expanded"), "false");
    assert.equal(parent?.querySelector('[role="group"]')?.hidden, true);
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await tick();
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(focusedUid(), "CHILD-R");
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    assert.equal(focusedUid(), "SEC-P");
  });

  it("ArrowUp and End move focus among visible treeitems by uid", async () => {
    const { tree, focusedUid } = await mountTreeView(
      treeFetchHandler([
        treeRow("SEC-A", "section", 0, "A"),
        treeRow("SEC-B", "section", 0, "B"),
        treeRow("SEC-C", "section", 0, "C"),
      ]),
    );
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
    assert.equal(focusedUid(), "SEC-C");
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    assert.equal(focusedUid(), "SEC-B");
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    assert.equal(focusedUid(), "SEC-A");
  });

  it("Enter activates the focused requirement link", async () => {
    const { main, tree } = await mountTreeView(treeFetchHandler([treeRow("REQ-ENTER", "requirement", 0, "Enter me")]));
    const link = main.querySelector('a[href="/app/projects/reqalm/requirements/REQ-ENTER"]');
    assert.ok(link);
    let clicked = false;
    link?.addEventListener("click", (ev) => {
      clicked = true;
      ev.preventDefault();
    });
    main.querySelector('[role="treeitem"]')?.setAttribute("tabindex", "0");
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(clicked, true);
  });

  it("expand failure shows alert, resets aria-expanded, and retry succeeds", async () => {
    let parentCalls = 0;
    const { main, tick } = await mountTreeView(
      treeFetchHandler([treeRow("SEC-X", "section", 1, "X")], {
        parentResponses: {
          "SEC-X": (n) => {
            parentCalls = n;
            if (n === 1) return { status: 500 };
            return {
              status: 200,
              body: { data: { items: [treeRow("OK-CH", "requirement", 0, "Ok")], total: 1 } },
            };
          },
        },
      }),
    );
    const parent = main.querySelector('[role="treeitem"]');
    parent?.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick();
    assert.equal(parent?.getAttribute("aria-expanded"), "false");
    assert.match(main.textContent ?? "", /Could not load children/);
    assert.ok(main.querySelector('[role="alert"]'));
    parent?.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick();
    assert.equal(parent?.getAttribute("aria-expanded"), "true");
    assert.equal(parentCalls, 2);
    assert.ok(main.querySelector('[role="treeitem"][aria-level="2"]'));
    assert.equal(main.querySelector('[role="alert"]'), null);

    const failTwice = await mountTreeView(
      treeFetchHandler([treeRow("SEC-F", "section", 1, "F")], {
        parentResponses: { "SEC-F": () => ({ status: 500 }) },
      }),
    );
    const failParent = failTwice.main.querySelector('[role="treeitem"]');
    failParent?.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await failTwice.tick();
    failParent?.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await failTwice.tick();
    assert.equal(failTwice.main.querySelectorAll('[role="alert"]').length, 1);
  });

  it("expander glyph and aria-label reflect expanded state", async () => {
    const { main, tick } = await mountTreeView(
      treeFetchHandler([treeRow("SEC-G", "section", 1, "G")], { children: { "SEC-G": [] } }),
    );
    const btn = main.querySelector(".req-tree-expander");
    assert.equal(btn?.textContent, "▸");
    assert.equal(btn?.getAttribute("aria-label"), "Expand");
    btn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick();
    assert.equal(btn?.textContent, "▾");
    assert.equal(btn?.getAttribute("aria-label"), "Collapse");
    btn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick(0);
    assert.equal(btn?.textContent, "▸");
    assert.equal(btn?.getAttribute("aria-label"), "Expand");
  });

  it("ArrowRight on expanded node focuses first child; roving tabindex on treeitems only", async () => {
    const { main, tree, tick, focusedUid } = await mountTreeView(
      treeFetchHandler([treeRow("SEC-R", "section", 1, "R")], {
        children: { "SEC-R": [treeRow("FIRST-CH", "requirement", 0, "First")] },
      }),
    );
    assert.equal(tree?.getAttribute("tabindex"), "-1");
    assert.equal(main.querySelectorAll('[role="treeitem"][tabindex="0"]').length, 1);
    for (const btn of main.querySelectorAll(".req-tree-expander")) {
      assert.equal(btn.getAttribute("tabindex"), "-1");
    }
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await tick();
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    assert.equal(focusedUid(), "FIRST-CH");
    assert.equal(main.querySelectorAll('[role="treeitem"][tabindex="0"]').length, 1);
  });

  it("expanded tree is one tab stop; requirement links are not tabbable", async () => {
    const childRows = Array.from({ length: 5 }, (_, i) => treeRow(`REQ-${i}`, "requirement", 0, `Req ${i}`));
    const { main, tree, tick } = await mountTreeView(
      treeFetchHandler([treeRow("SEC-IA", "section", 1, "IA")], { children: { "SEC-IA": childRows } }),
    );
    assert.equal(tree?.getAttribute("tabindex"), "-1");
    main.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick();
    const tabbableInTree = [...main.querySelectorAll('[role="tree"] a[href]')].filter((a) => a.getAttribute("tabindex") !== "-1");
    assert.equal(tabbableInTree.length, 0);
    assert.equal(main.querySelectorAll('[role="tree"] [tabindex="0"]').length, 1);
  });

  it("ArrowDown skips treeitems inside collapsed hidden groups", async () => {
    const { main, tree, tick, focusedUid } = await mountTreeView(
      treeFetchHandler([treeRow("SEC-ONE", "section", 1, "One"), treeRow("SEC-TWO", "section", 0, "Two")], {
        children: { "SEC-ONE": [treeRow("HID-CH", "requirement", 0, "Hidden child")] },
      }),
    );
    const firstRoot = main.querySelector('[role="treeitem"][aria-level="1"]');
    firstRoot?.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick();
    firstRoot?.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick(0);
    assert.equal(focusedUid(), "SEC-ONE");
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(focusedUid(), "SEC-TWO");
  });

  it("mouse collapse moves roving focus from hidden child to ancestor", async () => {
    const { main, tree, tick, focusedUid } = await mountTreeView(
      treeFetchHandler([treeRow("SEC-P", "section", 1, "P")], {
        children: { "SEC-P": [treeRow("CHILD-R", "requirement", 0, "C")] },
      }),
    );
    const parent = main.querySelector('[role="treeitem"][aria-level="1"]');
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await tick();
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(focusedUid(), "CHILD-R");
    parent?.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick(0);
    assert.equal(focusedUid(), "SEC-P");
    assert.equal(main.querySelectorAll('[role="treeitem"][tabindex="0"]').length, 1);
  });

  it("requirements tree API 404 does not throw", async () => {
    const { main } = await mountTreeView(() => ({ status: 404 }));
    assert.match(main.textContent ?? "", /don't have access/i);
  });

  it("requirements tree roots auth failure redirects without not-found", async () => {
    let redirectTo = "";
    setUnauthorizedRedirect((url) => {
      redirectTo = url;
    });
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () => jsonResponse(401, {})) as unknown as typeof fetch;
    try {
      const main = document.createElement("main");
      await renderRequirementsTree(main, { apiFn: api, projectId: "reqalm" });
      assert.equal(redirectTo, "/login");
      assert.doesNotMatch(main.textContent ?? "", /don't have access/i);
      assert.match(main.textContent ?? "", /Requirements tree/);
    } finally {
      globalThis.fetch = prevFetch;
      clearUnauthorizedRedirect();
    }
  });

  it("empty tree roots show exact empty copy", async () => {
    const { main } = await mountTreeView(treeFetchHandler([]));
    assert.equal(main.querySelector(".empty-state")?.textContent, "No requirements in this project tree.");
  });

  it("mountBrowseView renders requirements tree for tree route", async () => {
    const main = document.createElement("main");
    const route = parseAppRoute("/app/projects/reqalm/tree");
    const roots = [treeRow("SEC-ROOT", "section", 0, "Root section")];
    const stub = treeFetchHandler(roots);
    const rootsUrl = requirementsTreeApiPath("reqalm", null);
    await mountBrowseView(main, route, {
      apiFn: mockFetch((url) => {
        assert.equal(url, rootsUrl);
        return stub(url);
      }),
    });
    assert.ok(main.querySelector('[role="tree"]'));
    assert.match(main.textContent ?? "", /SEC-ROOT/);
    assert.match(main.textContent ?? "", /Root section/);
    assert.equal(fetchCalls.filter((u) => u === rootsUrl).length, 1);
  });

  it("releases list paging via mountBrowseView preserves status in API and hrefs", async () => {
    const main = document.createElement("main");
    const route = parseAppRoute("/app/projects/reqalm/releases");
    const apiFn = mockFetch((url) => {
      const u = new URL(url, "http://localhost");
      assert.equal(u.pathname, "/api/v1/projects/reqalm/releases");
      assert.equal(u.searchParams.get("status"), "shipped");
      assert.equal(u.searchParams.get("offset"), "20");
      assert.equal(u.searchParams.get("limit"), "20");
      return {
        status: 200,
        body: {
          data: {
            items: [
              {
                id: "rel-sh",
                name: "Shipped rel",
                status: "shipped",
                planned_on: "2026-01-01",
                shipped_on: "2026-01-02",
                delivered_capability_count: 0,
              },
            ],
            limit: 20,
            offset: 20,
            total: 45,
          },
        },
      };
    });
    await mountBrowseView(main, route, { apiFn, search: "?status=shipped&offset=20" });
    assert.match(main.textContent ?? "", /Showing 21–40 of 45/);
    assert.ok(main.querySelector('a.btn-secondary[href="/app/projects/reqalm/releases?status=shipped&offset=40"]'));
    assert.ok(main.querySelector('a.btn-secondary[href="/app/projects/reqalm/releases?status=shipped"]'));
  });

  it("releases list via mountBrowseView ignores bogus status (release filters, not requirements)", async () => {
    const main = document.createElement("main");
    const route = parseAppRoute("/app/projects/reqalm/releases");
    const apiFn = mockFetch((url) => {
      const u = new URL(url, "http://localhost");
      assert.equal(u.pathname, "/api/v1/projects/reqalm/releases");
      assert.equal(u.searchParams.has("status"), false);
      assert.equal(u.searchParams.get("offset"), "0");
      assert.equal(u.searchParams.get("limit"), "20");
      return {
        status: 200,
        body: {
          data: {
            items: [
              {
                id: "rel-a",
                name: "Release A",
                status: "planned",
                planned_on: "2026-01-01",
                shipped_on: null,
                delivered_capability_count: 0,
              },
            ],
            limit: 20,
            offset: 0,
            total: 45,
          },
        },
      };
    });
    await mountBrowseView(main, route, { apiFn, search: "?status=bogus" });
    assert.ok(main.querySelector('a.btn-secondary[href="/app/projects/reqalm/releases?offset=20"]'));
    for (const a of main.querySelectorAll(".pager-nav a.btn-secondary")) {
      assert.doesNotMatch(a.getAttribute("href") ?? "", /status=/);
    }
  });

  it("releases list table shows exact planned, shipped, and capability cells", async () => {
    const main = document.createElement("main");
    await renderReleasesList(main, {
      apiFn: mockFetch(() => ({
        status: 200,
        body: {
          data: {
            items: [
              {
                id: "rel-row",
                name: "Row rel",
                status: "shipped",
                planned_on: "2026-01-15",
                shipped_on: "2026-02-20",
                delivered_capability_count: 2,
              },
            ],
            limit: 20,
            offset: 0,
            total: 1,
          },
        },
      })),
      projectId: "reqalm",
      filters: { status: "" },
      offset: 0,
    });
    const cells = [...main.querySelectorAll("tbody tr:first-child td")].map((td) => td.textContent);
    assert.deepEqual(cells, ["Row rel", "rel-row", "shipped", "2026-01-15", "2026-02-20", "2"]);
  });

  it("releases list passes status filter to API and paging hrefs", async () => {
    const main = document.createElement("main");
    const filters = { status: "planned" };
    const apiFn = mockFetch((url) => {
      const u = new URL(url, "http://localhost");
      assert.equal(u.pathname, "/api/v1/projects/reqalm/releases");
      assert.equal(u.searchParams.get("status"), "planned");
      assert.equal(u.searchParams.get("limit"), "20");
      return {
        status: 200,
        body: {
          data: {
            items: [
              {
                id: "rel-a",
                name: "Release A",
                status: "planned",
                planned_on: "2026-10-08",
                shipped_on: null,
                delivered_capability_count: 2,
              },
            ],
            limit: 20,
            offset: 0,
            total: 1,
          },
        },
      };
    });
    await renderReleasesList(main, { apiFn, projectId: "reqalm", filters, offset: 0 });
    const form = main.querySelector("form.filter-bar");
    assert.equal(form?.getAttribute("action"), "/app/projects/reqalm/releases");
    assert.equal(main.querySelector('select[name="status"]')?.value, "planned");
    assert.ok(main.querySelector('a[href="/app/projects/reqalm/releases/rel-a"]'));
    assert.match(main.textContent ?? "", /Release A/);
  });

  it("releases list empty, filter miss, and past end", async () => {
    const main = document.createElement("main");
    await renderReleasesList(main, {
      apiFn: mockFetch(() => ({ status: 200, body: { data: { items: [], limit: 20, offset: 0, total: 0 } } })),
      projectId: "reqalm",
      filters: { status: "" },
      offset: 0,
    });
    assert.match(main.textContent ?? "", /No releases in this project/);
    await renderReleasesList(main, {
      apiFn: mockFetch(() => ({ status: 200, body: { data: { items: [], limit: 20, offset: 0, total: 0 } } })),
      projectId: "reqalm",
      filters: { status: "shipped" },
      offset: 0,
    });
    assert.match(main.textContent ?? "", /No releases match your filter/);
    await renderReleasesList(main, {
      apiFn: mockFetch(() => ({ status: 200, body: { data: { items: [], limit: 20, offset: 40, total: 25 } } })),
      projectId: "reqalm",
      filters: { status: "" },
      offset: 40,
    });
    assert.match(main.textContent ?? "", /No more results/i);
    assert.ok(main.querySelector('a[href="/app/projects/reqalm/releases"]'));
  });

  it("release detail notes, capabilities links, and invalid id skips fetch", async () => {
    const xssName = "<img src=x onerror=alert(1)>";
    const notes = "Line one\nLine two";
    const main = document.createElement("main");
    const apiFn = mockFetch((url) => {
      if (url === "/api/v1/projects/reqalm/releases/rel-x") {
        return {
          status: 200,
          body: {
            data: {
              id: "rel-x",
              name: xssName,
              status: "shipped",
              planned_on: "2026-10-01",
              shipped_on: "2026-10-02",
              notes,
              delivered_capabilities: [
                { uid: "CAP-ZEBRA", title: "Z cap", status: "active" },
                { uid: "CAP-ALPHA", title: "A cap", status: "draft" },
                { uid: "CAP-MID", title: "M cap", status: "shipped" },
              ],
            },
          },
        };
      }
      return { status: 404 };
    });
    await renderReleaseDetail(main, {
      apiFn,
      projectId: "reqalm",
      releaseId: "rel-x",
      listFilters: { status: "shipped" },
    });
    assert.ok(!main.querySelector("img"));
    assert.match(main.textContent ?? "", /onerror=alert\(1\)/);
    const notesEl = main.querySelector(".statement-body");
    assert.ok(notesEl);
    assert.equal(notesEl.textContent, notes);
    assert.equal(notesEl.childElementCount, 0);
    assert.equal(notesEl.className, "statement-body");
    const capUids = [...main.querySelectorAll("table.data-table tbody tr td:first-child a")].map((a) => a.textContent);
    assert.deepEqual(capUids, ["CAP-ZEBRA", "CAP-ALPHA", "CAP-MID"]);
    assert.ok(main.querySelector('a[href="/app/projects/reqalm/requirements/CAP-ZEBRA"]'));
    assert.ok(main.querySelector('a[href="/app/projects/reqalm/requirements/CAP-ALPHA"]'));
    assert.ok(main.querySelector('a[href="/app/projects/reqalm/requirements/CAP-MID"]'));
    assert.ok(main.querySelector('a[href="/app/projects/reqalm/releases?status=shipped"]'));
    const badMain = document.createElement("main");
    fetchCalls.length = 0;
    await renderReleaseDetail(badMain, { apiFn: mockFetch(() => { throw new Error("no"); }), projectId: "reqalm", releaseId: "BAD!" });
    assert.equal(fetchCalls.length, 0);
  });

  it("release detail API 404 renders not-found without throwing", async () => {
    const main = document.createElement("main");
    await renderReleaseDetail(main, {
      apiFn: mockFetch(() => ({ status: 404 })),
      projectId: "reqalm",
      releaseId: "rel-missing",
    });
    assert.match(main.textContent ?? "", /don't have access/i);
  });

  it("release detail invalid project slug skips fetch", async () => {
    const main = document.createElement("main");
    fetchCalls.length = 0;
    await renderReleaseDetail(main, {
      apiFn: mockFetch(() => {
        throw new Error("should not fetch");
      }),
      projectId: "INVALID!",
      releaseId: "rel-a",
    });
    assert.equal(fetchCalls.length, 0);
    assert.match(main.textContent ?? "", /don't have access/i);
  });

  it("release detail via mountBrowseView keeps filter breadcrumb and empty capabilities", async () => {
    const main = document.createElement("main");
    const route = parseAppRoute("/app/projects/reqalm/releases/rel-empty");
    await mountBrowseView(main, route, {
      apiFn: mockFetch((url) => {
        if (url === "/api/v1/projects/reqalm/releases/rel-empty") {
          return {
            status: 200,
            body: {
              data: {
                id: "rel-empty",
                name: "Empty caps",
                status: "planned",
                planned_on: "2026-03-01",
                shipped_on: null,
                notes: null,
                delivered_capabilities: [],
              },
            },
          };
        }
        return { status: 404 };
      }),
      search: "?status=planned",
    });
    assert.ok(main.querySelector('a[href="/app/projects/reqalm/releases?status=planned"]'));
    assert.match(main.textContent ?? "", /No capabilities delivered in this release/);
    assert.match(main.textContent ?? "", / · planned · /);
    assert.ok(![...main.querySelectorAll("h2")].some((h) => h.textContent === "Notes"));
  });

  it("escapes XSS in client names as plain text", async () => {
    const xss = "<img src=x onerror=alert(1)>";
    const main = document.createElement("main");
    await renderClientsList(main, {
      apiFn: mockFetch(() => ({
        status: 200,
        body: { data: { items: [{ id: "xss", name: xss, created_at: null, notes: null }], limit: 20, offset: 0, total: 1 } },
      })),
    });
    assert.ok(!main.querySelector("img"));
    assert.match(main.textContent ?? "", /onerror=alert\(1\)/);
    assert.doesNotMatch(main.innerHTML, /<img[^>]*onerror/i);
  });

  it("browse renders never fetch SPA document paths", async () => {
    const main = document.createElement("main");
    await renderRequirementsList(main, {
      apiFn: mockFetch((url) => {
        assert.ok(url.startsWith("/api/v1/"), url);
        return { status: 200, body: { data: { items: [], limit: 20, offset: 0, total: 0 } } };
      }),
      projectId: "reqalm",
      filters: {},
      offset: 0,
    });
    assert.ok(fetchCalls.every((u) => u.startsWith("/api/v1/")));
  });

  it("malformed route encoding shows not-found without fetch", async () => {
    assert.equal(decodeRouteSegment("%E0%A4%A"), null);
    const main = document.createElement("main");
    await mountBrowseView(main, parseAppRoute("/app/projects/%E0%A4%A/requirements"), {
      apiFn: mockFetch(() => { throw new Error("no"); }),
    });
    assert.match(main.textContent ?? "", /don't have access/i);
    assert.equal(fetchCalls.length, 0);
  });
});

const shellMeta = {
  identityId: "dan-raby",
  agentName: "Dan Raby",
  client: { id: "danrabydev", name: "Dan Raby Dev" },
  project: { id: "reqalm", name: "ReqALM Product", client_id: "danrabydev" },
};

describe("app shell", () => {
  beforeEach(() => installDom("http://localhost/app/projects/reqalm/requirements"));
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  });

  it("highlights Requirements tab on list and tree routes", () => {
    for (const path of ["/app/projects/reqalm/requirements", "/app/projects/reqalm/tree"]) {
      installDom(`http://localhost${path}`);
      const route = parseAppRoute(path);
      renderAppShell(path, route, shellMeta);
      const active = document.querySelector("#project-nav .project-tab-active");
      assert.equal(active?.textContent, "Requirements", path);
      assert.equal(document.querySelector("#top-nav"), null);
    }
  });

  it("highlights Releases tab on release routes", () => {
    const path = "/app/projects/reqalm/releases/rel-a";
    renderAppShell(path, parseAppRoute(path), shellMeta);
    assert.ok(document.querySelector('#project-nav a.project-tab-active[href="/app/projects/reqalm/releases"]'));
  });

  it("shows minimal nav without project tabs on clients list", () => {
    installDom("http://localhost/app/clients");
    renderAppShell("/app/clients", parseAppRoute("/app/clients"), { identityId: "dan-raby", agentName: null });
    assert.equal(document.querySelector("#project-nav"), null);
    assert.ok(document.querySelector('#top-nav a.nav-active[href="/app/clients"]'));
    const disabled = [...document.querySelectorAll("#project-nav .project-tab-disabled")];
    assert.equal(disabled.length, 0);
  });

  it("renders breadcrumb links for client and project in project context", () => {
    renderAppShell("/app/projects/reqalm/requirements", parseAppRoute("/app/projects/reqalm/requirements"), shellMeta);
    const crumb = document.querySelector(".header-breadcrumb");
    assert.match(crumb?.textContent ?? "", /Dan Raby Dev/);
    assert.match(crumb?.textContent ?? "", /ReqALM Product/);
    assert.match(crumb?.textContent ?? "", /Requirements/);
    assert.equal(document.querySelector('.header-breadcrumb a[href="/app/clients/danrabydev"]')?.textContent, "Dan Raby Dev");
    assert.equal(document.querySelector('.header-breadcrumb a[href="/app/projects/reqalm"]')?.textContent, "ReqALM Product");
    assert.ok(document.querySelector('.header-breadcrumb [aria-current="page"]'));
  });

  it("renders coming-soon project tabs as non-links", () => {
    renderAppShell("/app/projects/reqalm/requirements", parseAppRoute("/app/projects/reqalm/requirements"), shellMeta);
    for (const label of ["Traceability", "Capabilities", "Contracts", "Audit"]) {
      const tab = [...document.querySelectorAll("#project-nav .project-tab-disabled")].find((n) => n.textContent === label);
      assert.ok(tab, label);
      assert.equal(tab?.getAttribute("aria-disabled"), "true");
      assert.equal(tab?.getAttribute("title"), "Coming soon");
      assert.equal(tab?.tagName, "SPAN");
    }
    assert.equal(PROJECT_TABS.filter((t) => !t.enabled).length, 4);
  });

  it("escapes HTML in client and project names in the breadcrumb", () => {
    const evil = "<img src=x onerror=alert(1)>";
    renderAppShell("/app/projects/reqalm/requirements", parseAppRoute("/app/projects/reqalm/requirements"), {
      ...shellMeta,
      client: { id: "danrabydev", name: evil },
      project: { id: "reqalm", name: evil, client_id: "danrabydev" },
    });
    assert.equal(document.querySelector(".header-breadcrumb img"), null);
    assert.ok(document.querySelector(".header-breadcrumb")?.textContent?.includes("<img"));
  });

  it("breadcrumbSegments builds client/project/page trail", () => {
    const route = parseAppRoute("/app/projects/reqalm/releases");
    const segs = breadcrumbSegments(route, shellMeta);
    assert.deepEqual(
      segs.map((s) => s.label),
      ["Dan Raby Dev", "ReqALM Product", "Releases"],
    );
    assert.ok(segs[0]?.href?.includes("danrabydev"));
    assert.ok(segs[1]?.href?.includes("reqalm"));
    assert.equal(segs[2]?.current, true);
  });

  it("projectTabItems marks only the matching enabled tab active", () => {
    const tabs = projectTabItems("reqalm", "/app/projects/reqalm/tree");
    assert.equal(tabs.filter((t) => t.active).length, 1);
    assert.equal(tabs.find((t) => t.active)?.id, "requirements");
  });

  it("shows user initials avatar and sign out", () => {
    renderAppShell("/app/clients", parseAppRoute("/app/clients"), shellMeta);
    assert.equal(document.querySelector(".user-avatar")?.textContent, "DR");
    assert.ok(document.getElementById("signout"));
  });

  it("requirement detail relationships panel renders under project header tabs", async () => {
    const path = "/app/projects/reqalm/requirements/CAP-1";
    installDom(`http://localhost${path}`);
    const route = parseAppRoute(path);
    const content = renderAppShell(path, route, shellMeta);
    await mountBrowseView(content, route, {
      apiFn: mockFetch((url) => {
        if (url === "/api/v1/projects/reqalm/requirements/CAP-1") {
          return {
            status: 200,
            body: {
              data: {
                id: "CAP-1",
                title: "Cap one",
                kind: "capability",
                type: "capability",
                status: "active",
                version_n: 0,
                statement: "S",
                attributes: {},
              },
            },
          };
        }
        if (url === relationsPath("reqalm", "CAP-1")) {
          return {
            status: 200,
            body: {
              data: { id: "CAP-1", project_id: "reqalm", outgoing: {}, incoming: {} },
            },
          };
        }
        return { status: 404 };
      }),
    });
    assert.ok(document.querySelector('#project-nav a.project-tab-active[aria-current="page"]'));
    assert.ok(content.querySelector(".relations-panel"));
    assert.ok(content.querySelector("#relations-heading"));
  });

  it("root redirect targets clients or login", () => {
    assert.equal(rootRedirectPath(true), "/app/clients");
    assert.equal(rootRedirectPath(false), "/login");
  });

  it("sign-out posts and redirects", async () => {
    let posted = "";
    let to = "";
    await signOut(
      async (path, opts) => {
        posted = `${opts.method} ${path}`;
        return jsonResponse(204, {}) as Response;
      },
      (url) => {
        to = url;
      },
    );
    assert.equal(posted, "POST /api/v1/auth/signout");
    assert.equal(to, "/login");
  });
});

describe("api() auth redirect", () => {
  let redirectTo: string;

  beforeEach(() => {
    installDom();
    redirectTo = "";
    setUnauthorizedRedirect((url) => {
      redirectTo = url;
    });
    globalThis.fetch = (async () => jsonResponse(401, {})) as unknown as typeof fetch;
  });

  afterEach(() => {
    clearUnauthorizedRedirect();
    Reflect.deleteProperty(globalThis, "fetch");
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  });

  it("redirects to login on 401", async () => {
    assert.equal(await api("/api/v1/clients"), null);
    assert.equal(redirectTo, "/login");
  });
});
