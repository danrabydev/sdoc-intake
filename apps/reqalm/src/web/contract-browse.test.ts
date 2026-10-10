// @ts-nocheck — contract browse modules are plain JS (same as browse-ui.test.ts).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeEach, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import {
  contractsListHref,
  contractDetailHref,
  contractsApiPath,
  contractApiPath,
  contractScopeApiPath,
  contractReleasesApiPath,
  fetchAllScope,
  MAX_SCOPE_FETCH_PAGES,
  isValidContractId,
  renderContractsList,
  renderContractDetail,
} from "./public/browse-contracts.js";
import { parseAppRoute, mountBrowseView } from "./public/browse.js";
import { renderAppShell } from "./public/app.js";
import { breadcrumbSegments } from "./public/shell-nav.js";
import {
  CTR_PRODUCT,
  CTR_MAINT,
  PID,
  SCOPE_LIM,
  ctrProductDetail,
  ctrListOk,
  ctrListEmpty,
  scopeEmptyOk,
  relEmptyOk,
  contractsPage,
  ctrSummary,
  scopePagingMock,
  scopeBase,
  type FetchHandler,
} from "./contract-browse.test-support.js";

const shellMeta = {
  identityId: "dan-raby",
  agentName: "Dan Raby",
  client: { id: "danrabydev", name: "Dan Raby Dev" },
  project: { id: "reqalm", name: "ReqALM Product", client_id: "danrabydev" },
};

const contractsSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "public/browse-contracts.js"),
  "utf8",
);

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function mockFetchBare(handler: FetchHandler) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const hit = handler(url);
    const status = hit?.status ?? 404;
    return jsonResponse(status, hit?.body) as Response;
  }) as unknown as typeof fetch;
}

function installDom(url = `http://localhost/app/projects/${PID}/contracts`) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  return dom;
}

function mainEl() {
  return document.createElement("main");
}

const ctrFetch = (extra: FetchHandler) =>
  mockFetchBare((url) => (url === contractsApiPath(PID, 20, 0) ? ctrListOk : extra(url) ?? { status: 404 }));

const detailFetch = (contractBody: unknown, scope: FetchHandler, releases: FetchHandler = () => relEmptyOk) =>
  mockFetchBare((url) => {
    if (url === contractApiPath(PID, CTR_PRODUCT)) return { status: 200, body: { data: contractBody } };
    return scope(url) ?? releases(url) ?? { status: 404 };
  });

const ctrDetailApiFetch = (overrides: {
  contract?: { status: number; body?: unknown };
  scope?: { status: number; body?: unknown };
  releases?: { status: number; body?: unknown };
} = {}) => {
  const contractOk = { status: 200, body: { data: ctrProductDetail } };
  return mockFetchBare((url) => {
    if (url === contractApiPath(PID, CTR_PRODUCT)) return overrides.contract ?? contractOk;
    if (url === contractScopeApiPath(PID, CTR_PRODUCT, SCOPE_LIM, 0)) return overrides.scope ?? scopeEmptyOk;
    if (url === contractReleasesApiPath(PID, CTR_PRODUCT)) return overrides.releases ?? relEmptyOk;
    return { status: 404 };
  });
};

