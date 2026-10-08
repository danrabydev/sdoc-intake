-- Correlate append-only business audit rows with distributed traces.

ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS trace_id TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_events_trace ON audit_events (trace_id, occurred_at DESC);
