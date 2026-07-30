import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Applies the idempotent schema. Safe on every startup. */
export function migrate() {
    db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}
export default migrate;
