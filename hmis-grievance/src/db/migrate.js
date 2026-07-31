import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tableColumns(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

/**
 * Adds a column to an existing table only if it's missing. This is what makes the schema safe to
 * evolve: `CREATE TABLE IF NOT EXISTS` never alters an existing table, so columns added later
 * (feedback_type, hospital_id, …) must be back-filled here for databases created before them.
 */
function ensureColumn(table, name, ddl) {
    if (!tableColumns(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/** Applies the schema, then back-fills any columns added after the DB was first created. */
export function migrate() {
    db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

    // Additive migrations (safe on both fresh and pre-existing databases).
    ensureColumn('grievances', 'hospital_id', 'hospital_id INTEGER REFERENCES hospitals(id)');
    ensureColumn('feedback', 'feedback_type', "feedback_type TEXT NOT NULL DEFAULT 'SERVICE'");
    ensureColumn('feedback', 'hospital_id', 'hospital_id INTEGER REFERENCES hospitals(id)');
    ensureColumn('feedback', 'rating_ease', 'rating_ease INTEGER');
    ensureColumn('feedback', 'rating_speed', 'rating_speed INTEGER');
    ensureColumn('feedback', 'linked_ticket_id', 'linked_ticket_id INTEGER REFERENCES tickets(id)');
}

export default migrate;
