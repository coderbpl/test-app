import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthorizedError, ForbiddenError } from '../utils/ApiError.js';

/** Requires a valid agent Bearer token; attaches decoded payload to req.agent. */
export function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next(new UnauthorizedError());
    try {
        req.agent = jwt.verify(header.slice(7), env.jwtSecret);
        next();
    } catch {
        next(new UnauthorizedError('Invalid or expired token'));
    }
}

/** Restricts a route to the given agent roles. */
export function authorize(...roles) {
    return (req, res, next) => {
        if (!req.agent) return next(new UnauthorizedError());
        if (!roles.includes(req.agent.role)) return next(new ForbiddenError('Insufficient permissions'));
        next();
    };
}
