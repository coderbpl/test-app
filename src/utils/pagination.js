const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Normalizes page/limit query params into safe values plus an offset.
 *
 * @param {object} query
 * @returns {{page: number, limit: number, offset: number}}
 */
export function sanitizePagination(query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
    return { page, limit, offset: (page - 1) * limit };
}

export default sanitizePagination;
