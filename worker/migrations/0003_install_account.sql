-- OS account name reported by the extension, so a maintainer can ban it by name.
ALTER TABLE installs ADD COLUMN account TEXT;
