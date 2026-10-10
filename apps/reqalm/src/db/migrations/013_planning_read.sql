CREATE TABLE IF NOT EXISTS iterations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  starts_on DATE,
  ends_on DATE
);

CREATE TABLE IF NOT EXISTS change_sets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  parent_id TEXT REFERENCES change_sets(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL DEFAULT 'project',
  status TEXT NOT NULL,
  opened_by TEXT NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  summary TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS work_item_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  requirement_version_uid TEXT NOT NULL REFERENCES requirement_versions(uid) ON DELETE RESTRICT,
  devops_id TEXT NOT NULL,
  system TEXT,
  synced_fields JSONB,
  last_sync_at TIMESTAMPTZ,
  status TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_iterations_project ON iterations(project_id);
CREATE INDEX IF NOT EXISTS idx_change_sets_project ON change_sets(project_id);
CREATE INDEX IF NOT EXISTS idx_change_sets_parent ON change_sets(parent_id);
CREATE INDEX IF NOT EXISTS idx_work_item_links_project ON work_item_links(project_id);
