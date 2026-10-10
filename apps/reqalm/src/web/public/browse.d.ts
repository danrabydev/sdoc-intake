export function parseAppRoute(path: string): { view: string; projectId?: string; contractId?: string };
export function mountBrowseView(
  container: HTMLElement,
  route: ReturnType<typeof parseAppRoute>,
  opts: { apiFn: (url: string) => Promise<unknown> | unknown },
): Promise<void>;
