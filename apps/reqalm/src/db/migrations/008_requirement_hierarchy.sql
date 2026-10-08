-- Stable sibling order for tree reads (parent already on requirement_lines from 001).

ALTER TABLE requirement_lines
  ADD COLUMN IF NOT EXISTS sibling_order INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_requirement_lines_project_parent
  ON requirement_lines (project_id, parent);

CREATE INDEX IF NOT EXISTS idx_requirement_lines_tree
  ON requirement_lines (project_id, parent NULLS FIRST, sibling_order, base_uid);