describe("contract browse screens", () => {
    beforeEach(() => installDom(`http://localhost/app/projects/${PID}/contracts`));
    afterEach(() => {
      Reflect.deleteProperty(globalThis, "window");
      Reflect.deleteProperty(globalThis, "document");
    });

    it("source guards and href helpers", () => {
      assert.doesNotMatch(contractsSrc, /\.innerHTML\s*=/);
      assert.match(contractsSrc, /encodeURIComponent/);
      assert.match(contractsSrc, /isValidContractId/);
      assert.match(contractsSrc, /items\.length\s*<\s*total/);
      assert.equal(contractsListHref(PID), `/app/projects/${PID}/contracts`);
      assert.equal(contractsListHref("INVALID!"), null);
      assert.equal(contractDetailHref(PID, CTR_PRODUCT), `/app/projects/${PID}/contracts/${CTR_PRODUCT}`);
      assert.equal(contractDetailHref(PID, "Bad_ID"), null);
      assert.equal(contractsApiPath(PID, 20, 0), `/api/v1/projects/${PID}/contracts?limit=20&offset=0`);
      assert.equal(contractsApiPath("bad!", 20, 0), null);
      assert.ok(isValidContractId(CTR_PRODUCT) && !isValidContractId("Bad_ID"));
    });

    it("list empty, invalid ids, summary, list 404", async () => {
      const ok = mainEl();
      await renderContractsList(ok, { apiFn: ctrFetch(() => undefined), projectId: PID });
      assert.match(ok.textContent ?? "", /Product/);
      assert.ok(ok.querySelector(`a[href="${contractDetailHref(PID, CTR_PRODUCT)}"]`));
      const empty = mainEl();
      await renderContractsList(empty, {
        apiFn: mockFetchBare((u) => (u === contractsApiPath(PID, 20, 0) ? ctrListEmpty : { status: 404 })),
        projectId: PID,
      });
      assert.ok(empty.querySelector(".empty-state"));
      let fetched = false;
      const badP = mainEl();
      await renderContractsList(badP, { apiFn: async () => { fetched = true; return null; }, projectId: "BAD!" });
      assert.equal(fetched, false);
      assert.equal(badP.querySelector("h1")?.textContent, "Not found");
      const badRow = mainEl();
      await renderContractsList(badRow, {
        apiFn: mockFetchBare((u) =>
          u === contractsApiPath(PID, 20, 0)
            ? { status: 200, body: { data: { items: [{ id: "INVALID!", title: "H", scope_count: 1, release_count: 0 }], total: 1, limit: 20, offset: 0 } } }
            : { status: 404 },
        ),
        projectId: PID,
      });
      assert.equal(badRow.querySelector("tbody a"), null);
      const sum = mainEl();
      const pageItems = Array.from({ length: 20 }, (_, i) => ctrSummary(`ctr-list-${i}`, `C-${i}`, 1, 0));
      await renderContractsList(sum, {
        apiFn: mockFetchBare((u) =>
          u === contractsApiPath(PID, 20, 0)
            ? contractsPage(0, pageItems, 45)
            : u === contractsApiPath(PID, 20, 20)
              ? contractsPage(20, pageItems, 45)
              : { status: 404 },
        ),
        projectId: PID,
        offset: 0,
      });
      assert.equal(sum.querySelectorAll("table.data-table tbody tr").length, 20);
      assert.equal(sum.querySelector(".contracts-list-summary")?.textContent, "Showing 20 of 45");
      const sum2 = mainEl();
      await renderContractsList(sum2, {
        apiFn: mockFetchBare((u) => (u === contractsApiPath(PID, 20, 20) ? contractsPage(20, pageItems, 45) : { status: 404 })),
        projectId: PID,
        offset: 20,
      });
      assert.equal(sum2.querySelector(".contracts-list-summary")?.textContent, "Showing 21–40 of 45");
      const nf = mainEl();
      await renderContractsList(nf, {
        apiFn: mockFetchBare((u) => (u === contractsApiPath(PID, 20, 0) ? { status: 404, body: {} } : { status: 404 })),
        projectId: PID,
      });
      assert.equal(nf.querySelector("h1")?.textContent, "Not found");
      assert.equal(nf.querySelector(".empty-state"), null);
    });

    it("maintenance detail, XSS releases, invalid contract id", async () => {
      const maint = {
        id: CTR_MAINT,
        title: "Maintenance",
        kind: "contract",
        status: "active",
        starts_on: "2026-01-01",
        ends_on: null,
        notes: "Maint notes",
        scope_count: 4,
        release_count: 0,
        project_id: PID,
        client_id: "reqalm-client",
      };
      const m1 = mainEl();
      await renderContractDetail(m1, {
        apiFn: ctrFetch((u) => {
          if (u === contractApiPath(PID, CTR_MAINT)) return { status: 200, body: { data: maint } };
          if (u === contractScopeApiPath(PID, CTR_MAINT, SCOPE_LIM, 0)) {
            return { status: 200, body: { data: { items: [{ uid: "CAP-UPKEEP-1", base: "CAP-UPKEEP-1", kind: "capability", status: "draft", version: 0 }], total: 1, limit: SCOPE_LIM, offset: 0 } } };
          }
          if (u === contractReleasesApiPath(PID, CTR_MAINT)) return relEmptyOk;
          return undefined;
        }),
        projectId: PID,
        contractId: CTR_MAINT,
      });
      assert.match(m1.textContent ?? "", /Maint notes/);
      assert.ok(m1.querySelector('a[href="/app/projects/reqalm/requirements/CAP-UPKEEP-1"]'));
      assert.ok(m1.querySelector(".empty-state"));
      const xss = '<img onerror=alert(1)>';
      const m2 = mainEl();
      await renderContractDetail(m2, {
        apiFn: ctrFetch((u) => {
          if (u === contractApiPath(PID, CTR_PRODUCT)) return { status: 200, body: { data: { ...ctrProductDetail, title: xss } } };
          if (u === contractScopeApiPath(PID, CTR_PRODUCT, SCOPE_LIM, 0)) return scopeEmptyOk;
          if (u === contractReleasesApiPath(PID, CTR_PRODUCT)) {
            return { status: 200, body: { data: { items: [{ id: "rel-r1-read-contracts", name: xss, status: "shipped", planned_on: null, shipped_on: "2026-10-10" }] } } };
          }
          return undefined;
        }),
        projectId: PID,
        contractId: CTR_PRODUCT,
      });
      assert.equal(m2.querySelector("img"), null);
      assert.ok(m2.querySelector('a[href="/app/projects/reqalm/releases/rel-r1-read-contracts"]'));
      assert.doesNotMatch(m2.innerHTML, /<img[^>]*onerror/i);
      let fetched = false;
      const m3 = mainEl();
      await renderContractDetail(m3, { apiFn: async () => { fetched = true; return null; }, projectId: PID, contractId: "Bad_ID" });
      assert.equal(fetched, false);
      assert.equal(m3.querySelector("h1")?.textContent, "Not found");
    });

    for (const [label, apiFn, expect] of [
      ["contract API 404", () => ctrDetailApiFetch({ contract: { status: 404, body: {} } }), (m: HTMLElement) => {
        assert.equal(m.querySelector("h1")?.textContent, "Not found");
        assert.doesNotMatch(m.textContent ?? "", /Covered releases/);
      }],
      ["scope API 404", () => ctrDetailApiFetch({ scope: { status: 404, body: {} } }), (m: HTMLElement) => {
        assert.equal(m.querySelector("h1")?.textContent, "Not found");
        assert.equal(m.querySelector("h2"), null);
      }],
      ["releases API 404", () => ctrDetailApiFetch({ releases: { status: 404, body: {} } }), (m: HTMLElement) => {
        assert.equal(m.querySelector("h1")?.textContent, "Not found");
        assert.equal(m.querySelector("h2"), null);
      }],
    ] as const) {
      it(`detail not-found when ${label}`, async () => {
        const m = mainEl();
        await renderContractDetail(m, { apiFn: apiFn(), projectId: PID, contractId: CTR_PRODUCT });
        expect(m);
      });
    }

    for (const [label, pages, total, expectOffsets, expectItems] of [
      ["250 in three pages", { 0: 100, 100: 100, 200: 50 }, 250, [0, 100, 200], 250],
      ["125 short final page", { 0: 100, 100: 25 }, 125, [0, 100], 125],
      ["200 exact two full pages", { 0: 100, 100: 100 }, 200, [0, 100], 200],
    ] as const) {
      it(`fetchAllScope ${label}`, async () => {
        const mock = scopePagingMock(total, pages);
        const out = await fetchAllScope(mockFetchBare(mock.handler), PID, CTR_PRODUCT);
        assert.equal(out.kind, "ok");
        assert.equal(out.data?.items.length, expectItems);
        assert.equal(out.data?.total, total);
        assert.deepEqual(mock.offsets, expectOffsets);
        assert.equal(mock.offsets.length, expectOffsets.length);
      });
    }

    it("fetchAllScope fails closed when an empty page leaves scope truncated", async () => {
      const mock = scopePagingMock(250, { 0: 100, 100: 0 });
      const out = await fetchAllScope(mockFetchBare(mock.handler), PID, CTR_PRODUCT);
      assert.equal(out.kind, "error");
      assert.deepEqual(mock.offsets, [0, 100]);
    });

    it("fetchAllScope stops when server returns limit zero with large total", async () => {
      let fetches = 0;
      const base = scopeBase();
      const handler: FetchHandler = (url) => {
        if (!url.startsWith(base)) return undefined;
        fetches += 1;
        return {
          status: 200,
          body: {
            data: {
              items: [{ uid: "uid-bad-limit", base: "CAP-BAD-LIMIT", kind: "capability", status: "active", version: 0 }],
              total: 999_999,
              limit: 0,
              offset: 0,
            },
          },
        };
      };
      const out = await fetchAllScope(mockFetchBare(handler), PID, CTR_PRODUCT);
      assert.equal(out.kind, "error");
      assert.equal(fetches, 1);
    });

    it("fetchAllScope caps fetches at MAX_SCOPE_FETCH_PAGES when total is unbounded", async () => {
      let fetches = 0;
      const base = scopeBase();
      const handler: FetchHandler = (url) => {
        if (!url.startsWith(base)) return undefined;
        fetches += 1;
        const off = Number(new URLSearchParams(url.split("?")[1] ?? "").get("offset") ?? "0");
        return {
          status: 200,
          body: {
            data: {
              items: [{ uid: `uid-${off}`, base: `CAP-PAGE-${off}`, kind: "capability", status: "active", version: 0 }],
              total: 999_999,
              limit: 1,
              offset: off,
            },
          },
        };
      };
      const out = await fetchAllScope(mockFetchBare(handler), PID, CTR_PRODUCT, 1);
      assert.equal(out.kind, "error");
      assert.equal(fetches, MAX_SCOPE_FETCH_PAGES);
    });

    for (const [label, apiFnFactory] of [
      [
        "non-positive page limit",
        () => {
          const base = scopeBase();
          const scopeHandler: FetchHandler = (url) => {
            if (!url.startsWith(base)) return undefined;
            return {
              status: 200,
              body: {
                data: {
                  items: [{ uid: "uid-bad-limit", base: "CAP-BAD-LIMIT", kind: "capability", status: "active", version: 0 }],
                  total: 999_999,
                  limit: 0,
                  offset: 0,
                },
              },
            };
          };
          return detailFetch(ctrProductDetail, scopeHandler, () => relEmptyOk);
        },
      ],
      [
        "page cap",
        () => {
          const base = scopeBase();
          const scopeHandler: FetchHandler = (url) => {
            if (!url.startsWith(base)) return undefined;
            const off = Number(new URLSearchParams(url.split("?")[1] ?? "").get("offset") ?? "0");
            return {
              status: 200,
              body: {
                data: {
                  items: [{ uid: `uid-${off}`, base: `CAP-PAGE-${off}`, kind: "capability", status: "active", version: 0 }],
                  total: 999_999,
                  limit: 1,
                  offset: off,
                },
              },
            };
          };
          return detailFetch(ctrProductDetail, scopeHandler, () => relEmptyOk);
        },
      ],
      [
        "empty follow-up page",
        () => detailFetch(ctrProductDetail, scopePagingMock(250, { 0: 100, 100: 0 }).handler, () => relEmptyOk),
      ],
    ] as const) {
      it(`renderContractDetail load error when scope fetch is truncated (${label})`, async () => {
        const m = mainEl();
        await renderContractDetail(m, {
          apiFn: apiFnFactory(),
          projectId: PID,
          contractId: CTR_PRODUCT,
        });
        assert.ok(m.querySelector(".contract-load-error"));
        assert.equal(m.querySelector("h2"), null);
        assert.equal(m.querySelectorAll("table.data-table tbody tr").length, 0);
      });
    }

    it("fetchAllScope 250 rows render on contract detail", async () => {
      const mock = scopePagingMock(250, { 0: 100, 100: 100, 200: 50 });
      const m = mainEl();
      await renderContractDetail(m, {
        apiFn: detailFetch({ ...ctrProductDetail, scope_count: 250 }, mock.handler, () => relEmptyOk),
        projectId: PID,
        contractId: CTR_PRODUCT,
      });
      assert.equal(m.querySelectorAll("table.data-table tbody tr").length, 250);
    });

    for (const [label, failStatus, expect] of [
      ["500 load error", 500, (m: HTMLElement) => {
        assert.ok(m.querySelector(".contract-load-error"));
        assert.equal(m.querySelector("h2"), null);
        assert.equal(m.querySelectorAll("table.data-table tbody tr").length, 0);
      }],
      ["404 not-found", 404, (m: HTMLElement) => {
        assert.equal(m.querySelector("h1")?.textContent, "Not found");
        assert.equal(m.querySelector("h2"), null);
        assert.equal(m.querySelectorAll("table.data-table tbody tr").length, 0);
      }],
    ] as const) {
      it(`fetchAllScope middle-page ${label} not partial table`, async () => {
        const mock = scopePagingMock(250, { 0: 100 }, { offset: 100, status: failStatus });
        const m = mainEl();
        await renderContractDetail(m, {
          apiFn: detailFetch(ctrProductDetail, mock.handler, () => relEmptyOk),
          projectId: PID,
          contractId: CTR_PRODUCT,
        });
        expect(m);
      });
    }

    it("load error h1 uses DTO title not name", async () => {
      const titled = { ...ctrProductDetail, title: "ReqALM product umbrella", name: "legacy-name-field" };
      for (const fail of ["scope", "releases"] as const) {
        const m = mainEl();
        await renderContractDetail(m, {
          apiFn: mockFetchBare((u) => {
            if (u === contractApiPath(PID, CTR_PRODUCT)) return { status: 200, body: { data: titled } };
            if (fail === "scope" && u.startsWith(scopeBase())) return { status: 503, body: {} };
            if (fail === "scope" && u === contractReleasesApiPath(PID, CTR_PRODUCT)) return relEmptyOk;
            if (fail === "releases" && u.startsWith(scopeBase())) return scopeEmptyOk;
            if (fail === "releases" && u === contractReleasesApiPath(PID, CTR_PRODUCT)) return { status: 503, body: {} };
            return { status: 404 };
          }),
          projectId: PID,
          contractId: CTR_PRODUCT,
        });
        assert.equal(m.querySelector("h1")?.textContent, "ReqALM product umbrella");
        assert.ok(m.querySelector(".contract-load-error"));
      }
    });

    it("link guards for invalid scope base and release id", async () => {
      const m = mainEl();
      await renderContractDetail(m, {
        apiFn: mockFetchBare((u) => {
          if (u === contractApiPath(PID, CTR_PRODUCT)) return { status: 200, body: { data: ctrProductDetail } };
          if (u === contractScopeApiPath(PID, CTR_PRODUCT, SCOPE_LIM, 0)) {
            return {
              status: 200,
              body: {
                data: {
                  items: [
                    { uid: "u1", base: "CAP-OK", kind: "capability", status: "active", version: 0 },
                    { uid: "u2", base: "bad id", kind: "requirement", status: "active", version: 0 },
                  ],
                  total: 2,
                  limit: SCOPE_LIM,
                  offset: 0,
                },
              },
            };
          }
          if (u === contractReleasesApiPath(PID, CTR_PRODUCT)) {
            return {
              status: 200,
              body: {
                data: {
                  items: [
                    { id: "rel-r1-read-contracts", name: "Good", status: "shipped", planned_on: null, shipped_on: "2026-10-10" },
                    { id: "INVALID!", name: "Bad release", status: "planned", planned_on: "2026-10-10", shipped_on: null },
                  ],
                },
              },
            };
          }
          return { status: 404 };
        }),
        projectId: PID,
        contractId: CTR_PRODUCT,
      });
      const tables = m.querySelectorAll("table.data-table");
      assert.ok(m.querySelector('a[href="/app/projects/reqalm/requirements/CAP-OK"]'));
      assert.equal(m.querySelector('a[href="/app/projects/reqalm/requirements/bad id"]'), null);
      const scopeRows = [...tables[0].querySelectorAll("tbody tr")];
      assert.equal(scopeRows[1]?.querySelector("td a"), null);
      assert.equal(scopeRows[1]?.querySelector("td code")?.textContent, "bad id");
      assert.ok(m.querySelector('a[href="/app/projects/reqalm/releases/rel-r1-read-contracts"]'));
      const releaseRows = [...tables[1].querySelectorAll("tbody tr")];
      assert.equal(releaseRows[1]?.querySelector("td a"), null);
      assert.match(releaseRows[1]?.textContent ?? "", /Bad release/);
    });

    it("shell tab aria-current and breadcrumbs", () => {
      for (const p of [`/app/projects/${PID}/contracts`, `/app/projects/${PID}/contracts/${CTR_PRODUCT}`]) {
        installDom(`http://localhost${p}`);
        renderAppShell(p, parseAppRoute(p), shellMeta);
        const active = document.querySelector('#project-nav a.project-tab-active[aria-current="page"]');
        assert.equal(active?.textContent, "Contracts");
        assert.equal(active?.getAttribute("href"), `/app/projects/${PID}/contracts`);
      }
      assert.equal(breadcrumbSegments(parseAppRoute(`/app/projects/${PID}/contracts`), shellMeta).at(-1)?.label, "Contracts");
      assert.equal(breadcrumbSegments(parseAppRoute(`/app/projects/${PID}/contracts/${CTR_PRODUCT}`), shellMeta).at(-1)?.label, CTR_PRODUCT);
    });

    it("401 and API errors on list and detail", async () => {
      for (const render of [
        (el: HTMLElement) => renderContractsList(el, { apiFn: async () => null, projectId: PID }),
        (el: HTMLElement) => renderContractDetail(el, { apiFn: async () => null, projectId: PID, contractId: CTR_PRODUCT }),
      ]) {
        const el = mainEl();
        await render(el);
        assert.equal(el.textContent, "");
      }
      const errList = mainEl();
      await renderContractsList(errList, {
        apiFn: mockFetchBare((u) => (u === contractsApiPath(PID, 20, 0) ? { status: 500, body: {} } : { status: 404 })),
        projectId: PID,
      });
      assert.ok(errList.querySelector(".contract-load-error[role=alert]"));
      const errDetail = mainEl();
      await renderContractDetail(errDetail, {
        apiFn: ctrFetch((u) => (u === contractApiPath(PID, CTR_PRODUCT) ? { status: 503, body: {} } : undefined)),
        projectId: PID,
        contractId: CTR_PRODUCT,
      });
      assert.ok(errDetail.querySelector(".contract-load-error"));
      const shellMain = mainEl();
      await mountBrowseView(shellMain, parseAppRoute(`/app/projects/${PID}/contracts`), { apiFn: async () => null });
      assert.equal(shellMain.textContent, "");
    });
  });
