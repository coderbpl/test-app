import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const fromRoot = (p) => (path.isAbsolute(p) ? p : path.resolve(projectRoot, p));

export const env = Object.freeze({
    port: Number(process.env.PORT || 4200),
    nodeEnv: process.env.NODE_ENV || 'development',
    corsOrigin: process.env.CORS_ORIGIN || '*',
    jwtSecret: process.env.JWT_SECRET || 'change-me-to-a-long-random-string',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
    admin: {
        email: process.env.ADMIN_EMAIL || 'admin@mphmis.local',
        password: process.env.ADMIN_PASSWORD || 'admin123',
        name: process.env.ADMIN_NAME || 'System Administrator'
    },
    dbFile: fromRoot(process.env.DB_FILE || './data/hmis-grievance.db'),
    projectRoot,

    // AI for "Rewrite with AI". Local-first (Ollama) so grievance text — which may contain
    // patient details — never leaves the server. provider: 'ollama' | 'groq' | 'none'.
    ai: {
        provider: (process.env.AI_PROVIDER || 'ollama').toLowerCase(),
        timeoutMs: Number(process.env.AI_TIMEOUT_MS || 30000),
        ollama: {
            baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
            model: process.env.OLLAMA_MODEL || 'llama3.2:3b'
        },
        groq: {
            apiKey: process.env.GROQ_API_KEY || '',
            baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
            model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
        }
    },

    // Email for ticket auto-assignment notifications. When SMTP isn't configured the notifier
    // logs the message instead of sending, so the flow still works out of the box.
    email: {
        enabled: process.env.EMAIL_ENABLED === 'true',
        from: process.env.EMAIL_FROM || 'HMIS Helpdesk <helpdesk@mphmis.local>',
        smtp: {
            host: process.env.SMTP_HOST || '',
            port: Number(process.env.SMTP_PORT || 587),
            secure: process.env.SMTP_SECURE === 'true',
            user: process.env.SMTP_USER || '',
            pass: process.env.SMTP_PASS || ''
        }
    },

    // TLS — when a key + cert are provided the server runs over HTTPS so PII (names, mobiles,
    // emails) is encrypted in transit rather than sent as plain text.
    ssl: {
        keyFile: process.env.SSL_KEY_FILE ? fromRoot(process.env.SSL_KEY_FILE) : '',
        certFile: process.env.SSL_CERT_FILE ? fromRoot(process.env.SSL_CERT_FILE) : ''
    }
});
