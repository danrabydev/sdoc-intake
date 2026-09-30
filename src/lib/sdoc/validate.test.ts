import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { collectUids, insertInside, sectionNode } from "./model.ts";
import { parse } from "./parse.ts";
import { textForWrite } from "./serialize.ts";
import { createFile, readFileView, saveFile, SdocError } from "./store.server.ts";
import { validate } from "./validate.ts";

const sysText = readFileSync(new URL("../../../data/SYS.sdoc", import.meta.url), "utf8");
const capText = readFileSync(new URL("../../../data/CAP.sdoc", import.meta.url), "utf8");

test("SingleChoice options and REVERSE_ROLE round-trip", () => {
  const text = `[DOCUMENT]
TITLE: Choices

[GRAMMAR]
ELEMENTS:
- TAG: REQUIREMENT
  FIELDS:
  - TITLE: UID
    TYPE: String
    REQUIRED: False
  - TITLE: TITLE
    TYPE: String
    REQUIRED: False
  - TITLE: PRIORITY
    TYPE: SingleChoice(Low, Medium, High)
    REQUIRED: False
  RELATIONS:
  - TYPE: Parent
    ROLE: Refines
    REVERSE_ROLE: Refined by

[REQUIREMENT]
UID: REQ-1
TITLE: Parent
PRIORITY: Low

[REQUIREMENT]
UID: REQ-2
TITLE: Child
PRIORITY: Urgent
RELATIONS:
- TYPE: Parent
  VALUE: REQ-1
  ROLE: Refines
`;
  const parsed = parse(text);
  assert.equal(parsed.errors.length, 0, JSON.stringify(parsed.errors));
  const field = parsed.document?.grammar.elements[0]?.fields.find((item) => item.title === "PRIORITY");
  assert.deepEqual(field?.options, ["Low", "Medium", "High"]);
  assert.equal(parsed.document?.grammar.elements[0]?.relations[0]?.reverseRole, "Refined by");
  const again = parse(textForWrite(parsed.document!));
  assert.equal(again.errors.length, 0, JSON.stringify(again.errors));
  assert.match(textForWrite(parsed.document!), /TYPE: SingleChoice\(Low, Medium, High\)/);
  assert.match(textForWrite(parsed.document!), /REVERSE_ROLE: Refined by/);
  const checked = validate(text, { mode: "write", indexComplete: true });
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((issue) => issue.code === "choice"));
});

test("sections nest and round-trip", () => {
  const text = `[DOCUMENT]
TITLE: Nest
UID: DOC-NEST

[SECTION]
TITLE: Outer
UID: SEC-1

[SECTION]
TITLE: Inner
UID: SEC-2

[REQUIREMENT]
UID: REQ-001
TITLE: Inside

[/SECTION]
[/SECTION]
`;
  const parsed = parse(text);
  assert.equal(parsed.errors.length, 0, JSON.stringify(parsed.errors));
  assert.ok(parsed.document);
  assert.equal(parsed.document.nodes[0]?.tag, "SECTION");
  assert.equal(parsed.document.nodes[0]?.children[0]?.tag, "SECTION");
  assert.equal(parsed.document.nodes[0]?.children[0]?.children[0]?.tag, "REQUIREMENT");
  const again = parse(textForWrite(parsed.document));
  assert.equal(again.errors.length, 0, JSON.stringify(again.errors));
  assert.equal(again.document?.nodes[0]?.children[0]?.children[0]?.tag, "REQUIREMENT");
  const placed = insertInside(parsed.document.nodes, "SEC-2", sectionNode("SEC-3", "Deeper", true));
  assert.equal(placed.found, true);
  assert.equal(placed.nodes[0]?.children[0]?.children[1]?.tag, "SECTION");
  const checked = validate(textForWrite({ ...parsed.document, nodes: placed.nodes }), {
    mode: "write",
    indexComplete: true,
    file: "NEST.sdoc",
  });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors, null, 2));
  assert.match(textForWrite({ ...parsed.document, nodes: placed.nodes }), /\[SECTION\][\s\S]*\[SECTION\][\s\S]*\[SECTION\]/);
});

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
