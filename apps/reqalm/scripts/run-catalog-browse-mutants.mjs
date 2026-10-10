#!/usr/bin/env node
/**
 * Manual mutation gate for browse-catalogs.js — runs catalog browse tests against each mutant.
 * Exit 0 only when every mutant is killed (tests fail). Survivors are listed on stdout.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(root, "..");
const srcPath = path.join(appRoot, "src/web/public/browse-catalogs.js");
const original = fs.readFileSync(srcPath, "utf8");

/** @type {Array<{ id: string, desc: string, apply: (s: string) => string }>} */
const mutants = [
  {
    id: "M1-skip-control-id-validation",
    desc: "renderCatalogImprintDetail links rows even when catalogControlHref is null",
    apply: (s) =>
      s.replace(
        "controlHref\n            ? el(\"a\", { href: controlHref, text: ctrl.id })\n            : el(\"span\", { text: ctrl.id ?? \"—\" }),",
        "el(\"a\", { href: controlHref || \"/app/evil\", text: ctrl.id }),",
      ),
  },
  {
    id: "M2-no-published-imprint-preference",
    desc: "pickPrimaryImprint returns first imprint only",
    apply: (s) => s.replace("const published = imprints.find((i) => i.status === \"published\");\n  return published ?? imprints[0];", "return imprints[0];"),
  },
  {
    id: "M3-no-encode-catalog-id",
    desc: "Drop encodeURIComponent on catalogId in imprint href",
    apply: (s) => s.replace(
      "/catalogs/${encodeURIComponent(catalogId)}/imprints/",
      "/catalogs/${catalogId}/imprints/",
    ),
  },
  {
    id: "M4-skip-project-slug-guard-list",
    desc: "renderCatalogsList skips isValidSlugId guard",
    apply: (s) => s.replace("if (!isValidSlugId(projectId)) return renderNotFound(container);\n  const listPath = catalogsApiPath(projectId);", "const listPath = catalogsApiPath(projectId);"),
  },
  {
    id: "M5-family-sort-desc",
    desc: "Reverse family sort order",
    apply: (s) => s.replace("a.localeCompare(b)", "b.localeCompare(a)"),
  },
  {
    id: "M6-error-as-not-found",
    desc: "Treat API error as not-found copy instead of load error",
    apply: (s) => s.replace("if (result.kind === \"error\") return renderLoadError(container);", "if (result.kind === \"error\") return renderNotFound(container);"),
  },
  {
    id: "M7-auth-still-renders",
    desc: "Render empty h1 on auth instead of leaving container blank",
    apply: (s) => s.replace("if (result.kind === \"auth\") return;", "if (result.kind === \"auth\") { container.append(el(\"h1\", { text: \"Auth leak\" })); return; }"),
  },
  {
    id: "M8-invalid-catalog-still-links",
    desc: "Link catalog title even when catalog id invalid",
    apply: (s) => s.replace(
      "if (href && imprint && isValidCatalogId(cat.id) && isValidImprintId(imprint.id)) {",
      "if (href && imprint) {",
    ),
  },
  {
    id: "M9-conforming-capability-as-requirement",
    desc: "linePeerKind always returns requirement",
    apply: (s) => s.replace(
      "return typeof lineId === \"string\" && lineId.startsWith(\"CAP-\") ? \"capability\" : \"requirement\";",
      "return \"requirement\";",
    ),
  },
  {
    id: "M10-empty-catalogs-show-table",
    desc: "Skip empty-state early return on catalog list",
    apply: (s) => s.replace(
      "if (!catalogs.length) {\n    container.append(el(\"p\", { className: \"empty-state\", text: \"No catalogs visible for this project.\" }));\n    return;\n  }",
      "if (!catalogs.length) { /* mutant: no empty state */ }",
    ),
  },
];

function runTests() {
  return spawnSync(
    "node",
    [
      "--import",
      "tsx",
      "--import",
      "./src/test/otel-preload.ts",
      "--test",
      "--test-name-pattern=catalog browse",
      "src/web/browse-ui.test.ts",
    ],
    { cwd: appRoot, encoding: "utf8" },
  );
}

const survivors = [];
const killed = [];

for (const m of mutants) {
  const mutated = m.apply(original);
  if (mutated === original) {
    survivors.push({ ...m, reason: "apply() made no change" });
    continue;
  }
  fs.writeFileSync(srcPath, mutated, "utf8");
  const result = runTests();
  const testsFailed = result.status !== 0;
  if (testsFailed) killed.push(m.id);
  else survivors.push({ id: m.id, desc: m.desc, reason: "catalog browse tests still passed" });
}

fs.writeFileSync(srcPath, original, "utf8");

console.log(JSON.stringify({ killed, survivors, total: mutants.length }, null, 2));
process.exit(survivors.length ? 1 : 0);
