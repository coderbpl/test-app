import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import apiRoutes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the configured Express app (routes, static UI, error handling). Kept separate from
 * server.js so it can be imported in tests without binding a port.
 */
export function createApp() {
    const app = express();

    // Relaxed CSP so the bundled vanilla-JS UI (inline styles/scripts) renders.
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors({ origin: env.corsOrigin === '*' ? '*' : env.corsOrigin.split(',') }));
    app.use(express.json({ limit: '2mb' }));
    app.use(express.urlencoded({ extended: true }));
    if (env.nodeEnv !== 'test') app.use(morgan('dev'));

    // Basic abuse protection on the public API.
    app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, message: { success: false, error: 'Too many requests, try later' } }));

    // Static citizen + officer UI.
    app.use(express.static(path.join(__dirname, '..', 'public')));

    app.use('/api', apiRoutes);

    app.use('/api', notFoundHandler);
    app.use(errorHandler);

    return app;
}

export default createApp;
