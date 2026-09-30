import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseArgs } from "./args.ts";

const cwd = mkdtempSync(join(tmpdir(), "sdoc-cli-"));
mkdirSync(join(cwd, "docs"));
writeFileSync(join(cwd, "docs", "SYS.sdoc"), "[DOCUMENT]\nTITLE: Sys\n");
writeFileSync(join(cwd, "notes.txt"), "nope");

test("no path uses the current directory", () => {
  const result = parseArgs([], cwd);
  assert.equal(result.ok, true);
  if (!result.ok || !("args" in result)) return;
  assert.equal(result.args.root, cwd);
  assert.equal(result.args.openFile, null);
  assert.equal(result.args.port, 8087);
  assert.equal(result.args.host, "127.0.0.1");
  assert.equal(result.args.watch, true);
});

test("a directory is the document root", () => {
  const result = parseArgs(["docs"], cwd);
  assert.equal(result.ok, true);
  if (!result.ok || !("args" in result)) return;
  assert.equal(result.args.root, join(cwd, "docs"));
  assert.equal(result.args.openFile, null);
});

test("a .sdoc file opens that file and uses its folder", () => {
  const result = parseArgs([join(cwd, "docs", "SYS.sdoc"), "--port", "4321", "--no-watch"], cwd);
  assert.equal(result.ok, true);
  if (!result.ok || !("args" in result)) return;
  assert.equal(result.args.root, join(cwd, "docs"));
  assert.equal(result.args.openFile, "SYS.sdoc");
  assert.equal(result.args.port, 4321);
  assert.equal(result.args.watch, false);
});

test("--root replaces the positional path", () => {
  const result = parseArgs(["--root", "docs", "--host", "0.0.0.0"], cwd);
  assert.equal(result.ok, true);
  if (!result.ok || !("args" in result)) return;
  assert.equal(result.args.root, join(cwd, "docs"));
  assert.equal(result.args.host, "0.0.0.0");
});

test("rejects a missing path, a non-sdoc file, and two paths", () => {
  const missing = parseArgs(["missing"], cwd);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /not found/);
  const text = parseArgs(["notes.txt"], cwd);
  assert.equal(text.ok, false);
  if (!text.ok) assert.match(text.error, /\.sdoc/);
  const both = parseArgs(["docs", "notes.txt"], cwd);
  assert.equal(both.ok, false);
});

test("help and version short-circuit", () => {
  assert.deepEqual(parseArgs(["--help"], cwd), { ok: true, help: true });
  assert.deepEqual(parseArgs(["-v"], cwd), { ok: true, version: true });
});
