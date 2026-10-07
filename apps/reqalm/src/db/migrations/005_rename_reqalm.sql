-- Rename legacy ReqAML misspelling in persisted dev data (OAuth clients, project id, agent principals).
-- Idempotent: safe on fresh DBs that already use reqalm-* identifiers from bootstrap.
-- Order matters: child tables reference oauth_clients / projects (no ON UPDATE CASCADE), so create
-- the new parent rows first, repoint children, then delete the legacy parents.

-- OAuth clients: copy legacy rows under the new ids.
INSERT INTO oauth_clients (client_id, client_name, client_type, redirect_uris, client_secret_hash, allowed_resources, created_at)
SELECT 'reqalm-' || substr(client_id, length('reqaml-') + 1),
       replace(client_name, 'ReqAML', 'ReqALM'),
       client_type, redirect_uris, client_secret_hash, allowed_resources, created_at
FROM oauth_clients
WHERE client_id IN ('reqaml-web', 'reqaml-mcp-dev', 'reqaml-agent-dev')
ON CONFLICT (client_id) DO NOTHING;

UPDATE oauth_authorization_codes SET client_id = 'reqalm-' || substr(client_id, 8)
  WHERE client_id IN ('reqaml-web', 'reqaml-mcp-dev', 'reqaml-agent-dev');
UPDATE oauth_refresh_families SET client_id = 'reqalm-' || substr(client_id, 8)
  WHERE client_id IN ('reqaml-web', 'reqaml-mcp-dev', 'reqaml-agent-dev');
UPDATE agent_principals SET oauth_client_id = 'reqalm-' || substr(oauth_client_id, 8)
  WHERE oauth_client_id IN ('reqaml-web', 'reqaml-mcp-dev', 'reqaml-agent-dev');
-- Unconstrained client_id columns (pending handoffs / sessions); audit events keep history as-is.
UPDATE oauth_login_handoffs SET client_id = 'reqalm-' || substr(client_id, 8)
  WHERE client_id IN ('reqaml-web', 'reqaml-mcp-dev', 'reqaml-agent-dev');
UPDATE auth_sessions SET client_id = 'reqalm-' || substr(client_id, 8)
  WHERE client_id IN ('reqaml-web', 'reqaml-mcp-dev', 'reqaml-agent-dev');

DELETE FROM oauth_clients WHERE client_id IN ('reqaml-web', 'reqaml-mcp-dev', 'reqaml-agent-dev');

UPDATE agent_principals SET default_project_id = 'reqalm' WHERE default_project_id = 'reqaml';

-- Project + seeded rows (dogfood project id)
INSERT INTO projects (id, client_id, name, status, notes, workflow_profile_id)
SELECT 'reqalm', client_id, 'ReqALM', status, notes, workflow_profile_id
FROM projects
WHERE id = 'reqaml'
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

UPDATE project_grants SET project_id = 'reqalm' WHERE project_id = 'reqaml';
-- Seed grant ids embed the project id; rename them so re-seeding does not insert a second live
-- grant for the same (project, identity, role) (project_grants_live_uniq).
UPDATE project_grants SET id = replace(id, '-reqaml-', '-reqalm-')
  WHERE id LIKE '%-reqaml-%'
    AND NOT EXISTS (SELECT 1 FROM project_grants g2 WHERE g2.id = replace(project_grants.id, '-reqaml-', '-reqalm-'));
UPDATE requirement_lines SET project_id = 'reqalm' WHERE project_id = 'reqaml';
UPDATE requirement_versions SET project_id = 'reqalm' WHERE project_id = 'reqaml';
UPDATE releases SET project_id = 'reqalm' WHERE project_id = 'reqaml';

DELETE FROM projects WHERE id = 'reqaml';
