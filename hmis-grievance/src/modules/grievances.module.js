import { Router } from 'express';
import Joi from 'joi';
import { db } from '../config/db.js';
import { sendSuccess, sendCreated, sendPaginated, asyncHandler, sanitizePagination, buildRef, NotFoundError, BadRequestError } from '../utils/index.js';
import { authenticate, vBody, vParams, vQuery } from '../middlewares/index.js';
import { rewriteText, aiEnabled } from './ai.service.js';

const nowIso = () => new Date().toISOString();
const PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const STATUS = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'];
const TIER = ['FACILITY', 'BLOCK', 'DISTRICT', 'DIVISION', 'STATE'];

// ---- Validation ----
const createSchema = Joi.object({
    categoryId: Joi.number().integer().positive().optional(),
    hospitalId: Joi.number().integer().positive().optional(),
    subject: Joi.string().max(250).allow('', null),
    description: Joi.string().min(5).max(2000).required(),
    isAnonymous: Joi.boolean().default(false),
    complainantName: Joi.string().max(150).allow('', null),
    complainantMobile: Joi.string().max(20).allow('', null),
    complainantEmail: Joi.string().email({ tlds: { allow: false } }).allow('', null),
    facility: Joi.string().max(150).allow('', null),
    department: Joi.string().max(100).allow('', null)
});
const rewriteSchema = Joi.object({
    subject: Joi.string().max(250).allow('', null),
    text: Joi.string().min(3).max(2000).required()
});
const idParam = Joi.object({ id: Joi.number().integer().positive().required() });
const refParam = Joi.object({ refNo: Joi.string().max(30).required() });
const listQuery = Joi.object({
    page: Joi.number().integer().positive().default(1),
    limit: Joi.number().integer().positive().max(100).default(20),
    search: Joi.string().max(200).optional(),
    status: Joi.string().valid(...STATUS).optional(),
    priority: Joi.string().valid(...PRIORITY).optional(),
    categoryId: Joi.number().integer().positive().optional(),
    hospitalId: Joi.number().integer().positive().optional(),
    isUrgent: Joi.boolean().optional()
});
const statusSchema = Joi.object({ status: Joi.string().valid(...STATUS).required(), comment: Joi.string().max(2000).allow('', null), resolution: Joi.string().max(5000).allow('', null) });
const assignSchema = Joi.object({ staffId: Joi.number().integer().positive().required() });
const escalateSchema = Joi.object({ toTier: Joi.string().valid(...TIER).required(), reason: Joi.string().max(2000).allow('', null) });
const commentSchema = Joi.object({ comment: Joi.string().min(1).max(2000).required(), isInternal: Joi.boolean().default(false) });

// ---- Data ----
const ROW = `
    g.id, g.ref_no AS refNo, g.category_id AS categoryId, c.name AS categoryName, c.name_hi AS categoryNameHi,
    g.subject, g.description, g.language, g.is_anonymous AS isAnonymous,
    g.complainant_name AS complainantName, g.complainant_mobile AS complainantMobile, g.complainant_email AS complainantEmail,
    g.hospital_id AS hospitalId, h.name AS hospitalName, g.facility, g.department, g.priority, g.status, g.is_urgent AS isUrgent,
    g.current_owner_tier AS currentOwnerTier,
    g.assigned_staff_id AS assignedStaffId, s.name AS assignedStaffName, g.resolution,
    g.resolved_at AS resolvedAt, g.closed_at AS closedAt, g.created_at AS createdAt, g.updated_at AS updatedAt`;

function timeline(gid, e) {
    db.prepare(`INSERT INTO grievance_timeline (grievance_id, event_type, from_status, to_status, comment, actor_staff_id, actor_name, is_internal)
                VALUES (@gid, @type, @from, @to, @comment, @actorId, @actorName, @internal)`)
        .run({ gid, type: e.type, from: e.from ?? null, to: e.to ?? null, comment: e.comment ?? null, actorId: e.actorId ?? null, actorName: e.actorName ?? null, internal: e.internal ? 1 : 0 });
}
function getRow(id) {
    return db.prepare(`SELECT ${ROW} FROM grievances g LEFT JOIN grievance_categories c ON c.id = g.category_id LEFT JOIN staff s ON s.id = g.assigned_staff_id LEFT JOIN hospitals h ON h.id = g.hospital_id WHERE g.id = ?`).get(id) || null;
}

/**
 * Creates a grievance (priority seeded from the category). Optionally links back to a
 * feedback row that triggered it. Returns the created grievance.
 */
