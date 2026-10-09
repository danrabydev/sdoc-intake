import { readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";

const TITLE_AFTER_UID = /^UID: ([^\n]+)\nTITLE: ([^\n]+)/gm;
const REQ_BLOCK =
  /\[REQUIREMENT\]\r?\nUID: ([^\r\n]+)\r?\n(?:TITLE: ([^\r\n]*)\r?\n)?(?:STATEMENT: >>>\r?\n([\s\S]*?)\r?\n<<<)?/g;

export type CatalogSeedRow = {
  id: string;
  title?: string;
  is_standard?: boolean;
  project_id?: string | null;
  entries?: Array<{ id: string; title: string }>;
  sdoc_path?: string;
  current_imprint_id?: string;
};

export type CatalogImprintSeedRow = {
  id: string;
  catalog_id: string;
  library_revision?: string;
  status?: string;
};

function itemFamily(uid: string): string {
  if (/^V-\d+$/.test(uid)) return "STIG";
  const m = /^([A-Z]{1,4})-\d/.exec(uid);
  return m?.[1] ?? "";
}

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

export async function readSdocControlFields(
  sdocPath: string,
  wanted: ReadonlySet<string>,
): Promise<Map<string, { title: string; statement: string | null }>> {
  const out = new Map<string, { title: string; statement: string | null }>();
  if (wanted.size === 0) return out;
  const raw = await readFile(sdocPath, "utf8");
  let m: RegExpExecArray | null;
  REQ_BLOCK.lastIndex = 0;
  while ((m = REQ_BLOCK.exec(raw)) !== null) {
    const uid = m[1]!.trim();
    if (!wanted.has(uid)) continue;
    const title = (m[2]?.trim() || uid).trim();
    const statement = m[3] != null ? m[3].trim() : null;
    out.set(uid, { title, statement });
    if (out.size === wanted.size) break;
  }
  return out;
}

async function upsertItemLabel(
  client: pg.PoolClient,
  catalogId: string,
  itemUid: string,
  title: string,
  statement: string | null = null,
): Promise<void> {
  await client.query(
    `INSERT INTO catalog_item_labels (catalog_id, item_uid, title, family, statement)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (catalog_id, item_uid) DO UPDATE SET
       title = EXCLUDED.title,
       family = EXCLUDED.family,
       statement = COALESCE(EXCLUDED.statement, catalog_item_labels.statement)`,
    [catalogId, itemUid, title, itemFamily(itemUid), statement],
  );
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
      `INSERT INTO catalog_defs (id, is_standard, project_id, title)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         is_standard = EXCLUDED.is_standard,
         project_id = EXCLUDED.project_id,
         title = EXCLUDED.title`,
      [c.id, c.is_standard === true, c.project_id ?? null, c.title ?? c.id],
    );
    for (const e of c.entries ?? []) {
      await upsertItemLabel(client, c.id, e.id, e.title);
    }
    const imprintId = c.current_imprint_id;
    const wanted = imprintId ? conformsItemUids.get(imprintId) : undefined;
    if (c.sdoc_path && wanted && wanted.size > 0) {
      const abs = path.join(seedDir, c.sdoc_path);
      const fields = await readSdocControlFields(abs, wanted);
      for (const [itemUid, meta] of fields) {
        await upsertItemLabel(client, c.id, itemUid, meta.title, meta.statement);
      }
      const titlesOnly = await readSdocTitles(abs, wanted);
      for (const [itemUid, title] of titlesOnly) {
        if (fields.has(itemUid)) continue;
        await upsertItemLabel(client, c.id, itemUid, title);
      }
    }
  }
  for (const imp of imprints) {
    const versionLabel = imp.library_revision ?? imp.id;
    await client.query(
      `INSERT INTO catalog_imprints (id, catalog_id, version_label, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         catalog_id = EXCLUDED.catalog_id,
         version_label = EXCLUDED.version_label,
         status = EXCLUDED.status`,
      [imp.id, imp.catalog_id, versionLabel, imp.status ?? "draft"],
    );
  }
}
