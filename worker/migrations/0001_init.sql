-- Remote policy: a single row, replaced through PUT /v1/policy.
CREATE TABLE policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lens_active INTEGER NOT NULL,
  my_api_active INTEGER NOT NULL,
  version TEXT NOT NULL,
  latest TEXT NOT NULL,
  banned_features TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO policy VALUES (
  1, 1, 1, '1.3.4',
  'https://github.com/techneoncode/bananabox-public/releases/download/v1.3.4/bananabox-1.3.4.vsix',
  '["lens_active","my_api_active"]', 0
);

-- Account-name fragments, one list per kind.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('banned', 'authorized')),
  name TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, name)
);

-- Single-use challenges for the installation endpoints.
CREATE TABLE nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

-- Pseudonymous installations: only a SHA-256 of the random install id is kept.
CREATE TABLE installs (
  id_hash TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  launches INTEGER NOT NULL,
  version TEXT NOT NULL
);
CREATE INDEX installs_last_seen ON installs (last_seen);

CREATE TABLE updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_hash TEXT NOT NULL,
  from_version TEXT NOT NULL,
  to_version TEXT NOT NULL,
  at INTEGER NOT NULL,
  UNIQUE (id_hash, from_version, to_version)
);
CREATE INDEX updates_at ON updates (at);
