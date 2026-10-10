CREATE TABLE IF NOT EXISTS capability_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  requirement_version_uid TEXT NOT NULL REFERENCES requirement_versions(uid) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  uri TEXT NOT NULL,
  position INT NOT NULL,
  UNIQUE (requirement_version_uid, position)
);

CREATE INDEX IF NOT EXISTS idx_capability_artifacts_version
  ON capability_artifacts (project_id, requirement_version_uid, position);

CREATE TABLE IF NOT EXISTS attachment_blobs (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  media_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  wrapped_dek BYTEA
);

CREATE TABLE IF NOT EXISTS file_attachments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent_kind TEXT NOT NULL,
  parent_uid TEXT NOT NULL REFERENCES requirement_versions(uid) ON DELETE RESTRICT,
  display_name TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_file_attachments_parent
  ON file_attachments (project_id, parent_uid)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS file_attachment_versions (
  id TEXT PRIMARY KEY,
  attachment_id TEXT NOT NULL REFERENCES file_attachments(id) ON DELETE RESTRICT,
  version_n INT NOT NULL,
  blob_id TEXT NOT NULL REFERENCES attachment_blobs(id) ON DELETE RESTRICT,
  scan_state TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attachment_id, version_n)
);

CREATE INDEX IF NOT EXISTS idx_file_attachment_versions_attachment
  ON file_attachment_versions (attachment_id, version_n DESC);
