/**
 * Wraps an async Express handler so rejected promises are forwarded to the error middleware.
 *
 * @param {import('express').RequestHandler} handler
 * @returns {import('express').RequestHandler}
 */
export function asyncHandler(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export default asyncHandler;
