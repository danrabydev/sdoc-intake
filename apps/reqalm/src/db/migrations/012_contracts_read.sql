CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  starts_on DATE,
  ends_on DATE,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS contract_scope (
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_uid TEXT NOT NULL REFERENCES requirement_versions(uid),
  position INT NOT NULL,
  PRIMARY KEY (contract_id, version_uid)
);

CREATE TABLE IF NOT EXISTS contract_releases (
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id),
  release_id TEXT NOT NULL REFERENCES releases(id),
  position INT NOT NULL,
  PRIMARY KEY (contract_id, release_id)
);

CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_contract_scope_contract ON contract_scope(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_releases_contract ON contract_releases(contract_id);
