import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';

// Ensure the data directory exists before better-sqlite3 opens the file.
fs.mkdirSync(path.dirname(env.dbFile), { recursive: true });

/**
 * The shared SQLite connection. WAL mode + foreign keys on, matching how the rest of the
 * app assumes referential integrity is enforced.
 */
export const db = new Database(env.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export default db;
