/**
 * Public ticket reference: TKT-YYYY-NNNNNN (zero-padded row id).
 *
 * @param {number} id
 * @param {Date} [date]
 * @returns {string}
 */
export function buildRefNo(id, date = new Date()) {
    return `TKT-${date.getUTCFullYear()}-${String(id).padStart(6, '0')}`;
}

export default buildRefNo;
