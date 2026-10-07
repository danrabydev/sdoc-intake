import { test } from "node:test";
import assert from "node:assert/strict";
import { openBaoStatusToCheck } from "./openbao.js";

test("openBaoStatusToCheck maps sealed state", () => {
  const r = openBaoStatusToCheck({
    ok: false,
    sealed: true,
    detail: "OpenBao sealed",
  });
  assert.equal(r.ok, false);
  assert.match(r.detail ?? "", /sealed/);
});

test("openBaoStatusToCheck ok when probe succeeds", () => {
  const r = openBaoStatusToCheck({ ok: true });
  assert.equal(r.ok, true);
  assert.equal(r.detail, undefined);
});
