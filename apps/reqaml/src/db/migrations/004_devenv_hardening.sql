-- Dev env hardening: server-side OAuth handoffs, web sessions, MFA replay, IP throttle, agents.

CREATE TABLE IF NOT EXISTS oauth_login_handoffs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  resource TEXT NOT NULL,
  scope TEXT,
  state TEXT NOT NULL,
  code_verifier TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_handoffs_expires ON oauth_login_handoffs(expires_at);

CREATE TABLE IF NOT EXISTS web_sessions (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES identities(id),
  refresh_token_ciphertext TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  mfa_verified BOOLEAN NOT NULL DEFAULT false,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  idle_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mfa_totp_replay (
  identity_id TEXT NOT NULL REFERENCES identities(id),
  time_step BIGINT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, time_step)
);

CREATE TABLE IF NOT EXISTS auth_ip_throttle (
  ip_hash TEXT PRIMARY KEY,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_principals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  identity_id TEXT NOT NULL REFERENCES identities(id),
  oauth_client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  default_project_id TEXT,
  default_role TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mfa_enrollment_tickets (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES identities(id),
  secret_ciphertext TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
