-- Smart Helpdesk — SQLite schema. Idempotent (IF NOT EXISTS everywhere).

-- Agents (support staff who resolve tickets) ---------------------------------
CREATE TABLE IF NOT EXISTS agents (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    email          TEXT    NOT NULL UNIQUE,
    password_hash  TEXT    NOT NULL,
    role           TEXT    NOT NULL DEFAULT 'agent' CHECK (role IN ('admin','agent')),
    -- Free-form expertise tags used as a tie-breaker in routing (e.g. "billing,refunds").
    skills         TEXT,
    status         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Category master ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    code     TEXT    NOT NULL UNIQUE,
    name     TEXT    NOT NULL,
    status   INTEGER NOT NULL DEFAULT 1
);

-- Tickets --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_no              TEXT    UNIQUE,
    source              TEXT    NOT NULL DEFAULT 'WEB' CHECK (source IN ('EMAIL','WEB','API')),
    subject             TEXT    NOT NULL,
    body                TEXT    NOT NULL,
    requester_name      TEXT,
    requester_email     TEXT,

    category_id         INTEGER REFERENCES categories(id),
    priority            TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
    status              TEXT    NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS','PENDING','RESOLVED','CLOSED','REOPENED')),

    assigned_agent_id   INTEGER REFERENCES agents(id),

    -- AI (Groq) enrichment
    ai_summary          TEXT,
    ai_processed        INTEGER NOT NULL DEFAULT 0,

    -- Set when resolved; this is the text future similar tickets learn from.
    resolution          TEXT,

    -- Email threading / dedupe
    email_message_id    TEXT,
    email_thread_key    TEXT,

    resolved_at         TEXT,
    closed_at           TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS ix_tickets_status ON tickets (status, priority);
CREATE INDEX IF NOT EXISTS ix_tickets_agent  ON tickets (assigned_agent_id);
CREATE INDEX IF NOT EXISTS ix_tickets_thread ON tickets (email_thread_key);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tickets_msgid ON tickets (email_message_id) WHERE email_message_id IS NOT NULL;

-- Conversation thread --------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id         INTEGER NOT NULL REFERENCES tickets(id),
    direction         TEXT    NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND','NOTE')),
    author_name       TEXT,
    author_email      TEXT,
    agent_id          INTEGER,
    body              TEXT    NOT NULL,
    is_internal       INTEGER NOT NULL DEFAULT 0,
    email_message_id  TEXT,
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_messages_ticket ON ticket_messages (ticket_id, created_at);

-- Audit / activity -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id     INTEGER NOT NULL REFERENCES tickets(id),
    event_type    TEXT    NOT NULL
        CHECK (event_type IN ('CREATED','AI_CLASSIFIED','ASSIGNED','AUTO_ASSIGNED','STATUS_CHANGE','REPLY','NOTE','RECOMMENDATION')),
    detail        TEXT,
    actor_agent_id INTEGER,
    actor_name    TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_events_ticket ON ticket_events (ticket_id, created_at);
