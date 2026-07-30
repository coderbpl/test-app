/**
 * Standardized success payload.
 *
 * @param {import('express').Response} res
 * @param {*} [data]
 * @param {string} [message]
 * @param {number} [statusCode]
 */
export function sendSuccess(res, data = null, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
        success: true,
        message,
        data,
        timestamp: new Date().toISOString()
    });
}

/**
 * Standardized 201 Created payload.
 */
export function sendCreated(res, data = null, message = 'Created successfully') {
    return sendSuccess(res, data, message, 201);
}

/**
 * Standardized paginated payload.
 *
 * @param {import('express').Response} res
 * @param {Array} data
 * @param {number} total
 * @param {number} page
 * @param {number} limit
 * @param {string} [message]
 */
export function sendPaginated(res, data, total, page, limit, message = 'Success') {
    return res.status(200).json({
        success: true,
        message,
        data,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit))
        },
        timestamp: new Date().toISOString()
    });
}
