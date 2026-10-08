import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../config.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";
import { testConfigEnv } from "../test/harness.js";
import { SeedValidationError, loadDogfoodSeed, type DogfoodSeed } from "./load-dogfood.js";

const seedOf = (lines: [string, string | null, string][]): DogfoodSeed => ({
  client: { id: "c1", name: "C1" },
  projects: [{ id: "p1", client_id: "c1", name: "P1" }],
  identities: [],
  project_grants: [],
  requirement_lines: lines.map(([base_uid, parent, title]) => ({
    base_uid,
    project_id: "p1",
    parent,
    kind: "requirement",
    title,
  })),
  requirement_versions: lines.map(([uid]) => ({
    uid,
    base_uid: uid,
    project_id: "p1",
    version_n: 0,
    status: "active",
    statement: "s",
  })),
});

describe("loadDogfoodSeed hierarchy: gap tests", () => {
  it("rejects a parent that is not a seed line", async () => {
    const pg = await createMigratedPglitePool();
    try {
      await assert.rejects(
        () =>
          loadDogfoodSeed(pg.pool, loadConfig(testConfigEnv()), seedOf([["ORPHAN", "NO-SUCH", "o"]]), {
            skipUnchangedCheck: true,
          }),
        (e: unknown) => e instanceof SeedValidationError && /parent NO-SUCH is not a line in the seed/.test(String(e)),
      );
    } finally {
      await pg.close();
    }
  });

  it("re-seed updates only sibling_order and reports no new lines", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    try {
      await loadDogfoodSeed(
        pg.pool,
        config,
        seedOf([
          ["P", null, "p"],
          ["K1", "P", "one"],
          ["K2", "P", "two"],
        ]),
      );
      const again = await loadDogfoodSeed(
        pg.pool,
        config,
        seedOf([
          ["P", null, "p"],
          ["K2", "P", "two*"],
          ["K1", null, "one*"],
        ]),
      );
      const rows = (
        await pg.pool.query<{ base_uid: string; parent: string | null; title: string; sibling_order: number }>(
          `SELECT base_uid, parent, title, sibling_order FROM requirement_lines WHERE base_uid IN ('K1','K2') ORDER BY base_uid`,
        )
      ).rows;
      assert.deepEqual(rows, [
        { base_uid: "K1", parent: "P", title: "one", sibling_order: 1 },
        { base_uid: "K2", parent: "P", title: "two", sibling_order: 0 },
      ]);
      assert.equal(again.inserted.requirement_lines, 0);
    } finally {
      await pg.close();
    }
  });

  it("rejects parent cycles in the seed", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    try {
      await assert.rejects(
        () =>
          loadDogfoodSeed(
            pg.pool,
            config,
            seedOf([
              ["A", "B", "a"],
              ["B", "A", "b"],
            ]),
            { skipUnchangedCheck: true },
          ),
        (e: unknown) => e instanceof SeedValidationError && /parent cycle detected/.test(String(e)),
      );
    } finally {
      await pg.close();
    }
  });
});
