import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";
import { loadConfig } from "../config.js";
import { createMigratedPglitePool } from "../test/pglite-pool.js";
import { testConfigEnv } from "../test/harness.js";
import { SeedValidationError, loadDogfoodSeed, readDogfoodFile, type DogfoodSeed } from "./load-dogfood.js";

const dogfoodPath = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
  "docs/design/seed/dogfood.yaml",
);

async function withPool(run: (pool: Awaited<ReturnType<typeof createMigratedPglitePool>>["pool"]) => Promise<void>) {
  const pg = await createMigratedPglitePool();
  try {
    await run(pg.pool);
  } finally {
    await pg.close();
  }
}

function planningSeed(extra: Partial<DogfoodSeed> = {}): DogfoodSeed {
  return {
    client: { id: "c1", name: "C1" },
    projects: [
      { id: "p1", client_id: "c1", name: "P1" },
      { id: "p2", client_id: "c1", name: "P2" },
    ],
    identities: [
      { id: "auth1", external_sub: "sub-auth1", email: "auth1@dev.local", display_name: "Auth One" },
    ],
    project_grants: [],
    requirement_lines: [
      { base_uid: "REQ-P1", project_id: "p1", kind: "requirement", title: "P1 req" },
      { base_uid: "REQ-P2", project_id: "p2", kind: "requirement", title: "P2 req" },
    ],
    requirement_versions: [
      { uid: "REQ-P1", base_uid: "REQ-P1", project_id: "p1", version_n: 0, status: "active", statement: "s1" },
      { uid: "REQ-P2", base_uid: "REQ-P2", project_id: "p2", version_n: 0, status: "active", statement: "s2" },
    ],
    ...extra,
  };
}

function expectSeedValidation(run: () => Promise<unknown>, needle: RegExp) {
  return assert.rejects(run, (e) => e instanceof SeedValidationError && needle.test(String(e)));
}

