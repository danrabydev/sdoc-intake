import assert from "node:assert/strict";
import { test } from "node:test";
import { explicitMode, modeFromSearch, modeFromStorage } from "./fs-mode.ts";

test("mode comes from the query, then storage", () => {
  assert.equal(modeFromSearch("?mode=browser&file=SYS.sdoc"), "browser");
  assert.equal(modeFromSearch("mode=server"), "server");
  assert.equal(modeFromSearch("?mode=disk"), null);
  assert.equal(modeFromStorage("browser"), "browser");
  assert.equal(modeFromStorage("nope"), null);
  assert.equal(explicitMode("?file=SYS.sdoc", "browser"), "browser");
  assert.equal(explicitMode("?mode=server", "browser"), "server");
  assert.equal(explicitMode("", null), null);
});
