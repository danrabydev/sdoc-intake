-- Trace edges from dogfood seed (line/version UIDs + catalog ConformsTo pins).

CREATE TABLE IF NOT EXISTS catalog_defs (
  id TEXT PRIMARY KEY,
  is_standard BOOLEAN NOT NULL DEFAULT false,
  project_id TEXT
);

CREATE TABLE IF NOT EXISTS catalog_imprints (
  id TEXT PRIMARY KEY,
  catalog_id TEXT NOT NULL REFERENCES catalog_defs(id)
);

CREATE TABLE IF NOT EXISTS catalog_item_labels (
  catalog_id TEXT NOT NULL REFERENCES catalog_defs(id),
  item_uid TEXT NOT NULL,
  title TEXT NOT NULL,
  PRIMARY KEY (catalog_id, item_uid)
);

CREATE TABLE IF NOT EXISTS trace_edges (
  from_uid TEXT NOT NULL,
  to_uid TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('conforms_to', 'uses', 'satisfies', 'refines')),
  catalog_imprint_id TEXT NOT NULL DEFAULT '',
  trace_suspect BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (from_uid, to_uid, kind, catalog_imprint_id)
);

CREATE INDEX IF NOT EXISTS idx_trace_edges_from ON trace_edges (from_uid);
CREATE INDEX IF NOT EXISTS idx_trace_edges_to ON trace_edges (to_uid);
