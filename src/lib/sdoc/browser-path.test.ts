import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./api-error.ts";
import { assertSdocRel } from "./browser-fs.ts";

test("browser paths stay inside the picked folder", () => {
  assert.equal(assertSdocRel("cabin/CAB.sdoc"), "cabin/CAB.sdoc");
  assert.throws(() => assertSdocRel("../SYS.sdoc"), ApiError);
  assert.throws(() => assertSdocRel("notes.txt"), ApiError);
  assert.throws(() => assertSdocRel("a b.sdoc"), ApiError);
});
