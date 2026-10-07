import type { AppConfig } from "../config.js";

export type SyncHandle = {
  stop: () => void;
};

/** Placeholder sync worker — real DevOps sync lands in a later slice. */
export function startSyncWorker(_config: AppConfig): SyncHandle {
  const timer = setInterval(() => {
    /* no-op tick */
  }, 60_000);
  timer.unref();
  return {
    stop: () => clearInterval(timer),
  };
}
