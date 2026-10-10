CREATE TABLE IF NOT EXISTS workflow_subject_kinds (
  id TEXT PRIMARY KEY,
  backing TEXT NOT NULL,
  kind_filter TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS workflow_gates (
  id TEXT PRIMARY KEY,
  subject_kinds TEXT[] NOT NULL DEFAULT '{}',
  mode TEXT NOT NULL,
  predicate TEXT NOT NULL,
  approver_slots TEXT[] NOT NULL DEFAULT '{}',
  on_fail TEXT NOT NULL,
  deny_fixture TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS workflow_action_hooks (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  gates_before TEXT[] NOT NULL DEFAULT '{}',
  effects_after TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS workflow_profiles (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL,
  gate_ids TEXT[] NOT NULL DEFAULT '{}',
  enabled_optional_gates TEXT[] NOT NULL DEFAULT '{}',
  disabled_optional_gates TEXT[] NOT NULL DEFAULT '{}',
  planning_gate_actions TEXT[] NOT NULL DEFAULT '{}',
  action_hook_ids TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS workflow_role_bindings (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES workflow_profiles(id) ON DELETE RESTRICT,
  gate_id TEXT NOT NULL REFERENCES workflow_gates(id) ON DELETE RESTRICT,
  slot TEXT NOT NULL,
  roles TEXT[] NOT NULL DEFAULT '{}',
  identities TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS workflow_approval_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  subject_kind TEXT NOT NULL,
  base_uid TEXT NOT NULL,
  status TEXT NOT NULL,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  approved_version_uid TEXT REFERENCES requirement_versions(uid),
  approved_statement_hash TEXT,
  FOREIGN KEY (project_id, base_uid) REFERENCES requirement_lines(project_id, base_uid) ON DELETE RESTRICT,
  UNIQUE (project_id, subject_kind, base_uid)
);

CREATE TABLE IF NOT EXISTS workflow_gate_signoffs (
  id TEXT PRIMARY KEY,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  gate_id TEXT NOT NULL REFERENCES workflow_gates(id) ON DELETE RESTRICT,
  slot TEXT NOT NULL,
  identity_id TEXT NOT NULL REFERENCES identities(id),
  decision TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_workflow_profiles_project ON workflow_profiles(project_id);
CREATE INDEX IF NOT EXISTS idx_workflow_profiles_client ON workflow_profiles(client_id);
CREATE INDEX IF NOT EXISTS idx_workflow_role_bindings_profile ON workflow_role_bindings(profile_id);
CREATE INDEX IF NOT EXISTS idx_workflow_approval_records_project ON workflow_approval_records(project_id);
CREATE INDEX IF NOT EXISTS idx_workflow_gate_signoffs_gate ON workflow_gate_signoffs(gate_id);
