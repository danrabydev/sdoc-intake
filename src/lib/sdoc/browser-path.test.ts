import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./api-error.ts";
import { assertDirRel, assertSdocRel } from "./browser-fs.ts";

test("folder paths stay inside the picked folder", () => {
  assert.equal(assertDirRel("cabin/specs"), "cabin/specs");
  assert.throws(() => assertDirRel("../secret"), ApiError);
  assert.throws(() => assertDirRel(".git"), ApiError);
  assert.throws(() => assertDirRel("notes.sdoc"), ApiError);
});

test("browser paths stay inside the picked folder", () => {
  assert.equal(assertSdocRel("cabin/CAB.sdoc"), "cabin/CAB.sdoc");
  assert.throws(() => assertSdocRel("../SYS.sdoc"), ApiError);
  assert.throws(() => assertSdocRel("notes.txt"), ApiError);
  assert.throws(() => assertSdocRel("a b.sdoc"), ApiError);
});

