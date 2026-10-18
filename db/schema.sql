-- French Academy — PostgreSQL schema.
-- Idempotent: safe to run on every start (lib/db.js does). Changes go in db/migrations/NNN_*.sql.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- Accounts ----------
CREATE TABLE IF NOT EXISTS users (
  id                 uuid PRIMARY KEY,
  username           text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
  name               text NOT NULL,
  password_hash      text NOT NULL,
  role               text NOT NULL DEFAULT 'learner' CHECK (role IN ('admin', 'learner')),
  voice              text NOT NULL DEFAULT 'fr-CA' CHECK (voice IN ('fr-CA', 'fr-FR')),
  feedback_override  text CHECK (feedback_override IN ('selfmark', 'ai')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- One row only (id is always true). Typed columns instead of a key/value bag.
CREATE TABLE IF NOT EXISTS app_settings (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  feedback_mode        text NOT NULL DEFAULT 'selfmark' CHECK (feedback_mode IN ('selfmark', 'ai')),
  allow_user_override  boolean NOT NULL DEFAULT false,
  ai_provider          text NOT NULL DEFAULT 'claude' CHECK (ai_provider IN ('claude', 'openai', 'gemini')),
  anthropic_api_key    text NOT NULL DEFAULT '',
  openai_api_key       text NOT NULL DEFAULT '',
  gemini_api_key       text NOT NULL DEFAULT '',
  claude_model         text NOT NULL DEFAULT 'claude-opus-5',
  openai_model         text NOT NULL DEFAULT 'gpt-4o',
  gemini_model         text NOT NULL DEFAULT 'gemini-2.5-flash',
  start_date           date NOT NULL DEFAULT DATE '2026-09-21',
  exam_date            date NOT NULL DEFAULT DATE '2027-02-12',
  session_secret       text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Sessions (connect-pg-simple layout) — logins now survive a server restart.
CREATE TABLE IF NOT EXISTS session (
  sid     varchar NOT NULL PRIMARY KEY,
  sess    json NOT NULL,
  expire  timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);

-- ---------- Learning progress ----------
CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week     smallint NOT NULL CHECK (week BETWEEN 1 AND 21),
  step     smallint NOT NULL DEFAULT 0,
  done     boolean NOT NULL DEFAULT false,
  done_at  timestamptz,
  answers  jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, week)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id        bigserial PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_id   text NOT NULL,
  score     smallint NOT NULL,
  total     smallint NOT NULL,
  taken_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS quiz_attempts_user_idx ON quiz_attempts (user_id, quiz_id);

CREATE TABLE IF NOT EXISTS checklist_items (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id  text NOT NULL,
  done     boolean NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS floor_days (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day      date NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS study_log (
  id       bigserial PRIMARY KEY,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day      date NOT NULL,
  minutes  smallint NOT NULL CHECK (minutes >= 0),
  kind     text NOT NULL CHECK (kind IN ('input', 'production'))
);
CREATE INDEX IF NOT EXISTS study_log_user_day_idx ON study_log (user_id, day);

CREATE TABLE IF NOT EXISTS weak_areas (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trap     text NOT NULL,
  misses   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, trap)
);

CREATE TABLE IF NOT EXISTS error_log (
  id          text NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wrote       text NOT NULL,
  correction  text NOT NULL,
  rule        text NOT NULL DEFAULT '',
  count       integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS mock_attempts (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_id     text NOT NULL,
  started_at  timestamptz NOT NULL,
  co          smallint CHECK (co BETWEEN 100 AND 699),
  ce          smallint CHECK (ce BETWEEN 100 AND 699),
  ee          smallint CHECK (ee BETWEEN 0 AND 20),
  eo          smallint CHECK (eo BETWEEN 0 AND 20),
  criteria    text,
  PRIMARY KEY (user_id, test_id, started_at)
);

-- Writing (EE) and speaking (EO) productions.
CREATE TABLE IF NOT EXISTS submissions (
  id          text NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('writing', 'speaking')),
  task        text,
  text        text NOT NULL DEFAULT '',
  words       integer,
  score       smallint CHECK (score BETWEEN 0 AND 20),
  nclc        text,
  mode        text,
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- Small, irregular per-user documents: diagnostic, Friday self-checks, gate wellbeing checks.
CREATE TABLE IF NOT EXISTS user_documents (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc         text NOT NULL CHECK (doc IN ('diagnostic', 'selfchecks', 'wellbeing')),
  value       jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, doc)
);

-- ---------- Reporting views (query these from psql / pgAdmin) ----------
CREATE OR REPLACE VIEW v_mock_best AS
SELECT u.username, m.user_id,
       max(m.co) AS best_co, max(m.ce) AS best_ce, max(m.ee) AS best_ee, max(m.eo) AS best_eo,
       (max(m.co) >= 458 AND max(m.ce) >= 453 AND max(m.ee) >= 10 AND max(m.eo) >= 10) AS all_four_at_nclc7
FROM mock_attempts m JOIN users u ON u.id = m.user_id
GROUP BY u.username, m.user_id;

CREATE OR REPLACE VIEW v_weekly_production_share AS
SELECT u.username, date_trunc('week', s.day)::date AS week_of,
       sum(s.minutes) AS total_minutes,
       sum(s.minutes) FILTER (WHERE s.kind = 'production') AS production_minutes,
       round(100.0 * coalesce(sum(s.minutes) FILTER (WHERE s.kind = 'production'), 0) / nullif(sum(s.minutes), 0), 1) AS production_pct
FROM study_log s JOIN users u ON u.id = s.user_id
GROUP BY u.username, date_trunc('week', s.day);

CREATE OR REPLACE VIEW v_error_log_top AS
SELECT u.username, e.rule, e.wrote, e.correction, e.count,
       rank() OVER (PARTITION BY e.user_id ORDER BY e.count DESC, e.created_at) AS rank
FROM error_log e JOIN users u ON u.id = e.user_id;

CREATE OR REPLACE VIEW v_lesson_status AS
SELECT u.username, l.week, l.step, l.done, l.done_at
FROM lesson_progress l JOIN users u ON u.id = l.user_id;

CREATE OR REPLACE VIEW v_submission_scores AS
SELECT u.username, s.kind, s.task, s.score, s.mode, s.created_at
FROM submissions s JOIN users u ON u.id = s.user_id
WHERE s.score IS NOT NULL;
