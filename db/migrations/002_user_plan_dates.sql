-- Each learner chooses their own start date (and exam date) on first login.
-- NULL start_date = onboarding not done yet. NULL exam_date = use the site default in app_settings.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS exam_date  date;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_dates_check;
ALTER TABLE users ADD CONSTRAINT users_plan_dates_check
  CHECK (start_date IS NULL OR exam_date IS NULL OR exam_date > start_date);
