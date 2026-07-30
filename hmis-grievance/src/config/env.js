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
    slaSweepCron: process.env.SLA_SWEEP_CRON || '*/15 * * * *'
});
