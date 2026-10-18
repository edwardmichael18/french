-- Normal admin user management: accounts can be disabled, and we record the last login.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
