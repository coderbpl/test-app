// Small shared helpers — grouped in one module to keep the tree lean.

export function sendSuccess(res, data = null, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({ success: true, message, data, timestamp: new Date().toISOString() });
}
export function sendCreated(res, data = null, message = 'Created successfully') {
    return sendSuccess(res, data, message, 201);
}
export function sendPaginated(res, data, total, page, limit, message = 'Success') {
    return res.status(200).json({
        success: true, message, data,
        pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
        timestamp: new Date().toISOString()
    });
}

export class ApiError extends Error {
    constructor(statusCode, message) { super(message); this.statusCode = statusCode; this.isOperational = true; Error.captureStackTrace?.(this, this.constructor); }
}
export class BadRequestError extends ApiError { constructor(m = 'Bad request') { super(400, m); } }
export class UnauthorizedError extends ApiError { constructor(m = 'Authentication required') { super(401, m); } }
export class ForbiddenError extends ApiError { constructor(m = 'Access forbidden') { super(403, m); } }
export class NotFoundError extends ApiError { constructor(m = 'Resource not found') { super(404, m); } }
export class ValidationError extends ApiError { constructor(m = 'Validation failed') { super(422, m); } }

export function asyncHandler(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function sanitizePagination(query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    return { page, limit, offset: (page - 1) * limit };
}

/**
 * Public reference number: PREFIX-YYYY-NNNNNN.
 * @param {string} prefix - GRV | FBK | TKT
 * @param {number} id
 */
export function buildRef(prefix, id, date = new Date()) {
    return `${prefix}-${date.getUTCFullYear()}-${String(id).padStart(6, '0')}`;
}
