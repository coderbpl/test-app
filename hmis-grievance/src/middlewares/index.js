import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthorizedError, ForbiddenError, ValidationError } from '../utils/index.js';

/** Requires a valid staff Bearer token; attaches decoded payload to req.staff. */
export function authenticate(req, res, next) {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return next(new UnauthorizedError());
    try { req.staff = jwt.verify(h.slice(7), env.jwtSecret); next(); }
    catch { next(new UnauthorizedError('Invalid or expired token')); }
}
export function authorize(...roles) {
    return (req, res, next) => {
        if (!req.staff) return next(new UnauthorizedError());
        if (!roles.includes(req.staff.role)) return next(new ForbiddenError('Insufficient permissions'));
        next();
    };
}

/** Joi validation middleware factory. */
export function validate(schema, source = 'body') {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[source], { abortEarly: false, convert: true, stripUnknown: true });
        if (error) return next(new ValidationError(error.details.map((d) => d.message.replace(/"/g, '')).join('; ')));
        if (source === 'query') Object.defineProperty(req, 'query', { value, writable: true, configurable: true, enumerable: true });
        else req[source] = value;
        next();
    };
}
export const vBody = (s) => validate(s, 'body');
export const vParams = (s) => validate(s, 'params');
export const vQuery = (s) => validate(s, 'query');

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
