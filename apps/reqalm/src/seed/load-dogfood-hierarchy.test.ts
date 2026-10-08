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

describe("loadDogfoodSeed hierarchy", () => {
  it("rejects a parent line from another project", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    const seed = seedOf([
      ["ROOT-A", null, "Root A"],
      ["OTHER-ROOT", null, "Other"],
    ]);
    seed.projects.push({ id: "p2", client_id: "c1", name: "P2" });
    seed.requirement_lines!.find((l) => l.base_uid === "OTHER-ROOT")!.project_id = "p2";
    seed.requirement_lines!.push({
      base_uid: "BAD-CHILD",
      project_id: "p1",
      parent: "OTHER-ROOT",
      kind: "requirement",
      title: "cross",
    });
    seed.requirement_versions!.push({
      uid: "BAD-CHILD",
      base_uid: "BAD-CHILD",
      project_id: "p1",
      version_n: 0,
      status: "active",
      statement: "x",
    });
    try {
      await assert.rejects(
        () => loadDogfoodSeed(pg.pool, config, seed, { skipUnchangedCheck: true }),
        (err: unknown) => err instanceof SeedValidationError && /OTHER-ROOT/.test(String(err)),
      );
    } finally {
      await pg.close();
    }
  });

  it("persists sibling_order from yaml sequence", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    const seed = seedOf([
      ["FIX-ORD-P", null, "P"],
      ["FIX-ORD-2", "FIX-ORD-P", "second"],
      ["FIX-ORD-1", "FIX-ORD-P", "first"],
    ]);
    seed.requirement_lines!.find((l) => l.base_uid === "FIX-ORD-P")!.kind = "section";
    try {
      await loadDogfoodSeed(pg.pool, config, seed, { skipUnchangedCheck: true });
      const rows = await pg.pool.query<{ base_uid: string; sibling_order: number }>(
        `SELECT base_uid, sibling_order FROM requirement_lines WHERE parent = 'FIX-ORD-P' ORDER BY sibling_order`,
      );
      assert.deepEqual(rows.rows.map((r) => r.base_uid), ["FIX-ORD-2", "FIX-ORD-1"]);
      assert.deepEqual(rows.rows.map((r) => r.sibling_order), [0, 1]);
    } finally {
      await pg.close();
    }
  });

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
      await loadDogfoodSeed(pg.pool, config, seedOf([["P", null, "p"], ["K1", "P", "one"], ["K2", "P", "two"]]));
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

  it("rejects parent cycles in the seed (2-node and 40-node ring)", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    const ring40 = seedOf(
      Array.from({ length: 40 }, (_, i) => [`R${i}`, `R${(i + 1) % 40}`, `t${i}`] as [string, string, string]),
    );
    try {
      for (const seed of [seedOf([["A", "B", "a"], ["B", "A", "b"]]), ring40]) {
        await assert.rejects(
          () => loadDogfoodSeed(pg.pool, config, seed, { skipUnchangedCheck: true }),
          (e: unknown) => e instanceof SeedValidationError && /parent cycle detected/.test(String(e)),
        );
      }
    } finally {
      await pg.close();
    }
  });
});
