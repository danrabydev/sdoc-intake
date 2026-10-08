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
  requirementsListHref,
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
    const yes = ["/", "/login", "/login/x", "/app", "/app/projects/p/requirements", "/app/projects/p/requirements/R/versions"];
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

  it("requirements paging preserves filters in hrefs", async () => {
    const main = document.createElement("main");
    const filters = { kind: "cap", type: "", status: "", q: "x" };
    const apiFn = mockFetch(() => ({
      status: 200,
      body: { data: { items: [{ id: "R1", title: "T", kind: "k", type: "t", status: "draft", version_n: 0, version_id: "R1" }], limit: 20, offset: 20, total: 45 } },
    }));
    await renderRequirementsList(main, { apiFn, projectId: "reqalm", filters, offset: 20 });
    assert.match(main.textContent ?? "", /Showing 21–40 of 45/);
    assert.ok(main.querySelector('a.btn-secondary[href="/app/projects/reqalm/requirements?kind=cap&q=x&offset=40"]'));
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
    assert.match(main.textContent ?? "", /Browse requirements/);
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
    assert.deepEqual(texts, ["Clients", "Projects", "Requirements"]);
    assert.ok(document.querySelector('#top-nav a.nav-active[href="/app/projects/reqalm/requirements"]'));
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
