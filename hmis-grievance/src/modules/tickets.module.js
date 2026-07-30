import { Router } from 'express';
import Joi from 'joi';
import { db } from '../config/db.js';
import { sendSuccess, sendCreated, sendPaginated, asyncHandler, sanitizePagination, buildRef, NotFoundError, BadRequestError } from '../utils/index.js';
import { authenticate, vBody, vParams, vQuery } from '../middlewares/index.js';
import { tokenize, toVector, cosine } from '../utils/textSimilarity.js';

const nowIso = () => new Date().toISOString();
const CATEGORY = ['IT', 'BIOMEDICAL', 'FACILITY', 'HOUSEKEEPING', 'SUPPLY', 'OTHER'];
const PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const STATUS = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'REOPENED'];
const THRESHOLD = 0.12, TOP_K = 5;

const createSchema = Joi.object({
    subject: Joi.string().min(3).max(250).required(),
    body: Joi.string().min(3).max(10000).required(),
    category: Joi.string().valid(...CATEGORY).optional(),
    priority: Joi.string().valid(...PRIORITY).optional(),
    facility: Joi.string().max(150).allow('', null)
});
const idParam = Joi.object({ id: Joi.number().integer().positive().required() });
const listQuery = Joi.object({
    page: Joi.number().integer().positive().default(1), limit: Joi.number().integer().positive().max(100).default(20),
    search: Joi.string().max(200).optional(), status: Joi.string().valid(...STATUS).optional(),
    priority: Joi.string().valid(...PRIORITY).optional(), category: Joi.string().valid(...CATEGORY).optional(),
    assignedStaffId: Joi.alternatives(Joi.number().integer().positive(), Joi.string().valid('me')).optional()
});
const assignSchema = Joi.object({ staffId: Joi.number().integer().positive().required() });
const statusSchema = Joi.object({ status: Joi.string().valid(...STATUS).required(), resolution: Joi.string().max(5000).allow('', null) });
const replySchema = Joi.object({ body: Joi.string().min(1).max(10000).required(), isInternal: Joi.boolean().default(false) });

const ROW = `
    t.id, t.ref_no AS refNo, t.subject, t.body, t.category, t.facility, t.priority, t.status,
    t.raised_by_staff_id AS raisedByStaffId, t.assigned_staff_id AS assignedStaffId, s.name AS assignedStaffName,
    t.resolution, t.resolved_at AS resolvedAt, t.created_at AS createdAt, t.updated_at AS updatedAt`;

function getRow(id) {
    return db.prepare(`SELECT ${ROW} FROM tickets t LEFT JOIN staff s ON s.id = t.assigned_staff_id WHERE t.id = ?`).get(id) || null;
}
function event(id, type, detail, actorName) {
    db.prepare('INSERT INTO ticket_events (ticket_id, event_type, detail, actor_name) VALUES (?, ?, ?, ?)').run(id, type, detail ?? null, actorName ?? null);
}

// ---- Recommendation engine (local) ----
function findSimilar(ticket, limit = TOP_K) {
    const target = toVector(tokenize(`${ticket.subject} ${ticket.body}`));
    if (!target.norm) return [];
    const rows = db.prepare(`SELECT t.id, t.ref_no AS refNo, t.subject, t.body, t.status, t.resolution,
                                    t.assigned_staff_id AS assignedStaffId, s.name AS staffName
                             FROM tickets t LEFT JOIN staff s ON s.id = t.assigned_staff_id WHERE t.id != @id`).all({ id: ticket.id ?? -1 });
    return rows.map((r) => { const { body, ...rest } = r; return { ...rest, score: cosine(target, toVector(tokenize(`${r.subject} ${body}`))) }; })
        .filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
        .map((r) => ({ ...r, score: Math.round(r.score * 1000) / 1000 }));
}
function recommendStaff(similar) {
    const votes = new Map();
    for (const s of similar) {
        if (s.score < THRESHOLD || !s.assignedStaffId || !['RESOLVED', 'CLOSED'].includes(s.status)) continue;
        const v = votes.get(s.assignedStaffId) || { name: s.staffName, score: 0, count: 0 };
        v.score += s.score; v.count += 1; votes.set(s.assignedStaffId, v);
    }
    if (!votes.size) return null;
    let best = null;
    for (const [staffId, v] of votes) if (!best || v.score > best.score) best = { staffId, ...v };
    return { staffId: best.staffId, staffName: best.name, score: Math.round(best.score * 1000) / 1000, basedOn: best.count, reason: `Resolved ${best.count} similar ticket${best.count > 1 ? 's' : ''}` };
}
function leastLoaded() {
    const row = db.prepare(`SELECT s.id AS staffId, s.name AS staffName,
            (SELECT COUNT(*) FROM tickets t WHERE t.assigned_staff_id = s.id AND t.status NOT IN ('RESOLVED','CLOSED')) AS load
        FROM staff s WHERE s.status = 1 AND s.role = 'agent' ORDER BY load ASC, s.id ASC LIMIT 1`).get();
    return row ? { staffId: row.staffId, staffName: row.staffName, reason: 'Least-loaded agent (no similar history)' } : null;
}
function buildRecommendation(ticket) {
    const similar = findSimilar(ticket);
    const bySim = recommendStaff(similar);
    const recommended = bySim || leastLoaded();
    return { similar, recommended, source: bySim ? 'similarity' : (recommended ? 'load-balance' : 'none') };
}

