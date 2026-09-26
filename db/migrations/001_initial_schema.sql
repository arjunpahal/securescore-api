-- =============================================================================
-- SecureScore initial schema
--
-- Creates five tables:
--   users         — application accounts (admin + developer roles)
--   projects      — Hardhat cybersecurity projects being monitored
--   scans         — individual security scan runs for a project
--   scan_findings — vulnerability counts per severity per scan
--   alerts        — security alerts raised by the scoring engine
--
-- UUIDs are used as primary keys throughout to prevent enumeration and to
-- allow distributed ID generation. Parameterised queries in the application
-- layer prevent SQL injection regardless, but the data model makes guessing
-- resource IDs impractical as an additional defence.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enable the pgcrypto extension for gen_random_uuid()
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT        NOT NULL UNIQUE,
    name          TEXT,
    password_hash TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'developer'
                              CHECK (role IN ('admin', 'lead', 'developer')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL UNIQUE,
    description     TEXT,
    repository_url  TEXT,
    owner_id        UUID        REFERENCES users (id) ON DELETE SET NULL,
    current_score   INTEGER     CHECK (current_score BETWEEN 0 AND 100),
    rating          TEXT        CHECK (rating IN ('HEALTHY', 'MODERATE', 'AT_RISK', 'CRITICAL')),
    last_scanned_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Scans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scans (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    score         INTEGER     NOT NULL CHECK (score BETWEEN 0 AND 100),
    rating        TEXT        NOT NULL
                              CHECK (rating IN ('HEALTHY', 'MODERATE', 'AT_RISK', 'CRITICAL')),
    should_alert  BOOLEAN     NOT NULL DEFAULT FALSE,
    triggered_by  UUID        REFERENCES users (id) ON DELETE SET NULL,
    scanned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scans_project_id ON scans (project_id);
CREATE INDEX IF NOT EXISTS idx_scans_scanned_at  ON scans (scanned_at DESC);

-- ---------------------------------------------------------------------------
-- Scan findings (one row per severity per scan)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scan_findings (
    id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id    UUID    NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
    severity   TEXT    NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    count      INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
    UNIQUE (scan_id, severity)
);

CREATE INDEX IF NOT EXISTS idx_scan_findings_scan_id ON scan_findings (scan_id);

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    scan_id     UUID        NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
    message     TEXT        NOT NULL,
    severity    TEXT        NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    resolved    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alerts_project_id ON alerts (project_id);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved    ON alerts (resolved) WHERE NOT resolved;

-- ---------------------------------------------------------------------------
-- Automatic updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
