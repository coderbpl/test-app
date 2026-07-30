import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const fromRoot = (p) => (path.isAbsolute(p) ? p : path.resolve(projectRoot, p));

export const env = Object.freeze({
    port: Number(process.env.PORT || 4100),
    nodeEnv: process.env.NODE_ENV || 'development',
    corsOrigin: process.env.CORS_ORIGIN || '*',

    jwtSecret: process.env.JWT_SECRET || 'change-me-to-a-long-random-string',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
    admin: {
        email: process.env.ADMIN_EMAIL || 'admin@helpdesk.local',
        password: process.env.ADMIN_PASSWORD || 'admin123',
        name: process.env.ADMIN_NAME || 'Helpdesk Admin'
    },

    dbFile: fromRoot(process.env.DB_FILE || './data/helpdesk.db'),
    projectRoot,

    ai: {
        enabled: process.env.ENABLE_AI !== 'false' && Boolean(process.env.GROQ_API_KEY),
        apiKey: process.env.GROQ_API_KEY || '',
        baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        timeoutMs: Number(process.env.GROQ_TIMEOUT_MS || 30000)
    },

    reco: {
        threshold: Number(process.env.SIMILARITY_THRESHOLD || 0.12),
        topK: Number(process.env.SIMILAR_TOP_K || 5)
    },

    email: {
        pollEnabled: process.env.ENABLE_EMAIL_POLL === 'true',
        host: process.env.IMAP_HOST || '',
        port: Number(process.env.IMAP_PORT || 993),
        user: process.env.IMAP_USER || '',
        password: process.env.IMAP_PASSWORD || '',
        mailbox: process.env.IMAP_MAILBOX || 'INBOX',
        cron: process.env.EMAIL_POLL_CRON || '*/2 * * * *'
    }
});
