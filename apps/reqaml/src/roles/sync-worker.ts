import type { AppConfig } from "../config.js";

export type SyncHandle = {
  stop: () => void;
  isRunning: () => boolean;
};

/** Placeholder sync worker — real DevOps sync lands in a later slice. */
export function startSyncWorker(_config: AppConfig): SyncHandle {
  let running = true;
  const timer = setInterval(() => {
    /* no-op tick */
  }, 60_000);
  timer.unref();
  return {
    stop: () => {
      running = false;
      clearInterval(timer);
    },
    isRunning: () => running,
  };
}
