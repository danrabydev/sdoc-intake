import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { relativeImport } from "./grammar.ts";
import { parse, parseGrammarFile } from "./parse.ts";
import { detachGrammar, textForWrite } from "./serialize.ts";
import { createFile, createGrammar, moveDocumentGrammar, readFileView, readGrammar, saveGrammar } from "./store.server.ts";
import { validate } from "./validate.ts";

test("a section grammar element is composite", () => {
  const parsed = parseGrammarFile(`[GRAMMAR]
ELEMENTS:
- TAG: SECTION
  PROPERTIES:
    IS_COMPOSITE: True
  FIELDS:
  - TITLE: TITLE
    TYPE: String
    REQUIRED: True
`);
  assert.equal(parsed.errors.length, 0, JSON.stringify(parsed.errors));
  assert.equal(parsed.grammar?.elements[0]?.composite, true);
  const written = textForWrite({
    title: "Nest",
    grammar: { explicit: true, elements: parsed.grammar!.elements },
    nodes: [],
  });
  assert.match(written, /TAG: SECTION\n  PROPERTIES:\n    IS_COMPOSITE: True/);
  const blocked = validate(`[DOCUMENT]
TITLE: Flat

[GRAMMAR]
ELEMENTS:
- TAG: SECTION
  PROPERTIES:
    IS_COMPOSITE: False
  FIELDS:
  - TITLE: TITLE
    TYPE: String
    REQUIRED: True

[[SECTION]]
TITLE: Nested
[[/SECTION]]
`);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.errors.some((issue) => issue.code === "not-composite"));
});

test("a document path imports a grammar file with a relative path", () => {
  assert.equal(relativeImport("releases/product.sdoc", "grammar/release.sgra"), "../grammar/release.sgra");
  assert.equal(relativeImport("SYS.sdoc", "grammar/org.sgra"), "grammar/org.sgra");
  assert.equal(relativeImport("SYS.sdoc", "../secret.sgra"), null);
});

test("move grammar to file keeps the elements and writes an import", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdoc-grammar-"));
  const previous = process.env.SDOC_ROOT;
  process.env.SDOC_ROOT = dir;
  try {
    await createFile({ path: "SYS.sdoc", title: "System", uid: "DOC-SYS", prefix: "SYS-", root: true });
    const before = await readFileView("SYS.sdoc");
    assert.ok(before.document);
    assert.equal(before.document.grammar.importFrom, undefined);
    const moved = await moveDocumentGrammar("SYS.sdoc", "grammar/org.sgra");
    assert.equal(moved.document?.grammar.importFrom, "grammar/org.sgra");
    assert.ok(moved.document?.grammar.elements.some((element) => element.tag === "REQUIREMENT"));
    const grammar = await readGrammar("grammar/org.sgra");
    assert.equal(grammar.ok, true);
    assert.match(grammar.text, /TAG: REQUIREMENT/);
    assert.match(await readFile(join(dir, "SYS.sdoc"), "utf8"), /IMPORT_FROM_FILE: grammar\/org\.sgra/);
    assert.doesNotMatch(await readFile(join(dir, "SYS.sdoc"), "utf8"), /TAG: REQUIREMENT/);
    const edited = await saveGrammar("grammar/org.sgra", {
      grammar: {
        explicit: true,
        elements: [
          {
            tag: "RELEASE",
            fields: [
              { title: "UID", type: "String", required: true },
              { title: "TITLE", type: "String", required: true },
              { title: "DESCRIPTION", type: "String", required: true },
            ],
            relations: [{ type: "Child", role: "Delivers" }],
          },
        ],
      },
    });
    assert.equal(edited.ok, true);
    assert.match(edited.text, /ROLE: Delivers/);
    const detached = detachGrammar(parse("[DOCUMENT]\nTITLE: Already\n\n[GRAMMAR]\nIMPORT_FROM_FILE: grammar/org.sgra\n").document!, "SYS.sdoc", "other.sgra");
    assert.ok("error" in detached);
  } finally {
    if (previous === undefined) delete process.env.SDOC_ROOT;
    else process.env.SDOC_ROOT = previous;
  }
});

test("creating a grammar file does not require a document", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdoc-sgra-"));
  const previous = process.env.SDOC_ROOT;
  process.env.SDOC_ROOT = dir;
  try {
    const created = await createGrammar("grammar/custom.sgra");
    assert.equal(created.ok, true);
    assert.match(created.text, /\[GRAMMAR\]/);
    assert.ok(created.grammar?.elements.some((element) => element.tag === "SECTION"));
  } finally {
    if (previous === undefined) delete process.env.SDOC_ROOT;
    else process.env.SDOC_ROOT = previous;
  }
});
