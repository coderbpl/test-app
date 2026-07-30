/**
 * Builds the public tracking number for a grievance: GRV-YYYY-NNNNNN, where NNNNNN is the
 * zero-padded row id. The id guarantees uniqueness; the year makes it human-scannable.
 *
 * @param {number} id - Grievance row id.
 * @param {Date} [date] - Filing date (defaults to now).
 * @returns {string}
 */
export function buildTrackingNo(id, date = new Date()) {
    const year = date.getUTCFullYear();
    return `GRV-${year}-${String(id).padStart(6, '0')}`;
}

export default buildTrackingNo;
