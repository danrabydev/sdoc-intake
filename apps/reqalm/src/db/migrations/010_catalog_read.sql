-- Catalog read API: metadata columns + project ownership FK.

ALTER TABLE catalog_defs ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

ALTER TABLE catalog_imprints ADD COLUMN IF NOT EXISTS version_label TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_imprints ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE catalog_item_labels ADD COLUMN IF NOT EXISTS family TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_item_labels ADD COLUMN IF NOT EXISTS statement TEXT;

DO $$
BEGIN
  ALTER TABLE catalog_defs
    ADD CONSTRAINT catalog_defs_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
