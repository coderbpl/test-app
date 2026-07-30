import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

/**
 * Resolves a possibly-relative path from an env var against the project root, so the app
 * behaves the same regardless of the working directory it's launched from.
 *
 * @param {string} p - Path (absolute or relative to the project root).
 * @returns {string} Absolute path.
 */
function resolveFromRoot(p) {
    return path.isAbsolute(p) ? p : path.resolve(projectRoot, p);
}

export const env = Object.freeze({
    port: Number(process.env.PORT || 4000),
    nodeEnv: process.env.NODE_ENV || 'development',
    corsOrigin: process.env.CORS_ORIGIN || '*',

    jwtSecret: process.env.JWT_SECRET || 'change-me-to-a-long-random-string',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',

    admin: {
        email: process.env.ADMIN_EMAIL || 'admin@grievance.local',
        password: process.env.ADMIN_PASSWORD || 'admin123',
        name: process.env.ADMIN_NAME || 'System Administrator'
    },

    dbFile: resolveFromRoot(process.env.DB_FILE || './data/grievance.db'),
    projectRoot,

    ai: {
        enabled: process.env.ENABLE_AI !== 'false',
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
        model: process.env.OLLAMA_MODEL || 'llama3.1',
        timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 60000)
    },

    slaSweepCron: process.env.SLA_SWEEP_CRON || '*/15 * * * *'
});
