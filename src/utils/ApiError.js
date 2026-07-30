/**
 * Operational HTTP error carrying the status code to send. Thrown by services and mapped to a
 * JSON response by the error middleware.
 */
export default class ApiError extends Error {
    /**
     * @param {number} statusCode - HTTP status code.
     * @param {string} message - Human-readable message.
     */
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        Error.captureStackTrace?.(this, this.constructor);
    }
}

export class BadRequestError extends ApiError {
    constructor(message = 'Bad request') { super(400, message); }
}
export class UnauthorizedError extends ApiError {
    constructor(message = 'Authentication required') { super(401, message); }
}
export class ForbiddenError extends ApiError {
    constructor(message = 'Access forbidden') { super(403, message); }
}
export class NotFoundError extends ApiError {
    constructor(message = 'Resource not found') { super(404, message); }
}
export class ConflictError extends ApiError {
    constructor(message = 'Resource already exists') { super(409, message); }
}
export class ValidationError extends ApiError {
    constructor(message = 'Validation failed') { super(422, message); }
}
