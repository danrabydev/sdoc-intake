// @ts-nocheck
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import {
  APP_NAV,
  isValidSlugId,
  parseAppRoute,
  readPageOffset,
  renderClientsList,
  renderClientDetail,
  renderProjectsList,
  renderProjectDetail,
  renderNotFound,
  pageHref,
} from "./public/browse.js";
import { api } from "./public/api-client.js";

type FetchHandler = (url: string) => { status: number; body?: unknown };

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/app/clients" });
  const { window } = dom;
  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.document = window.document;
  return dom;
}

describe("browse route parsing", () => {
  it("parses clients, client detail, projects, and project detail", () => {
    assert.deepEqual(parseAppRoute("/app/clients"), { view: "clients-list", offset: 0 });
    assert.deepEqual(parseAppRoute("/app/clients/acme"), {
      view: "client-detail",
      clientId: "acme",
      offset: 0,
    });
    assert.deepEqual(parseAppRoute("/app/projects"), { view: "projects-list", offset: 0 });
    assert.deepEqual(parseAppRoute("/app/projects/reqalm"), { view: "project-detail", projectId: "reqalm" });
    assert.equal(parseAppRoute("/app/nope").view, "unknown");
  });

  it("includes Clients and Projects in app navigation", () => {
    const labels = APP_NAV.map((n) => n.label);
    assert.ok(labels.includes("Clients"));
    assert.ok(labels.includes("Projects"));
  });

  it("validates slug ids like the API", () => {
    assert.ok(isValidSlugId("reqalm-client"));
    assert.ok(!isValidSlugId("ZZQMARK"));
    assert.ok(!isValidSlugId("<script>"));
  });

  it("reads paging offset from query string", () => {
    assert.equal(readPageOffset(""), 0);
    assert.equal(readPageOffset("?offset=20"), 20);
    assert.equal(readPageOffset("?offset=-1"), 0);
    assert.equal(pageHref("/app/clients", 20, 20), "/app/clients?offset=20");
  });
});

