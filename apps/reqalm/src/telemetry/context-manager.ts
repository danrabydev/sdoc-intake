import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";

let manager: AsyncLocalStorageContextManager | null = null;

/** Required so pg/http spans stay under manual operation spans across await boundaries. */
export function getAsyncContextManager(): AsyncLocalStorageContextManager {
  if (!manager) {
    manager = new AsyncLocalStorageContextManager();
    manager.enable();
  }
  return manager;
}
