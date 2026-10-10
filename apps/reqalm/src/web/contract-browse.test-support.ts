export const CTR_PRODUCT = "ctr-reqalm-product";
export const CTR_MAINT = "ctr-reqalm-maintenance";
export const PID = "reqalm";
export const SCOPE_LIM = 100;

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

export const ctrSummary = (id: string, title: string, scope: number, rel: number) => ({
  id,
  title,
  kind: "contract",
  description: null,
  scope_count: scope,
  release_count: rel,
});

export const ctrListOk = {
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
export const ctrListEmpty = { status: 200, body: { data: { items: [], total: 0, limit: 20, offset: 0 } } };
export const scopeEmptyOk = { status: 200, body: { data: { items: [], total: 0, limit: SCOPE_LIM, offset: 0 } } };
export const relEmptyOk = { status: 200, body: { data: { items: [] } } };
export const contractsPage = (off: number, items: unknown[], total: number) => ({
  status: 200,
  body: { data: { items, total, limit: 20, offset: off } },
});

export type FetchHandler = (url: string) => { status: number; body?: unknown } | undefined;

function scopeOffset(url: string) {
  return Number(new URLSearchParams(url.split("?")[1] ?? "").get("offset") ?? "0");
}

function scopeLine(i: number) {
  return { uid: `uid-${i}`, base: `CAP-SCOPE-${i}`, kind: "capability", status: "active", version: 0 };
}

export function scopeBase(contractId = CTR_PRODUCT) {
  return `/api/v1/projects/${encodeURIComponent(PID)}/contracts/${encodeURIComponent(contractId)}/scope`;
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