export function createGrievance(dto, { actorName = null, actorId = null } = {}) {
    let priority = 'MEDIUM';
    if (dto.categoryId) {
        const cat = db.prepare('SELECT * FROM grievance_categories WHERE id = ?').get(dto.categoryId);
        if (!cat) throw new BadRequestError('Invalid category');
        priority = cat.default_priority;
    }
    const tx = db.transaction(() => {
        const info = db.prepare(
            `INSERT INTO grievances (category_id, hospital_id, subject, description, is_anonymous, complainant_name, complainant_mobile,
                                     complainant_email, facility, department, priority, status, current_owner_tier)
             VALUES (@categoryId, @hospitalId, @subject, @description, @isAnonymous, @cname, @cmobile, @cemail, @facility, @department, @priority, 'NEW', 'FACILITY')`
        ).run({
            categoryId: dto.categoryId ?? null, hospitalId: dto.hospitalId ?? null, subject: dto.subject ?? null, description: dto.description,
            isAnonymous: dto.isAnonymous ? 1 : 0, cname: dto.complainantName ?? null, cmobile: dto.complainantMobile ?? null,
            cemail: dto.complainantEmail ?? null, facility: dto.facility ?? null, department: dto.department ?? null,
            priority
        });
        const id = Number(info.lastInsertRowid);
        db.prepare('UPDATE grievances SET ref_no = ? WHERE id = ?').run(buildRef('GRV', id), id);
        timeline(id, { type: 'CREATED', to: 'NEW', comment: 'Grievance filed', actorId, actorName: actorName || dto.complainantName || 'Anonymous' });
        return id;
    });
    return getRow(tx());
}

function detail(id) {
    const g = getRow(id);
    if (!g) return null;
    const tl = db.prepare(`SELECT id, event_type AS eventType, from_status AS fromStatus, to_status AS toStatus, comment,
                                  actor_name AS actorName, is_internal AS isInternal, created_at AS createdAt
                           FROM grievance_timeline WHERE grievance_id = ? ORDER BY created_at ASC, id ASC`).all(id);
    return { ...g, timeline: tl };
}

// ---- Router ----
const router = Router();

router.get('/categories', asyncHandler((req, res) => {
    sendSuccess(res, db.prepare('SELECT id, code, name, name_hi AS nameHi, default_priority AS defaultPriority FROM grievance_categories WHERE status = 1 ORDER BY name').all(), 'Categories');
}));

router.post('/rewrite', vBody(rewriteSchema), asyncHandler(async (req, res) => {
    const rewritten = await rewriteText({ subject: req.body.subject, text: req.body.text });
    sendSuccess(res, { rewritten, aiAvailable: rewritten !== null }, rewritten ? 'Rewritten' : (aiEnabled() ? 'AI service is not reachable' : 'AI is not configured'));
}));

router.post('/', vBody(createSchema), asyncHandler((req, res) => {
    const g = createGrievance(req.body);
    sendCreated(res, g, `Grievance filed. Tracking number: ${g.refNo}`);
}));

router.get('/track/:refNo', vParams(refParam), asyncHandler((req, res) => {
    const g = db.prepare(`SELECT g.ref_no AS refNo, c.name AS categoryName, g.subject, g.priority, g.status, g.created_at AS createdAt, g.resolved_at AS resolvedAt
                          FROM grievances g LEFT JOIN grievance_categories c ON c.id = g.category_id WHERE g.ref_no = ?`).get(req.params.refNo);
    if (!g) throw new NotFoundError('No grievance found for that tracking number');
    const tl = db.prepare(`SELECT t.event_type AS eventType, t.to_status AS toStatus, t.comment, t.actor_name AS actorName, t.created_at AS createdAt
                           FROM grievance_timeline t JOIN grievances gg ON gg.id = t.grievance_id WHERE gg.ref_no = ? AND t.is_internal = 0 ORDER BY t.created_at ASC`).all(req.params.refNo);
    sendSuccess(res, { ...g, timeline: tl }, 'Grievance status');
}));

