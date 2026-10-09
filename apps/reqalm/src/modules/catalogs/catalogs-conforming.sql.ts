/** Resolved conforms_to edges: only rows that join to a requirement line in the edge's project. */
export const RESOLVED_CONFORMS_BODY = `
  SELECT e.to_uid,
         e.from_uid,
         e.trace_suspect,
         l.base_uid,
         COALESCE(v.title, l.title) AS line_title,
         COALESCE(v.status, 'unknown') AS line_status
    FROM trace_edges e
    JOIN requirement_lines l ON l.project_id = e.from_project_id
     AND (l.base_uid = e.from_uid OR EXISTS (
       SELECT 1 FROM requirement_versions rv
        WHERE rv.project_id = e.from_project_id AND rv.uid = e.from_uid AND rv.base_uid = l.base_uid))
    LEFT JOIN LATERAL (
      SELECT title, status FROM requirement_versions
       WHERE project_id = l.project_id AND base_uid = l.base_uid
       ORDER BY version_n DESC LIMIT 1
    ) v ON true
   WHERE e.from_project_id = $1 AND e.kind = 'conforms_to' AND e.catalog_imprint_id = $2`;
