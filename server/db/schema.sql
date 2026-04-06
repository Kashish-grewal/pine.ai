-- ================================================================
-- pine.ai — Database Schema
-- ================================================================
-- HOW TO RUN THIS:
-- 1. Go to your Neon dashboard → SQL Editor
-- 2. Run this first to wipe the old schema:
--      DROP SCHEMA public CASCADE;
--      CREATE SCHEMA public;
-- 3. Then paste this entire file and click Run
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ================================================================
-- USERS
-- ================================================================
-- password_hash is nullable → Google OAuth users have no password
-- google_id is nullable     → email users have no Google ID
-- auth_provider tells you which login method they used
-- All timestamps are TIMESTAMPTZ (timezone-aware, not naive)
-- ================================================================
CREATE TABLE users (
  user_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  full_name     VARCHAR(255),
  avatar_url    VARCHAR(500),
  password_hash VARCHAR(255),
  google_id     VARCHAR(255) UNIQUE,
  auth_provider VARCHAR(20)  NOT NULL DEFAULT 'local'
                             CHECK (auth_provider IN ('local', 'google')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email     ON users (email);
CREATE INDEX idx_users_google_id ON users (google_id);


-- ================================================================
-- REFRESH TOKENS
-- ================================================================
-- Access tokens are short-lived (15 min). When they expire, the
-- frontend sends the refresh token here and gets a new access
-- token silently — no user disruption.
-- On logout we set is_revoked = TRUE → token is dead instantly.
-- We store a SHA-256 hash of the token, never the raw value.
-- ================================================================
CREATE TABLE refresh_tokens (
  token_id    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  is_revoked  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);


-- ================================================================
-- SESSIONS  (one per audio recording)
-- ================================================================
-- Central hub. Every extracted result links back here.
-- status flow:  pending → processing → completed
--                                   → failed
-- ================================================================
CREATE TABLE sessions (
  session_id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL DEFAULT 'Untitled Recording',
  description     TEXT,
  audio_url       VARCHAR(500),                 -- stored filename (not full path)
  audio_format    VARCHAR(100),                 -- MIME type
  file_size_bytes INTEGER,
  participants    JSONB,
  duration_secs   INTEGER,
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message   TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user    ON sessions (user_id);
CREATE INDEX idx_sessions_status  ON sessions (status);
CREATE INDEX idx_sessions_created ON sessions (created_at DESC);


-- ================================================================
-- TRANSCRIPTS
-- ================================================================
-- Raw output split into per-speaker segments.
-- start_time / end_time in seconds (12.500 = 12.5s into audio).
-- speaker_label starts as "Speaker 0", "Speaker 1" from the
-- diarization model — can be mapped to real names later.
-- ================================================================
CREATE TABLE transcripts (
  transcript_id UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID          NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  speaker_label VARCHAR(100),
  start_time    DECIMAL(10,3) NOT NULL,
  end_time      DECIMAL(10,3) NOT NULL,
  text_segment  TEXT          NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_transcript_time CHECK (end_time > start_time)
);

CREATE INDEX idx_transcripts_session ON transcripts (session_id);


-- ================================================================
-- TRANSACTIONS  (expense / income tracking)
-- ================================================================
-- user_id lives here directly so you can query "all expenses for
-- this user" without joining through sessions every time.
-- CHECK constraints → database rejects bad data at the source.
-- ================================================================
CREATE TABLE transactions (
  transaction_id UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID          NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  user_id        UUID          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type           VARCHAR(10)   NOT NULL CHECK (type IN ('income', 'expense')),
  amount         DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  category       VARCHAR(100)  NOT NULL,
  description    TEXT,
  logged_date    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_user    ON transactions (user_id);
CREATE INDEX idx_transactions_session ON transactions (session_id);
CREATE INDEX idx_transactions_type    ON transactions (type);


-- ================================================================
-- TASKS  (action items extraction)
-- ================================================================
-- Same reasoning — user_id here directly.
-- priority lets the LLM flag what needs immediate attention.
-- updated_at lets the frontend show "last updated 2 hours ago".
-- ================================================================
CREATE TABLE tasks (
  task_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID        NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  assignee     VARCHAR(100),
  description  TEXT        NOT NULL,
  deadline     TIMESTAMPTZ,
  priority     VARCHAR(10) NOT NULL DEFAULT 'normal'
                           CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  is_completed BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_user      ON tasks (user_id);
CREATE INDEX idx_tasks_session   ON tasks (session_id);
CREATE INDEX idx_tasks_completed ON tasks (is_completed);


-- ================================================================
-- MEETING SUMMARIES
-- ================================================================
-- UNIQUE on session_id → one summary per recording, enforced
-- by the database itself, not just your application code.
-- key_decisions is a JSON array of strings.
-- email_body_html is pre-built so we don't regenerate on resend.
-- ================================================================
CREATE TABLE meeting_summaries (
  summary_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID        UNIQUE NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  executive_summary TEXT        NOT NULL,
  key_decisions     JSONB,
  sentiment         VARCHAR(20) CHECK (sentiment IN ('positive', 'neutral', 'urgent', 'negative')),
  email_body_html   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- EMAIL LOGS
-- ================================================================
-- Every outbound email gets a row here — your audit trail.
-- error_detail tells you exactly why a send failed.
-- ================================================================
CREATE TABLE email_logs (
  log_id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID         NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  recipient_email VARCHAR(255) NOT NULL,
  recipient_name  VARCHAR(255),
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'sent', 'failed', 'bounced')),
  error_detail    TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_logs_session ON email_logs (session_id);
CREATE INDEX idx_email_logs_status  ON email_logs (status);