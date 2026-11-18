-- OS account name (`whoami`) of each admin. The extension shows the admin dashboard only to these accounts;
-- the login still needs the email and password. Accounts created before this migration have none until root sets it.
ALTER TABLE admins ADD COLUMN whoami TEXT;
