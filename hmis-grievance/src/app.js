import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import apiRoutes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middlewares/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
    const app = express();
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors({ origin: env.corsOrigin === '*' ? '*' : env.corsOrigin.split(',') }));
    app.use(express.json({ limit: '2mb' }));
    app.use(express.urlencoded({ extended: true }));
    if (env.nodeEnv !== 'test') app.use(morgan('dev'));
    app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 400, message: { success: false, error: 'Too many requests' } }));
    app.use(express.static(path.join(__dirname, '..', 'public')));
    app.use('/api', apiRoutes);
    app.use('/api', notFoundHandler);
    app.use(errorHandler);
    return app;
}
export default createApp;
