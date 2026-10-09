-- Inheritable ConformsTo pins on capability versions (common-control over uses; read-time rollup in later PRs).

ALTER TABLE trace_edges
  ADD COLUMN IF NOT EXISTS inheritable BOOLEAN NOT NULL DEFAULT false;
