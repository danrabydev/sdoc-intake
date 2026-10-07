import type { CheckResult } from "./types.js";

type CacheEntry = {
  at: number;
  result: CheckResult;
};

/** Short TTL cache so /ready cannot hammer OpenBao on every scrape. */
export class ProbeCache {
  private entries = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs: number) {}

  async get(
    key: string,
    probe: () => Promise<CheckResult>,
  ): Promise<CheckResult> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < this.ttlMs) {
      return hit.result;
    }
    const result = await probe();
    this.entries.set(key, { at: now, result });
    return result;
  }

  clear(): void {
    this.entries.clear();
  }
}
