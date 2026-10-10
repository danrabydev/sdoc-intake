/** Types for contract browse (implementation in browse-contracts.js). */

export const CONTRACT_LIST_FETCH_LIMIT: number;
export const CONTRACT_SCOPE_CHIP_PREVIEW: number;
export const CONTRACT_SCOPE_DETAIL_PREVIEW: number;
export const FETCH_ALL_SCOPE_MAX_PAGES: number;

export function contractsListHref(projectId: string): string | null;
export function contractDetailHref(projectId: string, contractId: string): string | null;
export function contractsApiPath(projectId: string, limit: number, offset: number): string | null;
export function contractApiPath(projectId: string, contractId: string): string | null;
export function contractScopeApiPath(projectId: string, contractId: string, limit: number, offset: number): string | null;
export function contractReleasesApiPath(projectId: string, contractId: string): string | null;

export function isValidContractId(id: string): boolean;
export function formatContractPeriod(startsOn: unknown, endsOn: unknown): string;
export function parseContractMonth(iso: unknown): number | null;
export function contractEffectiveEndMonth(startsOn: unknown, endsOn: unknown): number | null;

export function buildOverlapTimeline(
  contracts: ReadonlyArray<{ id: string; title?: string; starts_on?: string | null; ends_on?: string | null }>,
  selectedId: string,
): {
  ticks: string[];
  bars: ReadonlyArray<{ id: string; leftPct: number; widthPct: number; start: number; end: number }>;
  span: number;
};

export function contractScopeTag(
  contract: { id: string; starts_on?: string | null; ends_on?: string | null },
  allContracts: ReadonlyArray<{ id: string; starts_on?: string | null; ends_on?: string | null }>,
): string;

export function scopeMoreCount(shown: number, total: number): number;
export function scopeMoreLabel(shown: number, total: number): string | null;
export function resolveSelectedContractId(requestedId: string | null, items: ReadonlyArray<{ id: string }>): string | null;

export function scopeLineLink(anchorProjectId: string, line: { base?: string; project_id?: string }): HTMLElement;
export function releaseNameLink(
  anchorProjectId: string,
  release: { id: string; name?: string; project_id?: string },
): HTMLElement;

export function fetchAllScope(
  apiFn: (url: string) => Promise<unknown> | unknown,
  projectId: string,
  contractId: string,
  limit?: number,
): Promise<
  | { kind: "ok"; data: { items: unknown[]; total: number } }
  | { kind: "error" }
  | { kind: "auth" }
  | { kind: string; data?: undefined }
>;

export function renderContractsList(
  container: HTMLElement,
  opts: { apiFn: (url: string) => Promise<unknown> | unknown; projectId: string },
): Promise<void>;

export function renderContractDetail(
  container: HTMLElement,
  opts: { apiFn: (url: string) => Promise<unknown> | unknown; projectId: string; contractId: string },
): Promise<void>;