function assign(id, staffId, staffName, { auto = false, actorName } = {}) {
    db.prepare("UPDATE tickets SET assigned_staff_id=?, status=CASE WHEN status='OPEN' THEN 'ASSIGNED' ELSE status END, updated_at=? WHERE id=?").run(staffId, nowIso(), id);
    event(id, auto ? 'AUTO_ASSIGNED' : 'ASSIGNED', `Assigned to ${staffName}`, actorName || (auto ? 'Auto-router' : staffName));
}

/**
 * Creates a ticket and auto-routes it to the best-matching staff member. Shared by the API route
 * and by other modules (e.g. a poor HMIS-app feedback auto-raises an IT ticket).
 *
 * @param {{subject:string, body:string, category?:string, priority?:string, facility?:string,
 *          raisedByStaffId?:number|null, createdByName?:string|null}} dto
 * @returns {{ ticket: object, recommendation: object }}
 */
export function createTicketAutoRouted(dto) {
    const info = db.prepare(`INSERT INTO tickets (subject, body, category, facility, priority, status, raised_by_staff_id)
                             VALUES (@subject, @body, @category, @facility, @priority, 'OPEN', @by)`)
        .run({ subject: dto.subject, body: dto.body, category: dto.category ?? null, facility: dto.facility ?? null, priority: dto.priority || 'MEDIUM', by: dto.raisedByStaffId ?? null });
    const id = Number(info.lastInsertRowid);
    db.prepare('UPDATE tickets SET ref_no = ? WHERE id = ?').run(buildRef('TKT', id), id);
    event(id, 'CREATED', dto.createdByName ? `Raised by ${dto.createdByName}` : 'Created', dto.createdByName ?? null);
    const ticket = getRow(id);
    const recommendation = buildRecommendation(ticket);
    if (recommendation.recommended) {
        const r = recommendation.recommended;
        assign(id, r.staffId, r.staffName, { auto: true });
        event(id, 'RECOMMENDATION', `Suggested ${r.staffName}: ${r.reason} (${recommendation.source})`, 'Recommendation engine');
    }
    return { ticket: getRow(id), recommendation };
}

// ---- Router (all staff-auth: internal tickets) ----
const router = Router();
router.use(authenticate);

router.post('/', vBody(createSchema), asyncHandler((req, res) => {
    const d = req.body;
    const result = createTicketAutoRouted({ ...d, raisedByStaffId: req.staff.id, createdByName: req.staff.name });
    sendCreated(res, result, `Ticket created: ${result.ticket.refNo}`);
}));

router.get('/staff-directory', asyncHandler((req, res) => {
    sendSuccess(res, db.prepare("SELECT id, name, department, skills FROM staff WHERE status = 1 AND role IN ('agent','officer') ORDER BY name").all(), 'Assignable staff');
}));

