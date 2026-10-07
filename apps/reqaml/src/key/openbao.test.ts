import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";
import { probeOpenBao, TRANSIT_KEK_NAME } from "./openbao.js";

afterEach(() => {
  mock.restoreAll();
});

function baseConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    DATABASE_URL: "postgresql://u:p@localhost/db",
    REQAML_MODE: "development",
    OPENBAO_ADDR: "http://127.0.0.1:8200",
    OPENBAO_TOKEN: "test-token",
    REQAML_OPENBAO_DEV_MARKED: "false",
    ...overrides,
  });
}

test("probeOpenBao fails when sealed", async () => {
  mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("/v1/sys/health")) {
      return new Response(JSON.stringify({ sealed: true, initialized: true }), {
        status: 503,
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  const status = await probeOpenBao(baseConfig(), { timeoutMs: 500 });
  assert.equal(status.ok, false);
  assert.equal(status.sealed, true);
  assert.match(status.detail ?? "", /sealed/i);
});

test("probeOpenBao fails when transit encrypt fails", async () => {
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (url.includes("/v1/sys/health")) {
      return new Response(JSON.stringify({ sealed: false, initialized: true }), {
        status: 200,
      });
    }
    if (url.includes("/v1/sys/mounts/transit")) {
      return new Response(JSON.stringify({ description: "transit" }), {
        status: 200,
      });
    }
    if (url.includes(`/transit/encrypt/${TRANSIT_KEK_NAME}`)) {
      return new Response("nope", { status: 500 });
    }
    throw new Error(`unexpected fetch ${url} ${init?.method ?? "GET"}`);
  });

  const status = await probeOpenBao(baseConfig(), { timeoutMs: 500 });
  assert.equal(status.ok, false);
  assert.match(status.detail ?? "", /encrypt failed/i);
});

test("probeOpenBao succeeds on encrypt/decrypt round-trip", async () => {
  const plaintext = Buffer.from("reqaml-readiness-probe").toString("base64");
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (url.includes("/v1/sys/health")) {
      return new Response(JSON.stringify({ sealed: false, initialized: true }), {
        status: 200,
      });
    }
    if (url.includes("/v1/sys/mounts/transit")) {
      return new Response(JSON.stringify({ description: "transit" }), {
        status: 200,
      });
    }
    if (url.includes(`/transit/encrypt/${TRANSIT_KEK_NAME}`)) {
      return new Response(JSON.stringify({ data: { ciphertext: "vault:v1:abc" } }), {
        status: 200,
      });
    }
    if (url.includes(`/transit/decrypt/${TRANSIT_KEK_NAME}`)) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.ciphertext, "vault:v1:abc");
      return new Response(JSON.stringify({ data: { plaintext } }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  const status = await probeOpenBao(baseConfig(), { timeoutMs: 500 });
  assert.equal(status.ok, true);
  assert.equal(status.transitKekUsable, true);
});

test("probeOpenBao refuses dev-marked addr in production", async () => {
  const status = await probeOpenBao(
    baseConfig({
      REQAML_MODE: "production",
      OPENBAO_ADDR: "http://peripherals:8200",
    }),
    { timeoutMs: 500 },
  );
  assert.equal(status.ok, false);
  assert.equal(status.devMarked, true);
});
