import { env } from '../config/env.js';

/**
 * 404 handler for unmatched API routes.
 */
export function notFoundHandler(req, res) {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.originalUrl,
        timestamp: new Date().toISOString()
    });
}

/**
 * Central error handler. Maps ApiError (and anything else) to a consistent JSON shape.
 *
 * @param {Error & {statusCode?: number}} err
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
    const statusCode = err.statusCode || 500;
    const isDev = env.nodeEnv !== 'production';

    if (statusCode >= 500) {
        // eslint-disable-next-line no-console
        console.error('[error]', err);
    }

    res.status(statusCode).json({
        success: false,
        error: err.message || 'Internal server error',
        ...(isDev && statusCode >= 500 ? { stack: err.stack?.split('\n') } : {}),
        timestamp: new Date().toISOString()
    });
}