describe("dogfood planning loader", () => {
  it("loads planning tables and enforces id + FK rules", async () => {
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(dogfoodPath);
    const parent = (parseYaml(readFileSync(dogfoodPath, "utf8")) as { change_sets?: { id: string }[] }).change_sets?.find(
      (c) => c.id === "cs-sdlc-r1-security-review",
    )?.id;
    assert.ok(parent);
    await withPool(async (pool) => {
      await loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true });
      const count = async (t: string) => (await pool.query(`SELECT count(*)::int AS c FROM ${t} WHERE project_id = 'reqalm'`)).rows[0]?.c;
      assert.equal(await count("iterations"), 3);
      assert.equal(await count("change_sets"), 5);
      assert.equal(await count("work_item_links"), 2);
      await assert.rejects(() => pool.query(`DELETE FROM change_sets WHERE id = $1`, [parent]), /restrict/i);
      await expectSeedValidation(
        () =>
          loadDogfoodSeed(pool, config, {
            ...planningSeed(),
            iterations: [{ id: "Bad_ID", project_id: "p1", name: "x" }],
          }),
        /iteration Bad_ID: invalid id/,
      );
    });
  });

  it("rejects invalid change_set id", async () => {
    const config = loadConfig(testConfigEnv());
    await withPool(async (pool) => {
      await expectSeedValidation(
        () =>
          loadDogfoodSeed(
            pool,
            config,
            planningSeed({
              change_sets: [
                {
                  id: "Bad_ID",
                  project_id: "p1",
                  kind: "leaf",
                  scope: "project",
                  status: "open",
                  opened_by: "auth1",
                  opened_at: "2026-01-01T00:00:00Z",
                },
              ],
            }),
            { skipUnchangedCheck: true },
          ),
        /change_set Bad_ID: invalid id/,
      );
    });
  });

  it("rejects invalid work_item_link id", async () => {
    const config = loadConfig(testConfigEnv());
    await withPool(async (pool) => {
      await expectSeedValidation(
        () =>
          loadDogfoodSeed(
            pool,
            config,
            planningSeed({
              work_item_links: [
                {
                  id: "Bad_ID",
                  project_id: "p1",
                  requirement_version_uid: "REQ-P1",
                  devops_id: "ADO-1",
                },
              ],
            }),
            { skipUnchangedCheck: true },
          ),
        /work_item_link Bad_ID: invalid id/,
      );
    });
  });

  it("rejects unknown requirement_version_uid on work_item_link", async () => {
    const config = loadConfig(testConfigEnv());
    await withPool(async (pool) => {
      await expectSeedValidation(
        () =>
          loadDogfoodSeed(
            pool,
            config,
            planningSeed({
              work_item_links: [
                {
                  id: "wil-missing-ver",
                  project_id: "p1",
                  requirement_version_uid: "NO-SUCH-VERSION",
                  devops_id: "ADO-1",
                },
              ],
            }),
            { skipUnchangedCheck: true },
          ),
        /unknown requirement_version_uid NO-SUCH-VERSION/,
      );
    });
  });

  it("stores work_item_link project_id from the version row, not YAML project_id", async () => {
    const config = loadConfig(testConfigEnv());
    await withPool(async (pool) => {
      await loadDogfoodSeed(
        pool,
        config,
        planningSeed({
          work_item_links: [
            {
              id: "wil-cross-pin",
              project_id: "p1",
              requirement_version_uid: "REQ-P2",
              devops_id: "ADO-99",
            },
          ],
        }),
        { skipUnchangedCheck: true },
      );
      const row = await pool.query<{ project_id: string }>(
        `SELECT project_id FROM work_item_links WHERE id = 'wil-cross-pin'`,
      );
      assert.equal(row.rows[0]?.project_id, "p2");
    });
  });

  it("rejects change_set parent cycle", async () => {
    const config = loadConfig(testConfigEnv());
    await withPool(async (pool) => {
      await expectSeedValidation(
        () =>
          loadDogfoodSeed(
            pool,
            config,
            planningSeed({
              change_sets: [
                {
                  id: "cs-a",
                  project_id: "p1",
                  kind: "leaf",
                  parent_id: "cs-b",
                  scope: "project",
                  status: "open",
                  opened_by: "auth1",
                  opened_at: "2026-01-01T00:00:00Z",
                },
                {
                  id: "cs-b",
                  project_id: "p1",
                  kind: "leaf",
                  parent_id: "cs-a",
                  scope: "project",
                  status: "open",
                  opened_by: "auth1",
                  opened_at: "2026-01-01T01:00:00Z",
                },
              ],
            }),
            { skipUnchangedCheck: true },
          ),
        /unresolved parent_id ordering/,
      );
    });
  });

  it("rejects change_set with missing parent row", async () => {
    const config = loadConfig(testConfigEnv());
    await withPool(async (pool) => {
      await assert.rejects(
        () =>
          loadDogfoodSeed(
            pool,
            config,
            planningSeed({
              change_sets: [
                {
                  id: "cs-orphan",
                  project_id: "p1",
                  kind: "leaf",
                  parent_id: "cs-not-in-seed",
                  scope: "project",
                  status: "open",
                  opened_by: "auth1",
                  opened_at: "2026-01-01T00:00:00Z",
                },
              ],
            }),
            { skipUnchangedCheck: true },
          ),
        (e) =>
          (e instanceof SeedValidationError && /unresolved parent_id ordering/.test(String(e))) ||
          /change_sets_parent_id_fkey|foreign key|restrict/i.test(String(e)),
      );
    });
  });

  it("loads change_sets when child is listed before parent in YAML", async () => {
    const config = loadConfig(testConfigEnv());
    await withPool(async (pool) => {
      await loadDogfoodSeed(
        pool,
        config,
        planningSeed({
          change_sets: [
            {
              id: "cs-child-first",
              project_id: "p1",
              kind: "leaf",
              parent_id: "cs-parent-second",
              scope: "project",
              status: "closed",
              opened_by: "auth1",
              opened_at: "2026-01-02T00:00:00Z",
            },
            {
              id: "cs-parent-second",
              project_id: "p1",
              kind: "sdlc_parent",
              scope: "project",
              status: "open",
              opened_by: "auth1",
              opened_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        { skipUnchangedCheck: true },
      );
      const parent = await pool.query(`SELECT 1 FROM change_sets WHERE id = 'cs-parent-second'`);
      const child = await pool.query<{ parent_id: string }>(
        `SELECT parent_id FROM change_sets WHERE id = 'cs-child-first'`,
      );
      assert.equal(parent.rowCount, 1);
      assert.equal(child.rows[0]?.parent_id, "cs-parent-second");
    });
  });

  it("defaults change_set scope to project when omitted in YAML", async () => {
    const config = loadConfig(testConfigEnv());
    await withPool(async (pool) => {
      await loadDogfoodSeed(
        pool,
        config,
        planningSeed({
          change_sets: [
            {
              id: "cs-no-scope",
              project_id: "p1",
              kind: "leaf",
              status: "open",
              opened_by: "auth1",
              opened_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        { skipUnchangedCheck: true },
      );
      const row = await pool.query<{ scope: string }>(`SELECT scope FROM change_sets WHERE id = 'cs-no-scope'`);
      assert.equal(row.rows[0]?.scope, "project");
    });
  });
});
