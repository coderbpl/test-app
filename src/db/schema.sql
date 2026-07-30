-- Grievance Redressal — SQLite schema.
-- Idempotent: every statement uses IF NOT EXISTS, so it runs safely on every startup.

-- Officers (the people who triage/resolve grievances) --------------------------
CREATE TABLE IF NOT EXISTS officers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    email          TEXT    NOT NULL UNIQUE,
    password_hash  TEXT    NOT NULL,
    -- Governance tier this officer operates at (used for scope + escalation routing).
    tier           TEXT    NOT NULL DEFAULT 'FACILITY'
        CHECK (tier IN ('FACILITY','BLOCK','DISTRICT','DIVISION','STATE')),
    role           TEXT    NOT NULL DEFAULT 'officer'
        CHECK (role IN ('admin','officer')),
    -- Scope filters: an officer only sees grievances within their patch. NULL = no filter.
    hospital_id    INTEGER,
    district_id    INTEGER,
    division_id    INTEGER,
    status         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Category master --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    code              TEXT    NOT NULL UNIQUE,
    name              TEXT    NOT NULL,
    name_hi           TEXT,
    default_priority  TEXT    NOT NULL DEFAULT 'MEDIUM'
        CHECK (default_priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    sla_hours         INTEGER NOT NULL DEFAULT 72,
    status            INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Grievances -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grievances (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_no           TEXT    UNIQUE,
    category_id           INTEGER REFERENCES categories(id),
    title                 TEXT,
    description           TEXT    NOT NULL,
    language              TEXT,

    is_anonymous          INTEGER NOT NULL DEFAULT 0,
    complainant_name      TEXT,
    complainant_mobile    TEXT,
    complainant_email     TEXT,

    hospital_id           INTEGER,
    division_id           INTEGER,
    district_id           INTEGER,
    block_id              INTEGER,
    location_text         TEXT,

    priority              TEXT    NOT NULL DEFAULT 'MEDIUM'
        CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    status                TEXT    NOT NULL DEFAULT 'NEW'
        CHECK (status IN ('NEW','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','CLOSED','REOPENED')),

    -- AI enrichment (local Ollama). Best-effort; a grievance is fully usable without it.
    is_urgent             INTEGER NOT NULL DEFAULT 0,
    ai_summary            TEXT,
    ai_processed          INTEGER NOT NULL DEFAULT 0,

    sla_due_at            TEXT,
    current_owner_tier    TEXT    NOT NULL DEFAULT 'FACILITY'
        CHECK (current_owner_tier IN ('FACILITY','BLOCK','DISTRICT','DIVISION','STATE')),
    assigned_to_officer_id INTEGER REFERENCES officers(id),
    created_by_officer_id  INTEGER REFERENCES officers(id),

    resolved_at           TEXT,
    closed_at             TEXT,
    created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS ix_grievances_status ON grievances (status, priority);
CREATE INDEX IF NOT EXISTS ix_grievances_scope  ON grievances (district_id, hospital_id);
CREATE INDEX IF NOT EXISTS ix_grievances_sla    ON grievances (sla_due_at);

-- Timeline (append-only audit + comments) --------------------------------------
CREATE TABLE IF NOT EXISTS timeline (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    grievance_id   INTEGER NOT NULL REFERENCES grievances(id),
    event_type     TEXT    NOT NULL
        CHECK (event_type IN ('CREATED','AI_CLASSIFIED','STATUS_CHANGE','ASSIGNED','ESCALATED','COMMENT','FEEDBACK','ATTACHMENT')),
    from_status    TEXT,
    to_status      TEXT,
    comment        TEXT,
    actor_officer_id INTEGER,
    actor_name     TEXT,
    is_internal    INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS ix_timeline_grievance ON timeline (grievance_id, created_at);

-- Attachments ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    grievance_id          INTEGER NOT NULL REFERENCES grievances(id),
    file_name             TEXT    NOT NULL,
    file_path             TEXT    NOT NULL,
    mime_type             TEXT,
    uploaded_by_officer_id INTEGER,
    created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Feedback (post-resolution citizen rating) ------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    grievance_id   INTEGER NOT NULL UNIQUE REFERENCES grievances(id),
    rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment        TEXT,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
