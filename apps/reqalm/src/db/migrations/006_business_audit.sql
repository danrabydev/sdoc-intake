-- Append-only business audit trail (general operations; auth events stay in auth_audit_events).

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  permission TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('allow', 'deny', 'error')),
  identity_id TEXT,
  client_id TEXT,
  agent_name TEXT,
  token_role TEXT,
  acting_for TEXT,
  project_id TEXT,
  target_type TEXT,
  target_id TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred ON audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_project ON audit_events (project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_identity ON audit_events (identity_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION audit_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
