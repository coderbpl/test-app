import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tableColumns(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

/** Adds a column only if it's missing (CREATE TABLE IF NOT EXISTS never alters existing tables). */
function ensureColumn(table, name, ddl) {
    if (!tableColumns(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/** Drops a column if present (SQLite 3.35+). Best-effort — ignored on older engines. */
function dropColumn(table, name) {
    if (tableColumns(table).includes(name)) {
        try { db.exec(`ALTER TABLE ${table} DROP COLUMN ${name}`); } catch { /* older sqlite / indexed — leave it */ }
    }
}

/** Applies the schema, then reconciles columns for databases created under older versions. */
export function migrate() {
    db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

    // Additive migrations
    ensureColumn('grievances', 'hospital_id', 'hospital_id INTEGER REFERENCES hospitals(id)');
    ensureColumn('grievances', 'linked_ticket_id', 'linked_ticket_id INTEGER REFERENCES tickets(id)');
    ensureColumn('feedback', 'feedback_type', "feedback_type TEXT NOT NULL DEFAULT 'SERVICE'");
    ensureColumn('feedback', 'hospital_id', 'hospital_id INTEGER REFERENCES hospitals(id)');
    ensureColumn('feedback', 'rating_ease', 'rating_ease INTEGER');
    ensureColumn('feedback', 'rating_speed', 'rating_speed INTEGER');
    ensureColumn('feedback', 'linked_ticket_id', 'linked_ticket_id INTEGER REFERENCES tickets(id)');
    ensureColumn('staff', 'grade', 'grade TEXT');
    ensureColumn('tickets', 'source', "source TEXT NOT NULL DEFAULT 'STAFF'");
    ensureColumn('tickets', 'hospital_id', 'hospital_id INTEGER REFERENCES hospitals(id)');
    ensureColumn('tickets', 'requester_name', 'requester_name TEXT');
    ensureColumn('tickets', 'requester_email', 'requester_email TEXT');
    ensureColumn('tickets', 'requester_mobile', 'requester_mobile TEXT');
    ensureColumn('tickets', 'is_anonymous', 'is_anonymous INTEGER NOT NULL DEFAULT 0');

    // SLA removed — tear down deadline columns/index left over from older databases.
    db.exec('DROP INDEX IF EXISTS ix_grv_sla');
    dropColumn('grievances', 'sla_due_at');
    dropColumn('grievance_categories', 'sla_hours');
}

export default migrate;
