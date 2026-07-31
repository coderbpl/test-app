-- MP HMIS — Grievance, Feedback & Ticketing. SQLite, idempotent.

-- Staff (officers who handle grievances, agents who resolve tickets) --------------------
CREATE TABLE IF NOT EXISTS staff (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    name_hi        TEXT,
    email          TEXT    NOT NULL UNIQUE,
    password_hash  TEXT    NOT NULL,
    role           TEXT    NOT NULL DEFAULT 'officer' CHECK (role IN ('admin','officer','agent')),
    department     TEXT,
    -- Governance tier for grievance escalation routing.
    tier           TEXT    NOT NULL DEFAULT 'FACILITY' CHECK (tier IN ('FACILITY','BLOCK','DISTRICT','DIVISION','STATE')),
    -- Free-form expertise tags used to route tickets by description.
    skills         TEXT,
    -- Ticket-team grade for the OIC → PM → TL → Developer hierarchy (null for grievance officers).
    grade          TEXT    CHECK (grade IN ('OIC','PM','TL','DEVELOPER')),
    status         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Hospitals master (selectable in the patient forms) -----------------------------------
CREATE TABLE IF NOT EXISTS hospitals (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    name_hi   TEXT,
    district  TEXT,
    type      TEXT,   -- DH (District Hospital), CHC, PHC, MC (Medical College)
    status    INTEGER NOT NULL DEFAULT 1
);

-- ============================ GRIEVANCES ============================
CREATE TABLE IF NOT EXISTS grievance_categories (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    code              TEXT    NOT NULL UNIQUE,
    name              TEXT    NOT NULL,
    name_hi           TEXT,
    default_priority  TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (default_priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    status            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS grievances (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_no              TEXT    UNIQUE,
    category_id         INTEGER REFERENCES grievance_categories(id),
    subject             TEXT,
    description         TEXT    NOT NULL,
    language            TEXT,
    is_anonymous        INTEGER NOT NULL DEFAULT 0,
    complainant_name    TEXT,
    complainant_mobile  TEXT,
    complainant_email   TEXT,
    hospital_id         INTEGER REFERENCES hospitals(id),
    facility            TEXT,
    department          TEXT,
    priority            TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    status              TEXT    NOT NULL DEFAULT 'NEW'
        CHECK (status IN ('NEW','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','CLOSED','REOPENED')),
    is_urgent           INTEGER NOT NULL DEFAULT 0,
    current_owner_tier  TEXT    NOT NULL DEFAULT 'FACILITY'
        CHECK (current_owner_tier IN ('FACILITY','BLOCK','DISTRICT','DIVISION','STATE')),
    assigned_staff_id   INTEGER REFERENCES staff(id),
    -- Every grievance is also formed into a work ticket, auto-routed to the right developer.
    linked_ticket_id    INTEGER REFERENCES tickets(id),
    resolution          TEXT,
    resolved_at         TEXT,
    closed_at           TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_grv_status ON grievances (status, priority);

CREATE TABLE IF NOT EXISTS grievance_timeline (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    grievance_id   INTEGER NOT NULL REFERENCES grievances(id),
    event_type     TEXT    NOT NULL
        CHECK (event_type IN ('CREATED','STATUS_CHANGE','ASSIGNED','ESCALATED','COMMENT','FEEDBACK')),
    from_status    TEXT,
    to_status      TEXT,
    comment        TEXT,
    actor_staff_id INTEGER,
    actor_name     TEXT,
    is_internal    INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_grv_tl ON grievance_timeline (grievance_id, created_at);

-- ============================ FEEDBACK ============================
-- Patient satisfaction survey — separate from grievances (a rating, not a complaint to work).
CREATE TABLE IF NOT EXISTS feedback (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_no              TEXT    UNIQUE,
    -- What the feedback is about: the hospital SERVICE experience, or the HMIS APPlication itself.
    feedback_type       TEXT    NOT NULL DEFAULT 'SERVICE' CHECK (feedback_type IN ('SERVICE','APP')),
    hospital_id         INTEGER REFERENCES hospitals(id),
    facility            TEXT,
    department          TEXT,
    visit_ref           TEXT,   -- optional OPD token / UHID reference
    rating_overall      INTEGER NOT NULL CHECK (rating_overall BETWEEN 1 AND 5),
    rating_staff        INTEGER CHECK (rating_staff BETWEEN 1 AND 5),
    rating_cleanliness  INTEGER CHECK (rating_cleanliness BETWEEN 1 AND 5),
    rating_waiting      INTEGER CHECK (rating_waiting BETWEEN 1 AND 5),
    -- APP-feedback dimensions
    rating_ease         INTEGER CHECK (rating_ease BETWEEN 1 AND 5),
    rating_speed        INTEGER CHECK (rating_speed BETWEEN 1 AND 5),
    would_recommend     INTEGER,  -- 1 yes / 0 no (recommend this hospital)
    comment             TEXT,
    is_anonymous        INTEGER NOT NULL DEFAULT 1,
    patient_name        TEXT,
    patient_mobile      TEXT,
    -- Set when a low rating is auto-converted into a follow-up: a grievance (hospital service)
    -- or an IT ticket (HMIS app).
    linked_grievance_id INTEGER REFERENCES grievances(id),
    linked_ticket_id    INTEGER REFERENCES tickets(id),
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_fb_dept ON feedback (department, created_at);

-- ============================ TICKETS (internal) ============================
-- Internal support (IT / biomedical / facility / housekeeping / supply). Routed to the staff
-- member who resolved the most similar past tickets.
CREATE TABLE IF NOT EXISTS tickets (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_no              TEXT    UNIQUE,
    subject             TEXT    NOT NULL,
    body                TEXT    NOT NULL,
    category            TEXT,   -- BUG, FEATURE, API, DATABASE, UI_UX, DEPLOYMENT, GRIEVANCE, OTHER
    -- How it arrived: WEB (public grievance form), EMAIL, API, or STAFF (raised internally).
    source              TEXT    NOT NULL DEFAULT 'STAFF',
    facility            TEXT,
    hospital_id         INTEGER REFERENCES hospitals(id),
    -- Reporter (for public grievance intake; null for internal staff tickets).
    requester_name      TEXT,
    requester_email     TEXT,
    requester_mobile    TEXT,
    is_anonymous        INTEGER NOT NULL DEFAULT 0,
    priority            TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
    status              TEXT    NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS','PENDING','RESOLVED','CLOSED','REOPENED')),
    raised_by_staff_id  INTEGER REFERENCES staff(id),
    assigned_staff_id   INTEGER REFERENCES staff(id),
    resolution          TEXT,
    resolved_at         TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_tkt_status ON tickets (status, priority);

CREATE TABLE IF NOT EXISTS ticket_messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id    INTEGER NOT NULL REFERENCES tickets(id),
    direction    TEXT    NOT NULL CHECK (direction IN ('NOTE','REPLY')),
    staff_id     INTEGER,
    author_name  TEXT,
    body         TEXT    NOT NULL,
    is_internal  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_tkt_msg ON ticket_messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS ticket_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id    INTEGER NOT NULL REFERENCES tickets(id),
    event_type   TEXT    NOT NULL,
    detail       TEXT,
    actor_name   TEXT,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_tkt_ev ON ticket_events (ticket_id, created_at);
