-- Foundation tables for dogfood seed (subset of ERD; auth/RBAC tables come later).

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  status TEXT,
  notes TEXT,
  workflow_profile_id TEXT
);

CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  external_sub TEXT,
  email TEXT,
  display_name TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS project_grants (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  identity_id TEXT NOT NULL REFERENCES identities(id),
  role TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  revoked_at TIMESTAMPTZ,
  notes TEXT,
  UNIQUE (project_id, identity_id, role)
);

CREATE TABLE IF NOT EXISTS requirement_lines (
  base_uid TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  PRIMARY KEY (project_id, base_uid)
);

CREATE TABLE IF NOT EXISTS requirement_versions (
  uid TEXT PRIMARY KEY,
  base_uid TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_n INT NOT NULL,
  status TEXT NOT NULL,
  statement TEXT NOT NULL,
  title TEXT,
  priority INT,
  iteration TEXT,
  rbac_op TEXT,
  grooming_state TEXT,
  mint_kind TEXT
);

CREATE TABLE IF NOT EXISTS seed_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dev-only local account seam (populated only in development seed; empty in prod).
CREATE TABLE IF NOT EXISTS dev_local_accounts (
  identity_id TEXT PRIMARY KEY REFERENCES identities(id),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_dev_seeded BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_requirement_versions_project ON requirement_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_requirement_lines_project ON requirement_lines(project_id);