describe("browse UI render (jsdom)", () => {
  let dom: JSDOM;
  let fetchCalls: string[];

  beforeEach(() => {
    dom = installDom();
    fetchCalls = [];
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  });

  function mockFetch(handler: FetchHandler): typeof fetch {
    const fn = async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      const { status, body } = handler(url);
      return jsonResponse(status, body) as Response;
    };
    return fn as unknown as typeof fetch;
  }

  it("renders clients list with paging", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch((url) => {
      if (url.startsWith("/api/v1/clients?")) {
        return {
          status: 200,
          body: {
            data: {
              items: [{ id: "acme", name: "Acme Clinic", created_at: null, notes: null }],
              limit: 20,
              offset: 0,
              total: 25,
            },
          },
        };
      }
      return { status: 404 };
    });
    await renderClientsList(main, { apiFn, offset: 0, limit: 20 });
    assert.match(main.textContent ?? "", /Acme Clinic/);
    assert.ok(main.querySelector('a[href="/app/clients/acme"]'));
    assert.match(main.innerHTML, /Next/);
    assert.match(main.innerHTML, /Showing 1–20 of 25/);
  });

  it("shows clients empty state", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch(() => ({
      status: 200,
      body: { data: { items: [], limit: 20, offset: 0, total: 0 } },
    }));
    await renderClientsList(main, { apiFn });
    assert.match(main.textContent ?? "", /no clients you can see/i);
  });

  it("renders client detail with projects", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch((url) => {
      if (url === "/api/v1/clients/reqalm-client") {
        return {
          status: 200,
          body: { data: { id: "reqalm-client", name: "ReqALM Client", notes: "Demo", created_at: "2026-01-01" } },
        };
      }
      if (url.startsWith("/api/v1/clients/reqalm-client/projects")) {
        return {
          status: 200,
          body: {
            data: {
              items: [{ id: "reqalm", client_id: "reqalm-client", name: "ReqALM", status: "active" }],
              limit: 20,
              offset: 0,
              total: 1,
            },
          },
        };
      }
      return { status: 404 };
    });
    await renderClientDetail(main, { apiFn, clientId: "reqalm-client" });
    assert.match(main.textContent ?? "", /ReqALM Client/);
    assert.match(main.textContent ?? "", /Demo/);
    assert.match(main.textContent ?? "", /ReqALM/);
  });

  it("shows not found for invalid client slug without calling API", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch(() => {
      throw new Error("should not fetch");
    });
    await renderClientDetail(main, { apiFn, clientId: "INVALID!" });
    assert.match(main.textContent ?? "", /don't have access/i);
    assert.equal(fetchCalls.length, 0);
  });

  it("shows not found on API 404", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch(() => ({ status: 404 }));
    await renderClientDetail(main, { apiFn, clientId: "missing-client" });
    assert.match(main.textContent ?? "", /don't have access/i);
  });

  it("renders projects list with client names", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch((url) => {
      if (url.startsWith("/api/v1/clients?")) {
        return {
          status: 200,
          body: { data: { items: [{ id: "c1", name: "Client One" }], limit: 100, offset: 0, total: 1 } },
        };
      }
      if (url.startsWith("/api/v1/projects?")) {
        return {
          status: 200,
          body: {
            data: {
              items: [{ id: "p1", client_id: "c1", name: "Project One", status: null }],
              limit: 20,
              offset: 0,
              total: 1,
            },
          },
        };
      }
      return { status: 404 };
    });
    await renderProjectsList(main, { apiFn });
    assert.match(main.textContent ?? "", /Project One/);
    assert.match(main.textContent ?? "", /Client One/);
  });

  it("renders project detail stub", async () => {
    const main = document.createElement("main");
    const apiFn = mockFetch((url) => {
      if (url === "/api/v1/projects/p1") {
        return { status: 200, body: { data: { id: "p1", client_id: "c1", name: "P One" } } };
      }
      if (url === "/api/v1/clients/c1") {
        return { status: 200, body: { data: { id: "c1", name: "Client One" } } };
      }
      return { status: 404 };
    });
    await renderProjectDetail(main, { apiFn, projectId: "p1" });
    assert.match(main.textContent ?? "", /Requirements/);
    assert.match(main.textContent ?? "", /Coming next/);
  });

  it("escapes XSS in client names as plain text", async () => {
    const xss = '<img src=x onerror=alert(1)>';
    const main = document.createElement("main");
    const apiFn = mockFetch(() => ({
      status: 200,
      body: {
        data: {
          items: [{ id: "xss", name: xss, created_at: null, notes: null }],
          limit: 20,
          offset: 0,
          total: 1,
        },
      },
    }));
    await renderClientsList(main, { apiFn });
    assert.ok(!main.querySelector("img"));
    assert.match(main.textContent ?? "", /onerror=alert\(1\)/);
    assert.doesNotMatch(main.innerHTML, /<img[^>]*onerror/i);
  });

  it("renderNotFound shows safe message", () => {
    const main = document.createElement("main");
    renderNotFound(main);
    assert.match(main.textContent ?? "", /don't have access/i);
  });
});

describe("api() auth redirect", () => {
  let dom: JSDOM;
  let redirectTo: string;

  beforeEach(() => {
    dom = installDom();
    redirectTo = "";
    globalThis.__REQALM_TEST_LOGIN_REDIRECT__ = (url: string) => {
      redirectTo = url;
    };
    const mockFetch401 = (async (_input: RequestInfo | URL) =>
      jsonResponse(401, {}) as Response) as unknown as typeof fetch;
    (dom.window as unknown as { fetch: typeof fetch }).fetch = mockFetch401;
    globalThis.fetch = mockFetch401;
  });

  afterEach(() => {
    delete globalThis.__REQALM_TEST_LOGIN_REDIRECT__;
    Reflect.deleteProperty(globalThis, "fetch");
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  });

  it("redirects to login on 401", async () => {
    const res = await api("/api/v1/clients");
    assert.equal(res, null);
    assert.equal(redirectTo, "/login");
  });
});
