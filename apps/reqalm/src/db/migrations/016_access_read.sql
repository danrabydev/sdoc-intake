CREATE TABLE IF NOT EXISTS client_grants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_client_grants_client ON client_grants(client_id);
CREATE INDEX IF NOT EXISTS idx_client_grants_identity ON client_grants(identity_id);
