// @ts-nocheck
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  contractsListHref,
  contractDetailHref,
  contractsApiPath,
  contractApiPath,
  contractScopeApiPath,
  contractReleasesApiPath,
  CONTRACT_LIST_FETCH_LIMIT,
  CONTRACT_SCOPE_CHIP_PREVIEW,
  CONTRACT_SCOPE_DETAIL_PREVIEW,
  buildOverlapTimeline,
  contractScopeTag,
  fetchAllScope,
  formatContractPeriod,
  isValidContractId,
  releaseNameLink,
  renderContractsList,
  renderContractDetail,
  resolveSelectedContractId,
  scopeLineLink,
  scopeMoreCount,
  scopeMoreLabel,
} from "./public/browse-contracts.js";
import { parseAppRoute, mountBrowseView } from "./public/browse.js";
import { renderAppShell } from "./public/app.js";
import { breadcrumbSegments } from "./public/shell-nav.js";

export const CTR_PRODUCT = "ctr-reqalm-product";
export const CTR_MAINT = "ctr-reqalm-maintenance";
const PID = "reqalm";
const SCOPE_LIM = 100;

export const ctrProductDetail = {
  id: CTR_PRODUCT,
  title: "Product",
  kind: "contract",
  status: "active",
  scope_count: 0,
  release_count: 0,
  project_id: PID,
  client_id: "reqalm-client",
};

const ctrSummary = (id, title, scope, rel) => ({
  id,
  title,
  kind: "contract",
  description: null,
  scope_count: scope,
  release_count: rel,
  status: "active",
  starts_on: "2026-10-01",
  ends_on: null,
  client_id: "reqalm-client",
});

const ctrListOk = {
  status: 200,
  body: {
    data: {
      items: [ctrSummary(CTR_PRODUCT, "Product", 400, 31), ctrSummary(CTR_MAINT, "Maintenance", 4, 0)],
      total: 2,
      limit: 20,
      offset: 0,
    },
  },
};
const ctrListEmpty = { status: 200, body: { data: { items: [], total: 0, limit: 20, offset: 0 } } };
const scopeEmptyOk = { status: 200, body: { data: { items: [], total: 0, limit: SCOPE_LIM, offset: 0 } } };
const relEmptyOk = { status: 200, body: { data: { items: [] } } };
const contractsPage = (off: number, items: unknown[], total: number) => ({
  status: 200,
  body: { data: { items, total, limit: 20, offset: off } },
});

type FetchHandler = (url: string) => { status: number; body?: unknown } | undefined;

function scopeOffset(url: string) {
  return Number(new URLSearchParams(url.split("?")[1] ?? "").get("offset") ?? "0");
}

function scopeLine(i: number, projectId = PID) {
  return {
    uid: `uid-${i}`,
    base: `CAP-SCOPE-${i}`,
    kind: "capability",
    status: "active",
    version: 0,
    project_id: projectId,
  };
}

function scopeBase(contractId = CTR_PRODUCT) {
  return contractScopeApiPath(PID, contractId, SCOPE_LIM, 0)!.split("?")[0];
}

function scopePage(off: number, n: number, total: number) {
  const items = Array.from({ length: n }, (_, j) => scopeLine(off + j));
  return { status: 200, body: { data: { items, total, limit: SCOPE_LIM, offset: off } } };
}

/** Paged scope mock: pageSizes map offset→item count; optional fail offset+status. */
export function scopePagingMock(
  total: number,
  pageSizes: Record<number, number>,
  fail?: { offset: number; status: number },
) {
  const offsets: number[] = [];
  const base = scopeBase();
  const handler: FetchHandler = (url) => {
    if (!url.startsWith(base)) return undefined;
    const off = scopeOffset(url);
    offsets.push(off);
    if (fail && off === fail.offset) return { status: fail.status, body: {} };
    const n = pageSizes[off];
    if (n === undefined) return { status: 404 };
    return scopePage(off, n, total);
  };
  return { handler, offsets, base };
}

function mainEl() {
  return document.createElement("main");
}

