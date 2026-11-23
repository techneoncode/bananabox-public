-- A temporary ban ends at `expires_at` (epoch milliseconds); NULL keeps it until an admin lifts it.
-- Expired bans leave the public config at once and are deleted by the daily task.
ALTER TABLE users ADD COLUMN expires_at INTEGER;
