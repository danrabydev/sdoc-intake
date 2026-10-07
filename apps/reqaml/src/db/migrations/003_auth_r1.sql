-- R1: internal OAuth AS, credential store, sessions, audit, signing keys.

CREATE TABLE IF NOT EXISTS auth_profile (
  id TEXT PRIMARY KEY DEFAULT 'default',
  identity_mode TEXT NOT NULL DEFAULT 'hybrid',
  local_accounts TEXT NOT NULL DEFAULT 'enabled',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO auth_profile (id, identity_mode, local_accounts)
VALUES ('default', 'hybrid', 'enabled')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  client_type TEXT NOT NULL DEFAULT 'public',
  redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb,
  client_secret_hash TEXT,
  allowed_resources JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  identity_id TEXT NOT NULL REFERENCES identities(id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  resource TEXT,
  scope TEXT,
  state TEXT,
  auth_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  mfa_verified BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_authorization_codes(expires_at);

CREATE TABLE IF NOT EXISTS oauth_refresh_families (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES identities(id),
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  resource TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES oauth_refresh_families(id) ON DELETE CASCADE,
  rotated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_family ON oauth_refresh_tokens(family_id);

CREATE TABLE IF NOT EXISTS oauth_access_revocations (
  jti TEXT PRIMARY KEY,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS local_credentials (
  identity_id TEXT PRIMARY KEY REFERENCES identities(id),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_dev_seeded BOOLEAN NOT NULL DEFAULT false,
  is_breakglass BOOLEAN NOT NULL DEFAULT false,
  mfa_secret_encrypted TEXT,
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES identities(id),
  client_id TEXT,
  auth_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mfa_verified BOOLEAN NOT NULL DEFAULT false,
  step_up_at TIMESTAMPTZ,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  idle_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_identity ON auth_sessions(identity_id);

CREATE TABLE IF NOT EXISTS signing_keys (
  kid TEXT PRIMARY KEY,
  alg TEXT NOT NULL DEFAULT 'ES256',
  public_jwk JSONB NOT NULL,
  private_key_ciphertext TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  not_before TIMESTAMPTZ NOT NULL DEFAULT now(),
  not_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_encryption_keys (
  purpose TEXT PRIMARY KEY,
  dek_ciphertext TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_audit_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  identity_id TEXT,
  client_id TEXT,
  resource TEXT,
  ip TEXT,
  user_agent TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_occurred ON auth_audit_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_type ON auth_audit_events(event_type);

CREATE TABLE IF NOT EXISTS platform_grants (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES identities(id),
  role TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS upstream_connectors (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  protocol TEXT NOT NULL DEFAULT 'oidc',
  issuer TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migrate legacy dev_local_accounts into local_credentials on first boot after migration.
INSERT INTO local_credentials (identity_id, username, password_hash, is_dev_seeded)
SELECT identity_id, username, password_hash, is_dev_seeded
FROM dev_local_accounts
ON CONFLICT (identity_id) DO NOTHING;
