import { test } from "node:test";
import assert from "node:assert/strict";
import { ProbeCache } from "./cache.js";

test("ProbeCache returns cached result within TTL", async () => {
  const cache = new ProbeCache(10_000);
  let calls = 0;
  const probe = async () => {
    calls++;
    return { ok: true as const };
  };
  await cache.get("k", probe);
  await cache.get("k", probe);
  assert.equal(calls, 1);
});

test("ProbeCache re-probes after TTL", async () => {
  const cache = new ProbeCache(1);
  let calls = 0;
  const probe = async () => {
    calls++;
    return { ok: calls === 1 };
  };
  await cache.get("k", probe);
  await new Promise((r) => setTimeout(r, 5));
  await cache.get("k", probe);
  assert.equal(calls, 2);
});
