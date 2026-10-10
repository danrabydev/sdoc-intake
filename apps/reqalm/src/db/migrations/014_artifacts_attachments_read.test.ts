import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { loadConfig } from "../../config.js";
import { createMigratedPglitePool } from "../../test/pglite-pool.js";
import { testConfigEnv } from "../../test/harness.js";
import { loadDogfoodSeed, readDogfoodFile } from "../../seed/load-dogfood.js";
import { stableCapabilityArtifactId } from "../../modules/read-artifacts/artifacts.service.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const dogfoodPath = path.join(repoRoot, "docs/design/seed/dogfood.yaml");
const SHA = "d".repeat(64);
const BLOB = `blob_${SHA}`;

describe("014 artifacts attachments schema", () => {
  it("RESTRICT FKs and loader round-trip for attachments", async () => {
    const pg = await createMigratedPglitePool();
    const config = loadConfig(testConfigEnv());
    const seed = await readDogfoodFile(dogfoodPath);
    seed.file_attachments = [
      {
        id: "att_a1b2c3d4e5f6g7h8i9j0k1l2m3",
        client_id: "raby-family",
        parent_kind: "requirement_version",
        parent_uid: "CAP-ATTACH-READ",
        display_name: "mig-fixture.txt",
        versions: [
          {
            id: "attv_c3d4e5f6g7h8i9j0k1l2m3n4o5",
            version_n: 1,
            blob_id: BLOB,
            sha256: SHA,
            size_bytes: 1,
            media_type: "text/plain",
            scan_state: "clean",
            uploaded_by: "t",
          },
        ],
      },
    ];
    try {
      await loadDogfoodSeed(pg.pool, config, seed, { skipUnchangedCheck: true });
      const pool = pg.pool;
      await pool.query(
        `INSERT INTO capability_artifacts (id, project_id, requirement_version_uid, kind, uri, position) VALUES ($1, 'reqalm', 'CAP-ATTACH-READ', 'other', 't://a', 0)`,
        [stableCapabilityArtifactId("CAP-ATTACH-READ", 0)],
      );
      const reject = /violates foreign key constraint|RESTRICT/i;
      await pool.query(`INSERT INTO clients (id, name) VALUES ('fk-c', 'FK') ON CONFLICT DO NOTHING`);
      await pool.query(`INSERT INTO projects (id, client_id, name) VALUES ('fk-p', 'fk-c', 'FK') ON CONFLICT DO NOTHING`);
      await pool.query(`INSERT INTO requirement_lines (base_uid, project_id, kind, title) VALUES ('FK-L', 'fk-p', 'requirement', 'x')`);
      await pool.query(`INSERT INTO requirement_versions (uid, base_uid, project_id, version_n, status, statement) VALUES ('FK-L', 'FK-L', 'fk-p', 1, 'draft', 'x')`);
      await pool.query(
        `INSERT INTO file_attachments (id, client_id, project_id, parent_kind, parent_uid, display_name) VALUES ('att_e5f6g7h8i9j0k1l2m3n4o5p6q7', 'fk-c', 'fk-p', 'requirement_version', 'FK-L', 'x')`,
      );
      await pool.query(
        `INSERT INTO file_attachment_versions (id, attachment_id, version_n, blob_id, scan_state, uploaded_by) VALUES ('attv_f6g7h8i9j0k1l2m3n4o5p6q7r8', 'att_e5f6g7h8i9j0k1l2m3n4o5p6q7', 1, '${BLOB}', 'clean', 't')`,
      );
      await pool.query(
        `INSERT INTO capability_artifacts (id, project_id, requirement_version_uid, kind, uri, position) VALUES ($1, 'fk-p', 'FK-L', 'other', 't://p', 0)`,
        [stableCapabilityArtifactId("FK-L", 0)],
      );
      for (const sql of [
        `DELETE FROM requirement_versions WHERE uid = 'CAP-ATTACH-READ'`,
        `DELETE FROM clients WHERE id = 'fk-c'`,
        `DELETE FROM projects WHERE id = 'fk-p'`,
        `DELETE FROM file_attachments WHERE id = 'att_a1b2c3d4e5f6g7h8i9j0k1l2m3'`,
        `DELETE FROM attachment_blobs WHERE id = '${BLOB}'`,
      ]) {
        await assert.rejects(() => pool.query(sql), reject);
      }
    } finally {
      await pg.close();
    }
  });
});
