-- Self-registration (admin toggle) and email password reset.

-- Optional email per user, unique ignoring case.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email)) WHERE email IS NOT NULL;

-- Registration switch + outgoing mail (SMTP) settings.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS allow_registration boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_url   text    NOT NULL DEFAULT 'http://localhost:3000',
  ADD COLUMN IF NOT EXISTS smtp_host    text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS smtp_port    integer NOT NULL DEFAULT 587 CHECK (smtp_port BETWEEN 1 AND 65535),
  ADD COLUMN IF NOT EXISTS smtp_secure  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS smtp_user    text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS smtp_pass    text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS smtp_from    text    NOT NULL DEFAULT '';

-- One-time reset tokens. Only a SHA-256 hash of the token is stored.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  requested_by text NOT NULL DEFAULT 'self' CHECK (requested_by IN ('self', 'admin'))
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id);
