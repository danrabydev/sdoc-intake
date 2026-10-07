import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";
import { isDevMarkedOpenBaoAddr } from "../key/openbao.js";

test("production config flags dev OpenBao addresses", () => {
  assert.equal(isDevMarkedOpenBaoAddr("http://peripherals:8200"), true);
  assert.equal(isDevMarkedOpenBaoAddr("https://openbao.prod.example"), false);
});

test("loadConfig reads OPENBAO_TOKEN_FILE", () => {
  const cfg = loadConfig({
    DATABASE_URL: "postgresql://u:p@localhost/db",
    OPENBAO_TOKEN_FILE: "/etc/test-token",
    OPENBAO_TOKEN: "inline",
  });
  assert.equal(cfg.OPENBAO_TOKEN, "inline");
});