router.get('/', vQuery(listQuery), asyncHandler((req, res) => {
    const { page, limit, offset } = sanitizePagination(req.query);
    const where = []; const p = {};
    if (req.query.search) { where.push('(t.subject LIKE @s OR t.body LIKE @s OR t.ref_no LIKE @s)'); p.s = `%${req.query.search}%`; }
    const add = (c, k, v) => { if (v !== undefined && v !== '') { where.push(c); p[k] = v; } };
    add('t.status = @status', 'status', req.query.status);
    add('t.priority = @priority', 'priority', req.query.priority);
    add('t.category = @category', 'category', req.query.category);
    add('t.assigned_staff_id = @asid', 'asid', req.query.assignedStaffId === 'me' ? req.staff.id : req.query.assignedStaffId);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT ${ROW} FROM tickets t LEFT JOIN staff s ON s.id = t.assigned_staff_id ${clause}
        ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, t.created_at DESC
        LIMIT @limit OFFSET @offset`).all({ ...p, limit, offset });
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM tickets t ${clause}`).get(p);
    sendPaginated(res, rows, total, page, limit, 'Tickets');
}));

router.get('/:id', vParams(idParam), asyncHandler((req, res) => {
    const id = Number(req.params.id);
    const t = getRow(id);
    if (!t) throw new NotFoundError('Ticket not found');
    const messages = db.prepare('SELECT id, direction, author_name AS authorName, body, is_internal AS isInternal, created_at AS createdAt FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(id);
    const events = db.prepare('SELECT event_type AS eventType, detail, actor_name AS actorName, created_at AS createdAt FROM ticket_events WHERE ticket_id = ? ORDER BY created_at ASC').all(id);
    sendSuccess(res, { ...t, messages, events, recommendation: buildRecommendation(t) }, 'Ticket detail');
}));

router.patch('/:id/assign', vParams(idParam), vBody(assignSchema), asyncHandler((req, res) => {
    const id = Number(req.params.id);
    if (!getRow(id)) throw new NotFoundError('Ticket not found');
    const staff = db.prepare('SELECT name FROM staff WHERE id = ?').get(req.body.staffId);
    if (!staff) throw new BadRequestError('Unknown staff');
    assign(id, req.body.staffId, staff.name, { actorName: req.staff.name });
    sendSuccess(res, getRow(id), 'Ticket assigned');
}));

router.post('/:id/assign-to-me', vParams(idParam), asyncHandler((req, res) => {
    const id = Number(req.params.id);
    if (!getRow(id)) throw new NotFoundError('Ticket not found');
    assign(id, req.staff.id, req.staff.name, { actorName: req.staff.name });
    sendSuccess(res, getRow(id), 'Assigned to you');
}));

router.post('/:id/auto-assign', vParams(idParam), asyncHandler((req, res) => {
    const id = Number(req.params.id);
    const t = getRow(id);
    if (!t) throw new NotFoundError('Ticket not found');
    const rec = buildRecommendation(t);
    if (!rec.recommended) throw new BadRequestError('No staff could be recommended');
    assign(id, rec.recommended.staffId, rec.recommended.staffName, { auto: true, actorName: req.staff.name });
    sendSuccess(res, { ticket: getRow(id), recommendation: rec }, 'Ticket auto-assigned');
}));

router.patch('/:id/status', vParams(idParam), vBody(statusSchema), asyncHandler((req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT status FROM tickets WHERE id = ?').get(id);
    if (!cur) throw new NotFoundError('Ticket not found');
    db.prepare(`UPDATE tickets SET status=@status, resolution=COALESCE(@resolution, resolution),
                    resolved_at=CASE WHEN @status='RESOLVED' THEN @now ELSE resolved_at END, updated_at=@now WHERE id=@id`)
        .run({ id, status: req.body.status, resolution: req.body.resolution ?? null, now: nowIso() });
    event(id, 'STATUS_CHANGE', `${cur.status} → ${req.body.status}`, req.staff.name);
    sendSuccess(res, getRow(id), 'Status updated');
}));

router.post('/:id/reply', vParams(idParam), vBody(replySchema), asyncHandler((req, res) => {
    const id = Number(req.params.id);
    if (!getRow(id)) throw new NotFoundError('Ticket not found');
    db.prepare('INSERT INTO ticket_messages (ticket_id, direction, staff_id, author_name, body, is_internal) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, req.body.isInternal ? 'NOTE' : 'REPLY', req.staff.id, req.staff.name, req.body.body, req.body.isInternal ? 1 : 0);
    event(id, req.body.isInternal ? 'NOTE' : 'REPLY', null, req.staff.name);
    db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(nowIso(), id);
    const messages = db.prepare('SELECT id, direction, author_name AS authorName, body, is_internal AS isInternal, created_at AS createdAt FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(id);
    sendSuccess(res, { ...getRow(id), messages }, req.body.isInternal ? 'Note added' : 'Reply added');
}));

export default router;
