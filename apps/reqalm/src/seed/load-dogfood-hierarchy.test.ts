import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../config.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";
import { testConfigEnv } from "../test/harness.js";
import {
  SeedValidationError,
  loadDogfoodSeed,
  type DogfoodSeed,
} from "./load-dogfood.js";

const minimalSeed = (): DogfoodSeed => ({
  client: { id: "c1", name: "C1" },
  projects: [{ id: "p1", client_id: "c1", name: "P1" }],
  identities: [],
  project_grants: [],
  requirement_lines: [
    { base_uid: "ROOT-A", project_id: "p1", parent: null, kind: "section", title: "Root A" },
    { base_uid: "CHILD-B", project_id: "p1", parent: "ROOT-A", kind: "requirement", title: "Child B" },
    { base_uid: "OTHER-ROOT", project_id: "p2", parent: null, kind: "section", title: "Other" },
  ],
  requirement_versions: [
    { uid: "ROOT-A", base_uid: "ROOT-A", project_id: "p1", version_n: 0, status: "active", statement: "a" },
    { uid: "CHILD-B", base_uid: "CHILD-B", project_id: "p1", version_n: 0, status: "active", statement: "b" },
  ],
});

describe("loadDogfoodSeed hierarchy", () => {
  it("rejects a parent line from another project", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    const seed = minimalSeed();
    seed.projects.push({ id: "p2", client_id: "c1", name: "P2" });
    seed.requirement_lines!.push({
      base_uid: "BAD-CHILD",
      project_id: "p1",
      parent: "OTHER-ROOT",
      kind: "requirement",
      title: "cross",
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
    const seed: DogfoodSeed = {
      client: { id: "c1", name: "C1" },
      projects: [{ id: "p1", client_id: "c1", name: "P1" }],
      identities: [],
      project_grants: [],
      requirement_lines: [
        { base_uid: "FIX-ORD-P", project_id: "p1", parent: null, kind: "section", title: "P" },
        { base_uid: "FIX-ORD-2", project_id: "p1", parent: "FIX-ORD-P", kind: "requirement", title: "second" },
        { base_uid: "FIX-ORD-1", project_id: "p1", parent: "FIX-ORD-P", kind: "requirement", title: "first" },
      ],
      requirement_versions: [
        { uid: "FIX-ORD-P", base_uid: "FIX-ORD-P", project_id: "p1", version_n: 0, status: "active", statement: "p" },
        { uid: "FIX-ORD-1", base_uid: "FIX-ORD-1", project_id: "p1", version_n: 0, status: "active", statement: "1" },
        { uid: "FIX-ORD-2", base_uid: "FIX-ORD-2", project_id: "p1", version_n: 0, status: "active", statement: "2" },
      ],
    };
    try {
      await loadDogfoodSeed(pg.pool, config, seed, { skipUnchangedCheck: true });
      const rows = await pg.pool.query<{ base_uid: string; sibling_order: number }>(
        `SELECT base_uid, sibling_order FROM requirement_lines WHERE parent = 'FIX-ORD-P' ORDER BY sibling_order`,
      );
      assert.deepEqual(
        rows.rows.map((r) => r.base_uid),
        ["FIX-ORD-2", "FIX-ORD-1"],
      );
      assert.deepEqual(
        rows.rows.map((r) => r.sibling_order),
        [0, 1],
      );
    } finally {
      await pg.close();
    }
  });
});
