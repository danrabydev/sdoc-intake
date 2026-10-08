-- Requirement line tree (parent + sibling order) and persisted trace edges from dogfood (read API deferred).

ALTER TABLE requirement_lines
  ADD COLUMN IF NOT EXISTS sibling_order INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_requirement_lines_tree
  ON requirement_lines (project_id, parent NULLS FIRST, sibling_order, base_uid);

CREATE TABLE IF NOT EXISTS requirement_trace_edges (
  project_id TEXT NOT NULL REFERENCES projects(id),
  from_base_uid TEXT NOT NULL,
  to_base_uid TEXT NOT NULL,
  kind TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, from_base_uid, to_base_uid, kind),
  FOREIGN KEY (project_id, from_base_uid) REFERENCES requirement_lines (project_id, base_uid) ON DELETE CASCADE,
  FOREIGN KEY (project_id, to_base_uid) REFERENCES requirement_lines (project_id, base_uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_requirement_trace_edges_from
  ON requirement_trace_edges (project_id, from_base_uid, position);