export function registerContractBrowseTests(deps: {
  installDom: (url?: string) => unknown;
  shellMeta: unknown;
  contractsSrc: string;
  mockFetchBare: (handler: FetchHandler) => typeof fetch;
}) {
  const { installDom, shellMeta, contractsSrc, mockFetchBare } = deps;
  const isListUrl = (url: string) => url.startsWith(`/api/v1/projects/${PID}/contracts?`);
  const chipPath = (id = CTR_PRODUCT) => contractScopeApiPath(PID, id, CONTRACT_SCOPE_CHIP_PREVIEW, 0)!;
  const docPath = (id = CTR_PRODUCT) => contractScopeApiPath(PID, id, CONTRACT_SCOPE_DETAIL_PREVIEW, 0)!;
  const defaultProductDetailFetch: FetchHandler = (url) => {
    if (url === contractApiPath(PID, CTR_PRODUCT)) return { status: 200, body: { data: ctrProductDetail } };
    if (url === chipPath() || url === docPath()) return scopeEmptyOk;
    if (url === contractReleasesApiPath(PID, CTR_PRODUCT)) return relEmptyOk;
    return undefined;
  };
  const ctrFetch = (extra: FetchHandler) =>
    mockFetchBare((url) => {
      if (isListUrl(url)) return ctrListOk;
      return extra(url) ?? defaultProductDetailFetch(url) ?? { status: 404 };
    });
  const detailFetch = (contractBody: unknown, scope: FetchHandler, releases: FetchHandler = () => relEmptyOk) =>
    mockFetchBare((url) => {
      if (isListUrl(url)) return ctrListOk;
      if (url === contractApiPath(PID, CTR_PRODUCT)) return { status: 200, body: { data: contractBody } };
      if (url === chipPath()) return scopeEmptyOk;
      if (url === docPath()) return scopeEmptyOk;
      if (url === contractReleasesApiPath(PID, CTR_PRODUCT)) return relEmptyOk;
      return scope(url) ?? releases(url) ?? { status: 404 };
    });
  const ctrDetailApiFetch = (overrides: {
    contract?: { status: number; body?: unknown };
    scope?: { status: number; body?: unknown };
    releases?: { status: number; body?: unknown };
  } = {}) => {
    const contractOk = { status: 200, body: { data: ctrProductDetail } };
    return mockFetchBare((url) => {
      if (isListUrl(url)) return ctrListOk;
      if (url === contractApiPath(PID, CTR_PRODUCT)) return overrides.contract ?? contractOk;
      if (url === chipPath() || url === docPath()) return overrides.scope ?? scopeEmptyOk;
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
      assert.equal(contractsListHref(PID), `/app/projects/${PID}/contracts`);
      assert.equal(contractsListHref("INVALID!"), null);
      assert.equal(contractDetailHref(PID, CTR_PRODUCT), `/app/projects/${PID}/contracts/${CTR_PRODUCT}`);
      assert.equal(contractDetailHref(PID, "Bad_ID"), null);
      assert.equal(contractsApiPath(PID, 20, 0), `/api/v1/projects/${PID}/contracts?limit=20&offset=0`);
      assert.equal(contractsApiPath("bad!", 20, 0), null);
      assert.ok(isValidContractId(CTR_PRODUCT) && !isValidContractId("Bad_ID"));
      assert.equal(formatContractPeriod("2026-10-01", "2027-03-15"), "2026-10 — 2027-03");
      assert.equal(scopeMoreLabel(25, 431), "+406 more");
      assert.equal(scopeMoreLabel(25, 25), null);
      assert.equal(scopeMoreCount(3, 62), 59);
      assert.equal(scopeMoreLabel(3, 62), "+59 more");
      assert.equal(resolveSelectedContractId(CTR_MAINT, ctrListOk.body.data.items), CTR_MAINT);
      assert.equal(contractScopeTag(ctrListOk.body.data.items[0], ctrListOk.body.data.items), "overlapping support");
      assert.ok(buildOverlapTimeline(ctrListOk.body.data.items, CTR_PRODUCT).bars.length >= 2);
    });

    it("contractScopeTag mutant (ignoring overlap count) fails tag choice", () => {
      const items = ctrListOk.body.data.items;
      const mutant = () => "sequential";
      assert.notEqual(mutant(), contractScopeTag(items[0], items));
    });

    it("scopeMoreLabel mutant boundary (off-by-one fails)", () => {
      assert.equal(scopeMoreLabel(24, 25), "+1 more");
      assert.notEqual(scopeMoreLabel(24, 25), "+2 more");
      assert.notEqual(scopeMoreLabel(24, 25), "+0 more");
      const mutant = (shown: number, total: number) => {
        const n = Math.max(0, total - shown + 1);
        return n > 0 ? `+${n} more` : null;
      };
      assert.notEqual(mutant(24, 25), scopeMoreLabel(24, 25));
    });

    it("scope and release link guards use peer project_id", () => {
      const scopeHost = document.createElement("div");
      scopeHost.append(
        scopeLineLink(PID, { base: "CAP-OK", project_id: PID }),
        scopeLineLink(PID, { base: "R-PEER", project_id: "twin-b" }),
        scopeLineLink(PID, { base: "bad id", project_id: PID }),
        scopeLineLink(PID, { base: "NO-PROJ", project_id: "" }),
      );
      assert.ok(scopeHost.querySelector('a[href="/app/projects/reqalm/requirements/CAP-OK"]'));
      assert.ok(scopeHost.querySelector('a[href="/app/projects/twin-b/requirements/R-PEER"]'));
      assert.equal(scopeHost.querySelector('a[href="/app/projects/reqalm/requirements/bad id"]'), null);
      assert.equal(scopeHost.querySelector('a[href="/app/projects/reqalm/requirements/NO-PROJ"]'), null);
      assert.ok(scopeHost.querySelector("code.contract-scope-plain"));

      const relHost = document.createElement("div");
      relHost.append(
        releaseNameLink(PID, { id: "rel-a", name: "A", project_id: PID }),
        releaseNameLink(PID, { id: "rel-b", name: "B", project_id: "twin-b" }),
        releaseNameLink(PID, { id: "INVALID!", name: "Bad", project_id: PID }),
      );
      assert.ok(relHost.querySelector('a[href="/app/projects/reqalm/releases/rel-a"]'));
      assert.ok(relHost.querySelector('a[href="/app/projects/twin-b/releases/rel-b"]'));
      assert.equal(relHost.querySelector("a[href*='INVALID']"), null);
    });

    it("list empty, invalid ids, summary, list 404", async () => {
      const ok = mainEl();
      await renderContractsList(ok, { apiFn: ctrFetch(() => undefined), projectId: PID });
      assert.match(ok.textContent ?? "", /Product/);
      assert.ok(ok.querySelector(`a[href="${contractDetailHref(PID, CTR_PRODUCT)}"]`));
      const empty = mainEl();
      await renderContractsList(empty, {
        apiFn: mockFetchBare((u) => (isListUrl(u) ? ctrListEmpty : { status: 404 })),
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
          isListUrl(u)
            ? {
                status: 200,
                body: {
                  data: {
                    items: [{ id: "INVALID!", title: "H", scope_count: 1, release_count: 0, status: "active", starts_on: null, ends_on: null, client_id: "c" }],
                    total: 1,
                    limit: 100,
                    offset: 0,
                  },
                },
              }
            : { status: 404 },
        ),
        projectId: PID,
      });
      assert.equal(badRow.querySelector("a.contract-card"), null);
      const sum = mainEl();
      await renderContractsList(sum, { apiFn: ctrFetch(() => undefined), projectId: PID });
      assert.equal(sum.querySelectorAll("a.contract-card").length, 2);
      assert.ok(sum.querySelector(".contract-card-selected"));
      assert.ok(sum.querySelector(".contracts-two-pane"));
      const nf = mainEl();
      await renderContractsList(nf, {
        apiFn: mockFetchBare((u) => (isListUrl(u) ? { status: 404, body: {} } : { status: 404 })),
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
      const scopePayload = {
        status: 200,
        body: {
          data: {
            items: [{ uid: "CAP-UPKEEP-1", base: "CAP-UPKEEP-1", kind: "capability", status: "draft", version: 0, project_id: PID }],
            total: 1,
            limit: CONTRACT_SCOPE_CHIP_PREVIEW,
            offset: 0,
          },
        },
      };
      await renderContractDetail(m1, {
        apiFn: ctrFetch((u) => {
          if (u === contractApiPath(PID, CTR_MAINT)) return { status: 200, body: { data: maint } };
          if (u === chipPath(CTR_MAINT) || u === docPath(CTR_MAINT)) return scopePayload;
          if (u === contractReleasesApiPath(PID, CTR_MAINT)) return relEmptyOk;
          return undefined;
        }),
        projectId: PID,
        contractId: CTR_MAINT,
      });
      assert.match(m1.textContent ?? "", /Maint notes/);
      assert.ok(m1.querySelector('a[href="/app/projects/reqalm/requirements/CAP-UPKEEP-1"]'));
      assert.ok(m1.querySelector(".contract-overlap-tracks"));
      const xss = '<img onerror=alert(1)>';
      const m2 = mainEl();
      await renderContractDetail(m2, {
        apiFn: ctrFetch((u) => {
          if (u === contractApiPath(PID, CTR_PRODUCT)) return { status: 200, body: { data: { ...ctrProductDetail, title: xss } } };
          if (u === chipPath() || u === docPath()) return scopeEmptyOk;
          if (u === contractReleasesApiPath(PID, CTR_PRODUCT)) {
            return {
              status: 200,
              body: {
                data: {
                  items: [{ id: "rel-r1-read-contracts", name: xss, status: "shipped", planned_on: null, shipped_on: "2026-10-10", project_id: PID }],
                },
              },
            };
          }
          return undefined;
        }),
        projectId: PID,
        contractId: CTR_PRODUCT,
      });
      assert.equal(m2.querySelector("img"), null);
      assert.ok(m2.querySelector('a[href="/app/projects/reqalm/releases/rel-r1-read-contracts"]'));
      assert.equal(m2.querySelector(".contract-panel-title")?.textContent, xss);
      assert.equal(m2.querySelector('a[href="/app/projects/reqalm/releases/rel-r1-read-contracts"]')?.textContent, xss);
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
      ["empty page stops paging", { 0: 100, 100: 0 }, 250, [0, 100], 100],
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

    it("contract detail scope chips and +N more (not full membership table by default)", async () => {
      const chip = CONTRACT_SCOPE_CHIP_PREVIEW;
      const total = 431;
      const m = mainEl();
      await renderContractDetail(m, {
        apiFn: mockFetchBare((url) => {
          if (isListUrl(url)) return ctrListOk;
          if (url === contractApiPath(PID, CTR_PRODUCT)) {
            return { status: 200, body: { data: { ...ctrProductDetail, scope_count: total } } };
          }
          if (url === chipPath()) {
            return {
              status: 200,
              body: { data: { items: Array.from({ length: chip }, (_, i) => scopeLine(i)), total, limit: chip, offset: 0 } },
            };
          }
          if (url === docPath()) {
            return {
              status: 200,
              body: {
                data: {
                  items: Array.from({ length: CONTRACT_SCOPE_DETAIL_PREVIEW }, (_, i) => scopeLine(i)),
                  total,
                  limit: CONTRACT_SCOPE_DETAIL_PREVIEW,
                  offset: 0,
                },
              },
            };
          }
          if (url === contractReleasesApiPath(PID, CTR_PRODUCT)) return relEmptyOk;
          return { status: 404 };
        }),
        projectId: PID,
        contractId: CTR_PRODUCT,
      });
      assert.equal(m.querySelectorAll(".contract-req-chip").length, chip);
      assert.equal(m.querySelector(".contract-scope-more")?.textContent, scopeMoreLabel(chip, total));
      assert.ok(m.querySelector("#contract-document-view[hidden]"));
    });

    for (const [label, failStatus, expect] of [
      ["500 load error", 500, (m: HTMLElement) => {
        assert.ok(m.querySelector(".contract-load-error"));
        assert.equal(m.querySelector("h2"), null);
        assert.equal(m.querySelectorAll("table.contracts-scope-table tbody tr").length, 0);
      }],
      ["404 not-found", 404, (m: HTMLElement) => {
        assert.equal(m.querySelector("h1")?.textContent, "Not found");
        assert.equal(m.querySelector("h2"), null);
        assert.equal(m.querySelectorAll("table.contracts-scope-table tbody tr").length, 0);
      }],
    ] as const) {
      it(`scope preview first-page ${label} not partial table`, async () => {
        const mock = scopePagingMock(250, { 0: CONTRACT_SCOPE_DETAIL_PREVIEW }, { offset: 0, status: failStatus });
        const m = mainEl();
        await renderContractDetail(m, {
          apiFn: mockFetchBare((url) => {
            if (isListUrl(url)) return ctrListOk;
            if (url === contractApiPath(PID, CTR_PRODUCT)) return { status: 200, body: { data: ctrProductDetail } };
            if (url === chipPath() || url === docPath()) return mock.handler(url) ?? { status: 503, body: {} };
            if (url === contractReleasesApiPath(PID, CTR_PRODUCT)) return relEmptyOk;
            return { status: 404 };
          }),
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
            if (isListUrl(u)) return ctrListOk;
            if (u === contractApiPath(PID, CTR_PRODUCT)) return { status: 200, body: { data: titled } };
            if (fail === "scope" && (u === chipPath() || u === docPath())) return { status: 503, body: {} };
            if (fail === "scope" && u === contractReleasesApiPath(PID, CTR_PRODUCT)) return relEmptyOk;
            if (fail === "releases" && (u === chipPath() || u === docPath())) return scopeEmptyOk;
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
          if (isListUrl(u)) return ctrListOk;
          if (u === contractApiPath(PID, CTR_PRODUCT)) return { status: 200, body: { data: ctrProductDetail } };
          const scopeBody = {
            status: 200,
            body: {
              data: {
                items: [
                  { uid: "u1", base: "CAP-OK", kind: "capability", status: "active", version: 0, project_id: PID },
                  { uid: "u2", base: "bad id", kind: "requirement", status: "active", version: 0, project_id: PID },
                  { uid: "u3", base: "R-X", kind: "requirement", status: "active", version: 0, project_id: "twin-b" },
                ],
                total: 3,
                limit: CONTRACT_SCOPE_CHIP_PREVIEW,
                offset: 0,
              },
            },
          };
          if (u === chipPath()) return scopeBody;
          if (u === docPath()) {
            return {
              status: 200,
              body: {
                data: {
                  ...scopeBody.body.data,
                  limit: CONTRACT_SCOPE_DETAIL_PREVIEW,
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
                    { id: "rel-r1-read-contracts", name: "Good", status: "shipped", planned_on: null, shipped_on: "2026-10-10", project_id: PID },
                    { id: "INVALID!", name: "Bad release", status: "planned", planned_on: "2026-10-10", shipped_on: null, project_id: PID },
                    { id: "rel-twin", name: "Twin", status: "planned", planned_on: "2026-10-10", shipped_on: null, project_id: "twin-b" },
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
      const tables = m.querySelectorAll("table.contracts-table");
      assert.ok(m.querySelector('a[href="/app/projects/reqalm/requirements/CAP-OK"]'));
      assert.ok(m.querySelector('a[href="/app/projects/twin-b/requirements/R-X"]'));
      assert.equal(m.querySelector('a[href="/app/projects/reqalm/requirements/bad id"]'), null);
      const scopeRows = [...tables[0].querySelectorAll("tbody tr")];
      assert.equal(scopeRows[1]?.querySelector("td a"), null);
      assert.equal(scopeRows[1]?.querySelector("td code")?.textContent, "bad id");
      assert.ok(m.querySelector('a[href="/app/projects/reqalm/releases/rel-r1-read-contracts"]'));
      assert.ok(m.querySelector('a[href="/app/projects/twin-b/releases/rel-twin"]'));
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
        apiFn: mockFetchBare((u) => (isListUrl(u) ? { status: 500, body: {} } : { status: 404 })),
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
}
