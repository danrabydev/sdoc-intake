import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { collectUids } from "./model.ts";
import { parse } from "./parse.ts";
import { textForWrite } from "./serialize.ts";
import { createFile, readFileView, saveFile, SdocError } from "./store.server.ts";
import { validate } from "./validate.ts";

const sysText = readFileSync(new URL("../../../data/SYS.sdoc", import.meta.url), "utf8");
const capText = readFileSync(new URL("../../../data/CAP.sdoc", import.meta.url), "utf8");

test("SYS and CAP parse, link, and survive a write pretty-print", () => {
  const sys = parse(sysText);
  const cap = parse(capText);
  assert.equal(sys.errors.length, 0, JSON.stringify(sys.errors));
  assert.equal(cap.errors.length, 0, JSON.stringify(cap.errors));
  assert.ok(sys.document && cap.document);
  const sysUids = collectUids(sys.document);
  const capChecked = validate(capText, {
    mode: "write",
    indexComplete: true,
    siblingUids: sysUids,
    file: "CAP.sdoc",
  });
  assert.equal(capChecked.ok, true, JSON.stringify(capChecked.errors, null, 2));
  const pretty = textForWrite(cap.document);
  const again = validate(pretty, {
    mode: "write",
    indexComplete: true,
    siblingUids: sysUids,
    file: "CAP.sdoc",
  });
  assert.equal(again.ok, true, JSON.stringify(again.errors, null, 2));
  assert.match(pretty, /ROLE: Refines/);
  assert.match(pretty, /\[GRAMMAR\]/);
});

test("bad field order is a parse error", () => {
  const result = validate("[DOCUMENT]\nUID: DOC-X\nTITLE: Wrong order\n");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => /out of order/.test(issue.message)));
});

test("duplicate UID is an error", () => {
  const text = `[DOCUMENT]
TITLE: Dup
ROOT: True

[REQUIREMENT]
UID: SYS-010
TITLE: One

[REQUIREMENT]
UID: SYS-010
TITLE: Two
`;
  const result = validate(text, { mode: "write", indexComplete: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.code === "duplicate-uid"));
});

test("missing parent warns, and strict blocks", () => {
  const text = `[DOCUMENT]
TITLE: Child doc
ROOT: False

[REQUIREMENT]
UID: CAP-900
TITLE: Orphan
`;
  const loose = validate(text, { mode: "write", indexComplete: true });
  assert.equal(loose.ok, true);
  assert.ok(loose.errors.some((issue) => issue.code === "missing-parent" && issue.severity === "warning"));
  const strict = validate(text, { mode: "write", indexComplete: true, strict: true });
  assert.equal(strict.ok, false);
});

test("unclosed multiline is an error", () => {
  const text = `[DOCUMENT]
TITLE: Broken

[TEXT]
STATEMENT: >>>
never closed
`;
  const result = validate(text);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.code === "unclosed-multiline"));
});

test("parent cycle is an error", () => {
  const text = `[DOCUMENT]
TITLE: Loop
ROOT: True

[REQUIREMENT]
UID: A-1
TITLE: A
RELATIONS:
- TYPE: Parent
  VALUE: A-2

[REQUIREMENT]
UID: A-2
TITLE: B
RELATIONS:
- TYPE: Parent
  VALUE: A-1
`;
  const result = validate(text, { mode: "write", indexComplete: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.code === "cycle"));
});

test("unknown parent UID is an error on write and does not touch disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdoc-intake-"));
  const previous = process.env.SDOC_ROOT;
  process.env.SDOC_ROOT = dir;
  try {
    await createFile({ path: "SYS.sdoc", title: "System", uid: "DOC-SYS", prefix: "SYS-", root: true });
    await saveFile("SYS.sdoc", {
      text: `[DOCUMENT]
TITLE: System
UID: DOC-SYS
PREFIX: SYS-
ROOT: True

[REQUIREMENT]
UID: SYS-010
TITLE: Restrain
`,
    });
    await createFile({ path: "CAP.sdoc", title: "Capabilities", uid: "DOC-CAP", prefix: "CAP-", root: false });
    const before = await readFile(join(dir, "CAP.sdoc"), "utf8");
    await assert.rejects(
      () =>
        saveFile("CAP.sdoc", {
          text: `[DOCUMENT]
TITLE: Capabilities
UID: DOC-CAP
PREFIX: CAP-
ROOT: False

[REQUIREMENT]
UID: CAP-010
TITLE: Belts
RELATIONS:
- TYPE: Parent
  ROLE: Refines
  VALUE: NO-SUCH
`,
        }),
      (err: unknown) => {
        assert.ok(err instanceof SdocError);
        assert.equal(err.status, 422);
        assert.ok(err.errors.some((issue) => issue.code === "unresolved-uid"));
        return true;
      },
    );
    const after = await readFile(join(dir, "CAP.sdoc"), "utf8");
    assert.equal(after, before);
    const view = await readFileView("SYS.sdoc");
    assert.match(view.text, /UID: SYS-010/);
  } finally {
    if (previous === undefined) delete process.env.SDOC_ROOT;
    else process.env.SDOC_ROOT = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

after(() => {
  delete process.env.SDOC_ROOT;
});
