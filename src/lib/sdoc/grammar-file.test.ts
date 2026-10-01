import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { elementLinks, fallbackTag, relativeImport, tagLabel } from "./grammar.ts";
import { fieldOf, grammarNode, insertRelative, removeAt, selectionKey } from "./model.ts";
import { parse, parseGrammarFile } from "./parse.ts";
import { detachGrammar, textForWrite } from "./serialize.ts";
import { createFile, createGrammar, moveDocumentGrammar, readFileView, readGrammar, saveGrammar } from "./store.server.ts";
import { validate } from "./validate.ts";

test("a grammar node uses the element, including composite and required fields", () => {
  const release = grammarNode(
    {
      tag: "RELEASE",
      fields: [
        { title: "UID", type: "String", required: true },
        { title: "TITLE", type: "String", required: true },
        { title: "VERSION", type: "String", required: true },
        { title: "CHANNEL", type: "SingleChoice", required: true, options: ["upkeep", "maintenance"] },
        { title: "DESCRIPTION", type: "String", required: true },
        { title: "STATUS", type: "SingleChoice", required: true, options: ["planned", "shipped", "deprecated"] },
        { title: "DATE", type: "String", required: false },
      ],
      relations: [{ type: "Child", role: "Delivers" }],
    },
    "REL-1",
    false,
  );
  assert.equal(release.tag, "RELEASE");
  assert.equal(release.composite, false);
  assert.equal(fieldOf(release, "UID"), "REL-1");
  assert.equal(fieldOf(release, "TITLE"), "New Release");
  assert.equal(fieldOf(release, "VERSION"), "New");
  assert.equal(fieldOf(release, "CHANNEL"), "upkeep");
  assert.equal(fieldOf(release, "DESCRIPTION"), "New.");
  assert.equal(fieldOf(release, "STATUS"), "planned");
  assert.equal(fieldOf(release, "DATE"), "");

  const section = grammarNode(
    {
      tag: "SECTION",
      composite: true,
      fields: [
        { title: "UID", type: "String", required: false },
        { title: "TITLE", type: "String", required: true },
      ],
      relations: [],
    },
    "SEC-1",
    true,
  );
  assert.equal(section.composite, true);
  assert.equal(section.legacy, true);

  const text = grammarNode(
    { tag: "TEXT", fields: [{ title: "STATEMENT", type: "String", required: true }], relations: [] },
    "",
    false,
  );
  assert.equal(fieldOf(text, "UID"), "");
  assert.equal(fieldOf(text, "STATEMENT"), "New.");
  assert.equal(text.composite, false);
  const nested = insertRelative([section], [0], text, "inside");
  assert.equal(nested[0]?.children[0]?.tag, "TEXT");
  assert.equal(selectionKey(nested[0]!.children[0]!, [0, 0]), "#0.0");
  const removed = removeAt(nested, [0, 0]);
  assert.equal(removed[0]?.children.length, 0);
});

test("links keep the grammar relation type and skip a bare parent when a role exists", () => {
  const release = elementLinks(
    [{ tag: "RELEASE", fields: [], relations: [{ type: "Child", role: "Delivers" }] }],
    "RELEASE",
  );
  assert.deepEqual(release, [{ type: "Child", role: "Delivers" }]);
  const requirement = elementLinks(
    [
      {
        tag: "REQUIREMENT",
        fields: [],
        relations: [
          { type: "Parent" },
          { type: "Child" },
          { type: "Parent", role: "Refines" },
          { type: "Parent", role: "ConformsTo" },
        ],
      },
    ],
    "REQUIREMENT",
  );
  assert.deepEqual(requirement, [
    { type: "Parent", role: "Refines" },
    { type: "Parent", role: "ConformsTo" },
  ]);
  assert.equal(tagLabel("RELEASE"), "Release");
  assert.equal(fallbackTag(["TEXT", "SECTION", "RELEASE"], ["REQUIREMENT", "RELEASE", "SECTION"]), "RELEASE");
  assert.equal(fallbackTag(["TEXT", "SECTION", "REQUIREMENT"], ["REQUIREMENT", "RELEASE", "SECTION"]), "REQUIREMENT");
});

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