router.get('/', authenticate, vQuery(listQuery), asyncHandler((req, res) => {
    const { page, limit, offset } = sanitizePagination(req.query);
    const where = []; const p = {};
    if (req.query.search) { where.push('(g.subject LIKE @s OR g.description LIKE @s OR g.ref_no LIKE @s)'); p.s = `%${req.query.search}%`; }
    const add = (c, k, v) => { if (v !== undefined && v !== '') { where.push(c); p[k] = v; } };
    add('g.status = @status', 'status', req.query.status);
    add('g.priority = @priority', 'priority', req.query.priority);
    add('g.category_id = @categoryId', 'categoryId', req.query.categoryId);
    add('g.hospital_id = @hospitalId', 'hospitalId', req.query.hospitalId);
    if (req.query.isUrgent !== undefined) { where.push('g.is_urgent = @u'); p.u = req.query.isUrgent ? 1 : 0; }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT ${ROW}
        FROM grievances g LEFT JOIN grievance_categories c ON c.id = g.category_id LEFT JOIN staff s ON s.id = g.assigned_staff_id LEFT JOIN hospitals h ON h.id = g.hospital_id
        ${clause}
        ORDER BY g.is_urgent DESC, CASE g.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, g.created_at DESC
        LIMIT @limit OFFSET @offset`).all({ ...p, limit, offset });
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM grievances g ${clause}`).get(p);
    sendPaginated(res, rows, total, page, limit, 'Grievances');
}));

router.get('/:id', authenticate, vParams(idParam), asyncHandler((req, res) => {
    const d = detail(Number(req.params.id));
    if (!d) throw new NotFoundError('Grievance not found');
    sendSuccess(res, d, 'Grievance detail');
}));

router.patch('/:id/status', authenticate, vParams(idParam), vBody(statusSchema), asyncHandler((req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT status FROM grievances WHERE id = ?').get(id);
    if (!cur) throw new NotFoundError('Grievance not found');
    const { status, comment, resolution } = req.body;
    db.prepare(`UPDATE grievances SET status=@status, resolution=COALESCE(@resolution, resolution),
                    resolved_at=CASE WHEN @status='RESOLVED' THEN @now WHEN @status='REOPENED' THEN NULL ELSE resolved_at END,
                    closed_at=CASE WHEN @status='CLOSED' THEN @now ELSE closed_at END, updated_at=@now WHERE id=@id`)
        .run({ id, status, resolution: resolution ?? null, now: nowIso() });
    timeline(id, { type: 'STATUS_CHANGE', from: cur.status, to: status, comment, actorId: req.staff.id, actorName: req.staff.name });
    sendSuccess(res, getRow(id), 'Status updated');
}));

router.patch('/:id/assign', authenticate, vParams(idParam), vBody(assignSchema), asyncHandler((req, res) => {
    const id = Number(req.params.id);
    if (!getRow(id)) throw new NotFoundError('Grievance not found');
    const staff = db.prepare('SELECT name FROM staff WHERE id = ?').get(req.body.staffId);
    if (!staff) throw new BadRequestError('Unknown staff');
    db.prepare("UPDATE grievances SET assigned_staff_id=?, status=CASE WHEN status='NEW' THEN 'ACKNOWLEDGED' ELSE status END, updated_at=? WHERE id=?").run(req.body.staffId, nowIso(), id);
    timeline(id, { type: 'ASSIGNED', comment: `Assigned to ${staff.name}`, actorId: req.staff.id, actorName: req.staff.name });
    sendSuccess(res, getRow(id), 'Grievance assigned');
}));

router.patch('/:id/escalate', authenticate, vParams(idParam), vBody(escalateSchema), asyncHandler((req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT current_owner_tier AS tier FROM grievances WHERE id = ?').get(id);
    if (!cur) throw new NotFoundError('Grievance not found');
    db.prepare(`UPDATE grievances SET current_owner_tier=@to, assigned_staff_id=NULL,
                    priority=CASE WHEN priority='LOW' THEN 'MEDIUM' WHEN priority='MEDIUM' THEN 'HIGH' ELSE priority END, updated_at=@now WHERE id=@id`)
        .run({ id, to: req.body.toTier, now: nowIso() });
    timeline(id, { type: 'ESCALATED', comment: `Escalated ${cur.tier} → ${req.body.toTier}${req.body.reason ? '. ' + req.body.reason : ''}`, actorId: req.staff.id, actorName: req.staff.name });
    sendSuccess(res, getRow(id), 'Grievance escalated');
}));

router.post('/:id/comments', authenticate, vParams(idParam), vBody(commentSchema), asyncHandler((req, res) => {
    const id = Number(req.params.id);
    if (!getRow(id)) throw new NotFoundError('Grievance not found');
    timeline(id, { type: 'COMMENT', comment: req.body.comment, internal: req.body.isInternal, actorId: req.staff.id, actorName: req.staff.name });
    db.prepare('UPDATE grievances SET updated_at = ? WHERE id = ?').run(nowIso(), id);
    sendSuccess(res, detail(id), 'Comment added');
}));

export default router;
