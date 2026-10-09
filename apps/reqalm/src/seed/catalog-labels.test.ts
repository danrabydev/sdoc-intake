import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSdocControlFields } from "./catalog-labels.js";

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs/design/seed");

describe("readSdocControlFields", () => {
  it("extracts title and statement for requested UIDs only", async () => {
    const fields = await readSdocControlFields(
      path.join(seedDir, "catalog/nist-800-53.sdoc"),
      new Set(["AC-3", "NO-SUCH-UID"]),
    );
    assert.equal(fields.size, 1);
    assert.match(fields.get("AC-3")!.title, /Access Enforcement/);
    assert.ok(fields.get("AC-3")!.statement);
  });
});
