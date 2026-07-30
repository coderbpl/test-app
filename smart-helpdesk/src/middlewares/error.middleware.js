import { env } from '../config/env.js';

export function notFoundHandler(req, res) {
    res.status(404).json({ success: false, error: 'Endpoint not found', path: req.originalUrl, timestamp: new Date().toISOString() });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) console.error('[error]', err); // eslint-disable-line no-console
    res.status(statusCode).json({
        success: false,
        error: err.message || 'Internal server error',
        ...(env.nodeEnv !== 'production' && statusCode >= 500 ? { stack: err.stack?.split('\n') } : {}),
        timestamp: new Date().toISOString()
    });
}
