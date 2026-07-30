export default class ApiError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        Error.captureStackTrace?.(this, this.constructor);
    }
}
export class BadRequestError extends ApiError { constructor(m = 'Bad request') { super(400, m); } }
export class UnauthorizedError extends ApiError { constructor(m = 'Authentication required') { super(401, m); } }
export class ForbiddenError extends ApiError { constructor(m = 'Access forbidden') { super(403, m); } }
export class NotFoundError extends ApiError { constructor(m = 'Resource not found') { super(404, m); } }
export class ConflictError extends ApiError { constructor(m = 'Resource already exists') { super(409, m); } }
export class ValidationError extends ApiError { constructor(m = 'Validation failed') { super(422, m); } }
