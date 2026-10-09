import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const dogfoodPath = path.join(repoRoot, "docs/design/seed/dogfood.yaml");

type ContractRow = { id?: string; in_scope_of?: string[] };

describe("dogfood ReqALM product vs maintenance contracts", () => {
  it("has no overlapping in_scope_of between ctr-reqalm-product and ctr-reqalm-maintenance", () => {
    const raw = parseYaml(readFileSync(dogfoodPath, "utf8")) as { contracts?: ContractRow[] };
    const byId = new Map((raw.contracts ?? []).map((c) => [c.id, c]));
    const product = byId.get("ctr-reqalm-product");
    const maintenance = byId.get("ctr-reqalm-maintenance");
    assert.ok(product?.in_scope_of?.length, "ctr-reqalm-product in_scope_of");
    assert.ok(maintenance?.in_scope_of?.length, "ctr-reqalm-maintenance in_scope_of");
    const pset = new Set(product.in_scope_of);
    const overlap = maintenance.in_scope_of.filter((u) => pset.has(u));
    assert.deepEqual(
      overlap,
      [],
      `product and maintenance contracts must not share in_scope_of UIDs; overlap=${overlap.join(", ")}`,
    );
    assert.ok(!pset.has("SYS-CYBER-UPKEEP"), "SYS-CYBER-UPKEEP belongs on maintenance track only");
    for (const uid of product.in_scope_of) {
      assert.ok(!uid.startsWith("CAP-UPKEEP-"), `product scope must exclude upkeep cap ${uid}`);
    }
  });
});
