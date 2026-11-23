-- A ban targets one person (`uid`: the hashed id of their OS account on their machine), a whole promotion or a
-- whole campus; `user` is the former OS account-name fragment, kept for the bans made before. The unique key
-- gains the scope, which SQLite only allows by rebuilding the table. `banned_by` is the admin who decided (the
-- full email, for admins only); `anonymous` hides that name from the banned user. `label` is the name the
-- dashboard shows for a `uid` ban; it is never public.
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('banned', 'authorized')),
  scope TEXT NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'uid', 'promotion', 'campus')),
  name TEXT NOT NULL,
  label TEXT,
  reason TEXT,
  features TEXT NOT NULL DEFAULT '["lens_active","my_api_active"]',
  banned_by TEXT,
  anonymous INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, scope, name)
);
INSERT INTO users_new (id, kind, name, reason, features, created_at)
  SELECT id, kind, name, reason, features, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Who uses the installation, reported with the heartbeat: the hashed OS account id, then, once signed in, the
-- first name, the initial of the last name, the promotion, the cursus and the campus.
ALTER TABLE installs ADD COLUMN user_id TEXT;
ALTER TABLE installs ADD COLUMN first_name TEXT;
ALTER TABLE installs ADD COLUMN last_initial TEXT;
CREATE INDEX installs_user ON installs (user_id);
ALTER TABLE installs ADD COLUMN promotion INTEGER;
ALTER TABLE installs ADD COLUMN cursus TEXT;
ALTER TABLE installs ADD COLUMN campus TEXT;
