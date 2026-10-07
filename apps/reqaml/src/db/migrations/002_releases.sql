-- Releases (one PR = one release in the dogfood seed) and their delivers junction.
-- A release is a snapshot junction over requirement version UIDs, not a tree parent.

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  planned_on DATE,
  shipped_on DATE,
  cyber_gate BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  -- Order in the seed file (release sequence); summary lists releases in this order.
  position INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS release_delivers (
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  version_uid TEXT NOT NULL REFERENCES requirement_versions(uid),
  position INT NOT NULL,
  PRIMARY KEY (release_id, version_uid)
);

CREATE INDEX IF NOT EXISTS idx_releases_project ON releases(project_id);
