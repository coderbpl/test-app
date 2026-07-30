import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';

fs.mkdirSync(path.dirname(env.dbFile), { recursive: true });

export const db = new Database(env.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export default db;
