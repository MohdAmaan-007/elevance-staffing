CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('candidate','employer','admin')),
  company_name TEXT,
  country TEXT,
  cv_filename TEXT,
  cv_storage_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  employer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  title TEXT NOT NULL,
  industry TEXT NOT NULL,
  employment_type TEXT NOT NULL,
  location TEXT NOT NULL,
  openings INTEGER NOT NULL DEFAULT 1 CHECK (openings > 0),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS applications (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cover_note TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','reviewing','shortlisted','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS jobs_status_created_idx ON jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS applications_candidate_idx ON applications(candidate_id, created_at DESC);
