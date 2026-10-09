import { readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";

const TITLE_AFTER_UID = /^UID: ([^\n]+)\nTITLE: ([^\n]+)/gm;

export type CatalogSeedRow = {
  id: string;
  is_standard?: boolean;
  project_id?: string | null;
  entries?: Array<{ id: string; title: string }>;
  sdoc_path?: string;
  current_imprint_id?: string;
};

export type CatalogImprintSeedRow = {
  id: string;
  catalog_id: string;
};

/** Parse StrictDoc UID/TITLE pairs for the requested UIDs only (single pass). */
export async function readSdocTitles(
  sdocPath: string,
  wanted: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (wanted.size === 0) return out;
  const raw = await readFile(sdocPath, "utf8");
  let m: RegExpExecArray | null;
  TITLE_AFTER_UID.lastIndex = 0;
  while ((m = TITLE_AFTER_UID.exec(raw)) !== null) {
    const uid = m[1]!.trim();
    if (!wanted.has(uid)) continue;
    out.set(uid, m[2]!.trim());
    if (out.size === wanted.size) break;
  }
  return out;
}

export async function upsertCatalogMetadata(
  client: pg.PoolClient,
  seedDir: string,
  catalogs: CatalogSeedRow[],
  imprints: CatalogImprintSeedRow[],
  conformsItemUids: Map<string, Set<string>>,
): Promise<void> {
  for (const c of catalogs) {
    await client.query(
      `INSERT INTO catalog_defs (id, is_standard, project_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         is_standard = EXCLUDED.is_standard,
         project_id = EXCLUDED.project_id`,
      [c.id, c.is_standard === true, c.project_id ?? null],
    );
    for (const e of c.entries ?? []) {
      await client.query(
        `INSERT INTO catalog_item_labels (catalog_id, item_uid, title)
         VALUES ($1, $2, $3)
         ON CONFLICT (catalog_id, item_uid) DO UPDATE SET title = EXCLUDED.title`,
        [c.id, e.id, e.title],
      );
    }
    const imprintId = c.current_imprint_id;
    const wanted = imprintId ? conformsItemUids.get(imprintId) : undefined;
    if (c.sdoc_path && wanted && wanted.size > 0) {
      const titles = await readSdocTitles(path.join(seedDir, c.sdoc_path), wanted);
      for (const [itemUid, title] of titles) {
        await client.query(
          `INSERT INTO catalog_item_labels (catalog_id, item_uid, title)
           VALUES ($1, $2, $3)
           ON CONFLICT (catalog_id, item_uid) DO UPDATE SET title = EXCLUDED.title`,
          [c.id, itemUid, title],
        );
      }
    }
  }
  for (const imp of imprints) {
    await client.query(
      `INSERT INTO catalog_imprints (id, catalog_id)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET catalog_id = EXCLUDED.catalog_id`,
      [imp.id, imp.catalog_id],
    );
  }
}
