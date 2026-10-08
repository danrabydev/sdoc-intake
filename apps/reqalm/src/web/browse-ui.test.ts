// @ts-nocheck
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import {
  APP_NAV,
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
  navItemsForRoute,
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
    assert.deepEqual(APP_NAV.map((n) => n.label), ["Clients", "Projects"]);
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
    assert.equal(fetchCalls.filter((u) => u.includes("requirements")).length, 1);

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
    const main = document.createElement("main");
    let childFetches = 0;
    const apiFn = mockFetch((url) => {
      if (url === "/api/v1/projects/reqalm/requirements/tree?limit=100&offset=0") {
        return {
          status: 200,
          body: {
            data: {
              items: [{ uid: "SEC-A", title: "Section A", kind: "section", type: "section", status: "active", child_count: 1 }],
              limit: 100,
              offset: 0,
              total: 1,
            },
          },
        };
      }
      if (url === "/api/v1/projects/reqalm/requirements/tree?limit=100&offset=0&parent=SEC-A") {
        childFetches += 1;
        return {
          status: 200,
          body: {
            data: {
              items: [{ uid: "CAP-1", title: "Cap one", kind: "capability", type: "capability", status: "draft", child_count: 0 }],
              limit: 100,
              offset: 0,
              total: 1,
            },
          },
        };
      }
      return { status: 404 };
    });
    await renderRequirementsTree(main, { apiFn, projectId: "reqalm" });
    assert.equal(fetchCalls.filter((u) => u.includes("/requirements/tree")).length, 1);
    const root = main.querySelector('[role="treeitem"][aria-level="1"]');
    assert.ok(root);
    assert.equal(root?.getAttribute("aria-expanded"), "false");
    assert.match(root?.textContent ?? "", /section/);
    assert.match(root?.textContent ?? "", /SEC-A/);
    root?.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(childFetches, 1);
    assert.equal(fetchCalls.filter((u) => u.includes("parent=SEC-A")).length, 1);
    const child = main.querySelector('[role="treeitem"][aria-level="2"]');
    assert.ok(child);
    assert.match(child?.textContent ?? "", /capability/);
    assert.ok(main.querySelector('a[href="/app/projects/reqalm/requirements/CAP-1"]'));
    root?.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    root?.querySelector(".req-tree-expander")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(childFetches, 1);
  });

  it("tree keyboard navigation moves focus and expands with ArrowRight", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch((url) => {
      if (url.endsWith("tree?limit=100&offset=0")) {
        return {
          status: 200,
          body: {
            data: {
              items: [{ uid: "SEC-1", title: "S1", kind: "section", type: "section", status: "active", child_count: 1 }],
              total: 1,
            },
          },
        };
      }
      if (url.includes("parent=SEC-1")) {
        return {
          status: 200,
          body: { data: { items: [{ uid: "R-1", title: "Req", kind: "requirement", type: "req", status: "active", child_count: 0 }], total: 1 } },
        };
      }
      return { status: 404 };
    });
    await renderRequirementsTree(main, { apiFn, projectId: "reqalm" });
    const tree = main.querySelector('[role="tree"]');
    const items = () => [...main.querySelectorAll('[role="treeitem"]')];
    const focused = () => main.querySelector('[role="treeitem"][tabindex="0"]');
    assert.equal(focused()?.querySelector(".req-tree-uid")?.textContent, "SEC-1");
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(items()[0]?.getAttribute("aria-expanded"), "true");
    assert.equal(items().length, 2);
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(focused()?.querySelector(".req-tree-uid")?.textContent, "R-1");
    assert.equal(focused()?.getAttribute("aria-level"), "2");
    tree?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    assert.equal(focused()?.querySelector(".req-tree-uid")?.textContent, "SEC-1");
  });

  it("requirement detail breadcrumbs use ancestor order and section vs requirement links", async () => {
    const main = document.createElement("main");
    await renderRequirementDetail(main, {
      apiFn: mockFetch(() => ({
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
      })),
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
      apiFn: mockFetch(() => ({
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
      })),
      projectId: "reqalm",
      requirementId: "CAP-1",
      listFilters: { kind: "cap", type: "", status: "", q: "" },
    });
    assert.ok(plain.querySelector('a[href="/app/projects/reqalm/requirements?kind=cap"]'));
    assert.doesNotMatch(plain.textContent ?? "", /Root section/);
  });

  it("requirements tree API 404 does not throw", async () => {
    const main = document.createElement("main");
    await renderRequirementsTree(main, { apiFn: mockFetch(() => ({ status: 404 })), projectId: "reqalm" });
    assert.match(main.textContent ?? "", /don't have access/i);
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

describe("app shell", () => {
  beforeEach(() => installDom("http://localhost/app/projects/reqalm/requirements"));
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  });

  it("shows Clients, Projects, and project Requirements nav", () => {
    const route = parseAppRoute("/app/projects/reqalm/requirements");
    renderAppShell("/app/projects/reqalm/requirements", route);
    const texts = [...document.querySelectorAll("#top-nav a")].map((a) => a.textContent);
    assert.deepEqual(texts, ["Clients", "Projects", "Requirements", "Tree", "Releases"]);
    assert.ok(document.querySelector('#top-nav a.nav-active[href="/app/projects/reqalm/requirements"]'));
  });

  it("shows Tree nav active on tree route", () => {
    const route = parseAppRoute("/app/projects/reqalm/tree");
    renderAppShell("/app/projects/reqalm/tree", route);
    assert.ok(document.querySelector('#top-nav a.nav-active[href="/app/projects/reqalm/tree"]'));
  });

  it("shows Releases nav active on releases routes", () => {
    const route = parseAppRoute("/app/projects/reqalm/releases/rel-a");
    renderAppShell("/app/projects/reqalm/releases/rel-a", route);
    assert.ok(document.querySelector('#top-nav a.nav-active[href="/app/projects/reqalm/releases"]'));
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
