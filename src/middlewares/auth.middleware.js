import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthorizedError, ForbiddenError } from '../utils/ApiError.js';

/**
 * Requires a valid officer Bearer token; attaches the decoded payload to `req.officer`.
 */
export function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return next(new UnauthorizedError());
    }
    try {
        req.officer = jwt.verify(header.slice(7), env.jwtSecret);
        next();
    } catch {
        next(new UnauthorizedError('Invalid or expired token'));
    }
}

/**
 * Restricts a route to the given officer roles (e.g. 'admin').
 *
 * @param {...string} roles
 */
export function authorize(...roles) {
    return (req, res, next) => {
        if (!req.officer) return next(new UnauthorizedError());
        if (!roles.includes(req.officer.role)) return next(new ForbiddenError('Insufficient permissions'));
        next();
    };
}
