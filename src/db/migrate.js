import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Applies the (idempotent) schema. Safe to call on every startup — every DDL statement uses
 * IF NOT EXISTS, so existing data is left untouched.
 */
export function migrate() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);
}

export default migrate;
