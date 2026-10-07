#!/usr/bin/env node
// tsc only emits .js; copy runtime assets (SQL migrations, static web root) next to the compiled code
// so `node dist/main.js` (the Docker app target) finds them at the same relative paths as `tsx src/main.ts`.
import { cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const rel of ["db/migrations", "web/public"]) {
  cpSync(path.join(appRoot, "src", rel), path.join(appRoot, "dist", rel), {
    recursive: true,
  });
}
