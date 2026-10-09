import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSdocTitles } from "./catalog-labels.js";

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs/design/seed");

describe("readSdocTitles", () => {
  it("extracts TITLE lines for requested UIDs only", async () => {
    const titles = await readSdocTitles(
      path.join(seedDir, "catalog/nist-800-53.sdoc"),
      new Set(["AC-3", "NO-SUCH-UID"]),
    );
    assert.equal(titles.size, 1);
    assert.match(titles.get("AC-3") ?? "", /Access Enforcement/);
  });
});
