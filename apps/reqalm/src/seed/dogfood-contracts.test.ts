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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const dogfoodPath = path.join(repoRoot, "docs/design/seed/dogfood.yaml");

type ContractRow = { id?: string; in_scope_of?: string[] };

async function withMigratedPool(run: (pool: Awaited<ReturnType<typeof createMigratedPglitePool>>["pool"]) => Promise<void>) {
  const pg = await createMigratedPglitePool();
  try {
    await run(pg.pool);
  } finally {
    await pg.close();
  }
}

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
    assert.ok(!pset.has("SYS-CYBER-UPKEEP"));
    assert.ok(product.in_scope_of.every((uid) => !uid.startsWith("CAP-UPKEEP-")));
  });

  it("excludes FIX-CAP-* fixture capabilities from ctr-reqalm-product in_scope_of", () => {
    const raw = parseYaml(readFileSync(dogfoodPath, "utf8")) as { contracts?: ContractRow[] };
    const product = (raw.contracts ?? []).find((c) => c.id === "ctr-reqalm-product");
    assert.ok(product?.in_scope_of?.length, "ctr-reqalm-product in_scope_of");
    const fixCaps = product.in_scope_of.filter((uid) => uid.startsWith("FIX-CAP-"));
    assert.deepEqual(
      fixCaps,
      [],
      `FIX-CAP-* fixtures must not be on product contract scope (browse/rollups); found=${fixCaps.join(", ")}`,
    );
  });

  it("loader persists contracts, scope, and releases from dogfood", async () => {
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(dogfoodPath);
    await withMigratedPool(async (pool) => {
      await loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true });
      assert.equal(
        (await pool.query(`SELECT count(*)::int AS c FROM contracts WHERE project_id = 'reqalm'`)).rows[0]?.c,
        7,
      );
      assert.equal(
        (await pool.query(`SELECT count(*)::int AS c FROM contract_scope WHERE contract_id = 'ctr-reqalm-maintenance'`))
          .rows[0]?.c,
        4,
      );
      const expected = (parseYaml(readFileSync(dogfoodPath, "utf8")) as { contracts?: ContractRow[] }).contracts?.find(
        (c) => c.id === "ctr-reqalm-product",
      )?.in_scope_of?.length;
      assert.equal(
        (await pool.query(`SELECT count(*)::int AS c FROM contract_scope WHERE contract_id = 'ctr-reqalm-product'`))
          .rows[0]?.c,
        expected,
      );
    });
  });

  it("loader rejects overlapping product vs maintenance in_scope_of", async () => {
    const config = loadConfig(testConfigEnv());
    const seed: DogfoodSeed = {
      client: { id: "c1", name: "C1" },
      projects: [{ id: "p1", client_id: "c1", name: "P1" }],
      identities: [],
      project_grants: [],
      requirement_lines: [{ base_uid: "R1", project_id: "p1", kind: "requirement", title: "R" }],
      requirement_versions: [
        { uid: "R1", base_uid: "R1", project_id: "p1", version_n: 0, status: "active", statement: "s" },
      ],
      contracts: [
        {
          id: "ctr-reqalm-product",
          client_id: "c1",
          project_id: "p1",
          name: "product",
          status: "active",
          in_scope_of: ["R1"],
        },
        {
          id: "ctr-reqalm-maintenance",
          client_id: "c1",
          project_id: "p1",
          name: "maint",
          status: "active",
          in_scope_of: ["R1"],
        },
      ],
    };
    await withMigratedPool(async (pool) => {
      await assert.rejects(
        () => loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true }),
        (e: unknown) => e instanceof SeedValidationError && /share in_scope_of uid R1/.test(String(e)),
      );
    });
  });

  it("loader rejects invalid contract id slug", async () => {
    const config = loadConfig(testConfigEnv());
    const seed: DogfoodSeed = {
      client: { id: "c1", name: "C1" },
      projects: [{ id: "p1", client_id: "c1", name: "P1" }],
      identities: [],
      project_grants: [],
      contracts: [{ id: "Bad_ID", client_id: "c1", project_id: "p1", name: "bad", status: "active" }],
    };
    await withMigratedPool(async (pool) => {
      await assert.rejects(
        () => loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true }),
        (e: unknown) => e instanceof SeedValidationError && /invalid contract id/.test(String(e)),
      );
    });
  });

  it("DELETE contracts RESTRICTs when contract_scope children exist", async () => {
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(dogfoodPath);
    await withMigratedPool(async (pool) => {
      await loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true });
      await assert.rejects(
        () => pool.query(`DELETE FROM contracts WHERE id = 'ctr-reqalm-maintenance'`),
        /foreign key|violates foreign key constraint/i,
      );
    });
  });

  it("DELETE contracts RESTRICTs when only contract_releases children exist", async () => {
    const config = loadConfig(testConfigEnv());
    const seed: DogfoodSeed = {
      client: { id: "c1", name: "C1" },
      projects: [{ id: "p1", client_id: "c1", name: "P1" }],
      identities: [],
      project_grants: [],
      releases: [{ id: "rel-only", project_id: "p1", name: "R", status: "planned" }],
      contracts: [
        {
          id: "ctr-rel-only",
          client_id: "c1",
          project_id: "p1",
          name: "releases only",
          status: "active",
          covers_releases: ["rel-only"],
        },
      ],
    };
    await withMigratedPool(async (pool) => {
      await loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true });
      assert.equal(
        (await pool.query(`SELECT count(*)::int AS c FROM contract_scope WHERE contract_id = 'ctr-rel-only'`)).rows[0]?.c,
        0,
      );
      assert.equal(
        (await pool.query(`SELECT count(*)::int AS c FROM contract_releases WHERE contract_id = 'ctr-rel-only'`)).rows[0]?.c,
        1,
      );
      await assert.rejects(
        () => pool.query(`DELETE FROM contracts WHERE id = 'ctr-rel-only'`),
        /foreign key|violates foreign key constraint/i,
      );
    });
  });

  it("loader accepts cross-project in_scope_of on contract anchor project (intended coverage)", async () => {
    const config = loadConfig(testConfigEnv());
    const seed: DogfoodSeed = {
      client: { id: "c1", name: "C1" },
      projects: [
        { id: "p1", client_id: "c1", name: "P1" },
        { id: "p2", client_id: "c1", name: "P2" },
      ],
      identities: [],
      project_grants: [],
      requirement_lines: [{ base_uid: "R1", project_id: "p2", kind: "requirement", title: "R" }],
      requirement_versions: [
        { uid: "R1", base_uid: "R1", project_id: "p2", version_n: 0, status: "active", statement: "s" },
      ],
      contracts: [
        { id: "ctr-cross", client_id: "c1", project_id: "p1", name: "cross", status: "active", in_scope_of: ["R1"] },
      ],
    };
    await withMigratedPool(async (pool) => {
      await loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true });
      assert.deepEqual(
        (await pool.query(`SELECT version_uid FROM contract_scope WHERE contract_id = 'ctr-cross'`)).rows.map(
          (r) => r.version_uid,
        ),
        ["R1"],
      );
    });
  });

  it("loader rejects unknown in_scope_of uid", async () => {
    const config = loadConfig(testConfigEnv());
    const seed: DogfoodSeed = {
      client: { id: "c1", name: "C1" },
      projects: [{ id: "p1", client_id: "c1", name: "P1" }],
      identities: [],
      project_grants: [],
      contracts: [
        {
          id: "ctr-bad",
          client_id: "c1",
          project_id: "p1",
          name: "bad",
          status: "active",
          in_scope_of: ["NO-SUCH-VER"],
        },
      ],
    };
    await withMigratedPool(async (pool) => {
      await assert.rejects(
        () => loadDogfoodSeed(pool, config, seed, { skipUnchangedCheck: true }),
        (e: unknown) => e instanceof SeedValidationError && String(e.message).includes("unknown in_scope_of"),
      );
    });
  });
});
