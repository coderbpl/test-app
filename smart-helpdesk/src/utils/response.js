export function sendSuccess(res, data = null, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({ success: true, message, data, timestamp: new Date().toISOString() });
}
export function sendCreated(res, data = null, message = 'Created successfully') {
    return sendSuccess(res, data, message, 201);
}
export function sendPaginated(res, data, total, page, limit, message = 'Success') {
    return res.status(200).json({
        success: true,
        message,
        data,
        pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
        timestamp: new Date().toISOString()
    });
}
