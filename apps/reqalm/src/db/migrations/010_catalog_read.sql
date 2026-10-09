-- Catalog read API: metadata columns + project ownership FK.

ALTER TABLE catalog_defs ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

ALTER TABLE catalog_imprints ADD COLUMN IF NOT EXISTS version_label TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_imprints ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE catalog_item_labels ADD COLUMN IF NOT EXISTS family TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_item_labels ADD COLUMN IF NOT EXISTS statement TEXT;

UPDATE catalog_defs SET project_id = NULL
WHERE project_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = catalog_defs.project_id);

ALTER TABLE catalog_defs DROP CONSTRAINT IF EXISTS catalog_defs_project_id_fkey;

ALTER TABLE catalog_defs
  ADD CONSTRAINT catalog_defs_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) NOT VALID;

ALTER TABLE catalog_defs VALIDATE CONSTRAINT catalog_defs_project_id_fkey;
