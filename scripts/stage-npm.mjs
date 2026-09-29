#!/usr/bin/env node
/**
 * Stage a dependency-free package in release/ for `npm publish`.
 * The repo package stays private because the preview app pulls Vite and React.
 * The published CLI is one server file plus the built client.
 */
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const release = join(root, "release");
rmSync(release, { recursive: true, force: true });
mkdirSync(release, { recursive: true });
cpSync(join(root, "dist", "cli.js"), join(release, "cli.js"));
cpSync(join(root, "dist", "client"), join(release, "client"), { recursive: true });
cpSync(join(root, "README.md"), join(release, "README.md"));
cpSync(join(root, "LICENSE"), join(release, "LICENSE"));
chmodSync(join(release, "cli.js"), 0o755);
writeFileSync(
  join(release, "package.json"),
  JSON.stringify(
    {
      name: "sdoc-intake",
      version: pkg.version,
      description: pkg.description,
      license: "MIT",
      author: pkg.author,
      type: "module",
      bin: { "sdoc-intake": "./cli.js" },
      files: ["cli.js", "client", "README.md", "LICENSE"],
      engines: { node: ">=22" },
      repository: pkg.repository,
      keywords: ["strictdoc", "sdoc", "requirements"],
    },
    null,
    2,
  ) + "\n",
);
console.log(`Staged ${release}`);
