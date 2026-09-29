#!/usr/bin/env node
/**
 * Collapse dist/client into dist/client/sdoc-intake.html.
 * Script and style tags are inlined. Every other build file is removed.
 */
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "dist", "client");
const files = await walk(dir);
const htmlPath = files.find((file) => file.endsWith(".html"));
if (!htmlPath) {
  console.error("No HTML file in dist/client");
  process.exit(1);
}

const text = new Map();
for (const file of files) text.set(file, await readFile(file, "utf8"));

let html = text.get(htmlPath) ?? "";
html = html.replace(/<link\b[^>]*\brel="modulepreload"[^>]*>\s*/g, "");
html = html.replace(/<link\b([^>]*?)href="([^"]+\.css)"([^>]*)>/g, (full, _pre, href) => {
  const css = built(href);
  if (css === null) return full;
  return `<style>\n${css.replace(/<\/style/gi, "<\\/style")}\n</style>`;
});
html = html.replace(/<script\b([^>]*?)\bsrc="([^"]+)"([^>]*)>\s*<\/script>/g, (full, pre, src, post) => {
  const code = built(src);
  if (code === null) return full;
  return `<script${pre}${post}>\n${code.replace(/<\/script/gi, "<\\/script")}\n</script>`;
});

const out = join(dir, "sdoc-intake.html");
await writeFile(out, html);
for (const file of files) {
  if (file !== out) await rm(file, { force: true });
}
await removeEmpty(dir);

const leftover = (await walk(dir)).filter((file) => file !== out);
if (leftover.length > 0 || /(?:src|href)="[^"]*\.js"/.test(html) || /href="[^"]*\.css"/.test(html)) {
  console.error("Single-file build still references other files.");
  console.error(leftover.join("\n"));
  process.exit(1);
}
if (html.includes("import(") && /import\(\s*["'][^"']+\.js["']/.test(html)) {
  console.error("Single-file build still dynamic-imports a separate script.");
  process.exit(1);
}
console.log(`Wrote ${relative(root, out)} (${html.length} bytes)`);

function built(url) {
  const clean = decodeURIComponent(url.split("?")[0]).replace(/^\.\//, "").replace(/^\//, "");
  return text.get(join(dir, clean)) ?? null;
}

async function walk(folder) {
  const out = [];
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

async function removeEmpty(folder) {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(folder, entry.name);
    await removeEmpty(path);
    const left = await readdir(path);
    if (left.length === 0) await rm(path, { recursive: true, force: true });
  }
}
