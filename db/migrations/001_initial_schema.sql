-- SecureScore initial schema
-- Applied automatically on container start by the postgres image
-- (files in /docker-entrypoint-initdb.d run in alphabetical order).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------- users ----
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    name          VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'developer'
                  CHECK (role IN ('developer', 'lead', 'admin')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ------------------------------------------------------------- projects ----
CREATE TABLE IF NOT EXISTS projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(120) NOT NULL UNIQUE,
    description     TEXT,
    repository_url  VARCHAR(500) NOT NULL,
    owner_id        UUID REFERENCES users (id) ON DELETE SET NULL,
    current_score   INTEGER CHECK (current_score BETWEEN 0 AND 100),
    rating          VARCHAR(20)
                    CHECK (rating IN ('HEALTHY', 'MODERATE', 'AT_RISK', 'CRITICAL')),
    last_scanned_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_owner  ON projects (owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_rating ON projects (rating);
CREATE INDEX IF NOT EXISTS idx_projects_score  ON projects (current_score);

-- ---------------------------------------------------------------- scans ----
CREATE TABLE IF NOT EXISTS scans (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    score             INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    rating            VARCHAR(20) NOT NULL,
    deduction         NUMERIC(6,2) NOT NULL DEFAULT 0,
    staleness_penalty NUMERIC(6,2) NOT NULL DEFAULT 0,
    triggered_by      UUID REFERENCES users (id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scans_project ON scans (project_id, created_at DESC);

-- ------------------------------------------------------- scan_findings ----
CREATE TABLE IF NOT EXISTS scan_findings (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id   UUID NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
    severity  VARCHAR(20) NOT NULL
              CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    count     INTEGER NOT NULL CHECK (count >= 0),
    UNIQUE (scan_id, severity)
);

CREATE INDEX IF NOT EXISTS idx_findings_scan ON scan_findings (scan_id);

-- --------------------------------------------------------------- alerts ----
CREATE TABLE IF NOT EXISTS alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    scan_id         UUID REFERENCES scans (id) ON DELETE SET NULL,
    reason          VARCHAR(50)  NOT NULL,
    severity        VARCHAR(20)  NOT NULL,
    message         TEXT         NOT NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    acknowledged_by UUID REFERENCES users (id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_status  ON alerts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_project ON alerts (project_id);
