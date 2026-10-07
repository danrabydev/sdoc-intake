-- Rename legacy ReqAML misspelling in persisted dev data (OAuth clients, project id, agent principals).
-- Idempotent: safe on fresh DBs that already use reqalm-* identifiers from bootstrap.

-- OAuth clients (update dependents before PK)
UPDATE oauth_authorization_codes SET client_id = 'reqalm-web' WHERE client_id = 'reqaml-web';
UPDATE oauth_authorization_codes SET client_id = 'reqalm-mcp-dev' WHERE client_id = 'reqaml-mcp-dev';
UPDATE oauth_authorization_codes SET client_id = 'reqalm-agent-dev' WHERE client_id = 'reqaml-agent-dev';

UPDATE oauth_refresh_families SET client_id = 'reqalm-web' WHERE client_id = 'reqaml-web';
UPDATE oauth_refresh_families SET client_id = 'reqalm-mcp-dev' WHERE client_id = 'reqaml-mcp-dev';
UPDATE oauth_refresh_families SET client_id = 'reqalm-agent-dev' WHERE client_id = 'reqaml-agent-dev';

UPDATE agent_principals SET oauth_client_id = 'reqalm-agent-dev' WHERE oauth_client_id = 'reqaml-agent-dev';

UPDATE oauth_clients SET client_id = 'reqalm-web', client_name = 'ReqALM Web UI' WHERE client_id = 'reqaml-web';
UPDATE oauth_clients SET client_id = 'reqalm-mcp-dev', client_name = 'ReqALM MCP (dev)' WHERE client_id = 'reqaml-mcp-dev';
UPDATE oauth_clients SET client_id = 'reqalm-agent-dev', client_name = 'ReqALM Agent (dev)' WHERE client_id = 'reqaml-agent-dev';

UPDATE agent_principals SET default_project_id = 'reqalm' WHERE default_project_id = 'reqaml';

-- Project + seeded rows (dogfood project id)
INSERT INTO projects (id, client_id, name, status, notes, workflow_profile_id)
SELECT 'reqalm', client_id, 'ReqALM', status, notes, workflow_profile_id
FROM projects
WHERE id = 'reqaml'
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

UPDATE project_grants SET project_id = 'reqalm' WHERE project_id = 'reqaml';
UPDATE requirement_lines SET project_id = 'reqalm' WHERE project_id = 'reqaml';
UPDATE requirement_versions SET project_id = 'reqalm' WHERE project_id = 'reqaml';
UPDATE releases SET project_id = 'reqalm' WHERE project_id = 'reqaml';

DELETE FROM projects WHERE id = 'reqaml' AND id <> 'reqalm';
