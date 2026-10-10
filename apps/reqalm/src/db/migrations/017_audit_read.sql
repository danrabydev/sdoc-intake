-- Indexes for grant-scoped audit read filters (project and platform listings).

CREATE INDEX IF NOT EXISTS idx_audit_events_project_operation
  ON audit_events (project_id, operation, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_project_target
  ON audit_events (project_id, target_type, occurred_at DESC)
  WHERE target_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_audit_identity_occurred
  ON auth_audit_events (identity_id, occurred_at DESC)
  WHERE identity_id IS NOT NULL;
