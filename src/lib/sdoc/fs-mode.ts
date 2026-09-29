export type FsMode = "server" | "browser";

export const FS_MODE_KEY = "sdoc-fs";

let active: FsMode = "server";

export function activeMode(): FsMode {
  return active;
}

export function setActiveMode(mode: FsMode): void {
  active = mode;
}

export function modeFromSearch(search: string): FsMode | null {
  const value = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("mode");
  if (value === "browser" || value === "server") return value;
  return null;
}

export function modeFromStorage(value: string | null): FsMode | null {
  if (value === "browser" || value === "server") return value;
  return null;
}

/** `?mode=` wins, then the remembered choice. Null means probe the server. */
export function explicitMode(search: string, stored: string | null): FsMode | null {
  return modeFromSearch(search) ?? modeFromStorage(stored);
}
