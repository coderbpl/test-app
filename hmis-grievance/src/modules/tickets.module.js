import { Router } from 'express';
import Joi from 'joi';
import { db } from '../config/db.js';
import { sendSuccess, sendCreated, sendPaginated, asyncHandler, sanitizePagination, buildRef, NotFoundError, BadRequestError } from '../utils/index.js';
import { authenticate, vBody, vParams, vQuery } from '../middlewares/index.js';
import { tokenize, toVector, cosine } from '../utils/textSimilarity.js';
import { sendMail } from './email.service.js';
import { rewriteText, aiEnabled, analyzeGrievance } from './ai.service.js';

const nowIso = () => new Date().toISOString();
const CATEGORY = ['BUG', 'FEATURE', 'API', 'DATABASE', 'UI_UX', 'DEPLOYMENT', 'GRIEVANCE', 'OTHER'];
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
// Public grievance/issue intake (citizen-facing) — becomes a ticket routed to a developer.
const publicSchema = Joi.object({
    description: Joi.string().min(5).max(5000).required(),
    subject: Joi.string().max(250).allow('', null),
    hospitalId: Joi.number().integer().positive().optional(),
    isAnonymous: Joi.boolean().default(false),
    requesterName: Joi.string().max(150).allow('', null),
    requesterEmail: Joi.string().email({ tlds: { allow: false } }).allow('', null),
    requesterMobile: Joi.string().max(20).allow('', null)
});
const refParam = Joi.object({ refNo: Joi.string().max(30).required() });
const rewriteSchema = Joi.object({ subject: Joi.string().max(250).allow('', null), text: Joi.string().min(3).max(5000).required() });
const analysisSchema = Joi.object({
    rootCause: Joi.string().max(8000).allow('', null),
    technicalAnalysis: Joi.string().max(8000).allow('', null),
    module: Joi.string().max(50).allow('', null),
    technology: Joi.string().valid('UI_UX', 'BACKEND', 'DATABASE', 'MOBILE').allow('', null),
    severity: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'CRITICAL').allow('', null)
});

const ROW = `
    t.id, t.ref_no AS refNo, t.subject, t.body, t.category, t.source, t.facility,
    t.hospital_id AS hospitalId, h.name AS hospitalName,
    t.requester_name AS requesterName, t.requester_email AS requesterEmail, t.requester_mobile AS requesterMobile, t.is_anonymous AS isAnonymous,
    t.priority, t.severity, t.module, t.technology, t.ai_summary AS aiSummary,
    t.root_cause AS rootCause, t.technical_analysis AS technicalAnalysis,
    t.status, t.raised_by_staff_id AS raisedByStaffId, t.assigned_staff_id AS assignedStaffId,
    s.name AS assignedStaffName, s.specialty AS assignedStaffSpecialty,
    t.resolution, t.resolved_at AS resolvedAt, t.created_at AS createdAt, t.updated_at AS updatedAt`;
const JOINS = 'LEFT JOIN staff s ON s.id = t.assigned_staff_id LEFT JOIN hospitals h ON h.id = t.hospital_id';

function getRow(id) {
    return db.prepare(`SELECT ${ROW} FROM tickets t ${JOINS} WHERE t.id = ?`).get(id) || null;
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
                             FROM tickets t LEFT JOIN staff s ON s.id = t.assigned_staff_id
                             WHERE t.id != @id AND t.status IN ('RESOLVED','CLOSED')`).all({ id: ticket.id ?? -1 });
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
/** Matches the ticket description against each developer's skill tags. */
function skillsMatch(ticket) {
    const tokens = new Set(tokenize(`${ticket.subject} ${ticket.body}`));
    const devs = db.prepare("SELECT id AS staffId, name AS staffName, skills FROM staff WHERE status = 1 AND grade = 'DEVELOPER'").all();
    let best = null;
    for (const d of devs) {
        const hits = (d.skills || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).filter((t) => tokens.has(t)).length;
        if (hits > 0 && (!best || hits > best.hits)) best = { staffId: d.staffId, staffName: d.staffName, hits };
    }
    return best ? { staffId: best.staffId, staffName: best.staffName, reason: `Skill match (${best.hits} keyword${best.hits > 1 ? 's' : ''})` } : null;
}
/** Least-loaded developer — final fallback when nothing else matches. */
function leastLoaded() {
    const row = db.prepare(`SELECT s.id AS staffId, s.name AS staffName,
            (SELECT COUNT(*) FROM tickets t WHERE t.assigned_staff_id = s.id AND t.status NOT IN ('RESOLVED','CLOSED')) AS load
        FROM staff s WHERE s.status = 1 AND s.grade = 'DEVELOPER' ORDER BY load ASC, s.id ASC LIMIT 1`).get();
    return row ? { staffId: row.staffId, staffName: row.staffName, reason: 'Least-loaded developer (no matching history)' } : null;
}
/** Least-loaded developer of a given specialty (UI_UX / BACKEND / DATABASE / MOBILE). */
function leastLoadedBySpecialty(specialty) {
    if (!specialty) return null;
    const row = db.prepare(`SELECT s.id AS staffId, s.name AS staffName,
            (SELECT COUNT(*) FROM tickets t WHERE t.assigned_staff_id = s.id AND t.status NOT IN ('RESOLVED','CLOSED')) AS load
        FROM staff s WHERE s.status = 1 AND s.grade = 'DEVELOPER' AND s.specialty = @sp ORDER BY load ASC, s.id ASC LIMIT 1`).get({ sp: specialty });
    return row ? { staffId: row.staffId, staffName: row.staffName } : null;
}
/** Emails of the OIC / PM / Technical Lead — CC'd on every grievance assignment. */
function leadershipEmails() {
    return db.prepare("SELECT email FROM staff WHERE status = 1 AND grade IN ('OIC','PM','TL') AND email IS NOT NULL").all().map((r) => r.email);
}
/** Routes a ticket to a developer by description: similar past tickets → skill tags → load. */
function buildRecommendation(ticket) {
    const similar = findSimilar(ticket);
    const bySim = recommendStaff(similar);
    const bySkill = bySim ? null : skillsMatch(ticket);
    const recommended = bySim || bySkill || leastLoaded();
    return { similar, recommended, source: bySim ? 'similarity' : bySkill ? 'skills' : (recommended ? 'load-balance' : 'none') };
}

function assign(id, staffId, staffName, { auto = false, actorName, cc = [] } = {}) {
    db.prepare("UPDATE tickets SET assigned_staff_id=?, status=CASE WHEN status='OPEN' THEN 'ASSIGNED' ELSE status END, updated_at=? WHERE id=?").run(staffId, nowIso(), id);
    event(id, auto ? 'AUTO_ASSIGNED' : 'ASSIGNED', `Assigned to ${staffName}`, actorName || (auto ? 'Auto-router' : staffName));
    notifyAssignee(id, staffId, auto, cc);
}

/** Emails the assignee (CC the OIC/PM/TL) about a ticket; logs an EMAIL event with the outcome. */
function notifyAssignee(ticketId, staffId, auto, cc = []) {
    const t = getRow(ticketId);
    const s = db.prepare('SELECT name, email FROM staff WHERE id = ?').get(staffId);
    if (!t || !s?.email) return;
    const ccList = cc.filter((e) => e && e !== s.email);
    const subject = `[${t.refNo}] ${auto ? 'Auto-assigned' : 'Assigned'} (${t.priority}/${t.severity || '—'}): ${t.subject}`;
    const text = `Hi ${s.name},\n\nGrievance ${t.refNo} has been ${auto ? 'automatically ' : ''}assigned to you based on Groq's analysis.\n\n`
        + `Module: ${t.module || '—'}\nTechnology: ${t.technology || '—'}\nPriority: ${t.priority}   Severity: ${t.severity || '—'}\n`
        + `${t.aiSummary ? `Summary: ${t.aiSummary}\n` : ''}\nOriginal issue:\n${t.body}\n\nPlease open the console to add root cause, analysis, and resolution.\n\n— MPSEDC HMIS Support`;
    sendMail({ to: s.email, cc: ccList, subject, text })
        .then((r) => event(ticketId, 'EMAIL', r.sent
            ? `Emailed ${s.name} <${s.email}>${ccList.length ? ` (cc ${ccList.join(', ')})` : ''}`
            : `Notification logged for ${s.name} <${s.email}>${ccList.length ? ` cc ${ccList.join(', ')}` : ''} (SMTP off)`, 'System'))
        .catch(() => {});
}

/**
 * Creates a ticket and auto-routes it to the best-matching staff member. Shared by the API route
 * and by other modules (e.g. a poor HMIS-app feedback auto-raises an IT ticket).
 *
 * @param {{subject:string, body:string, category?:string, priority?:string, facility?:string,
 *          raisedByStaffId?:number|null, createdByName?:string|null}} dto
 * @returns {{ ticket: object, recommendation: object }}
 */
/** Inserts a ticket row (no routing) and returns its id. */
export function insertTicketRecord(dto) {
    const info = db.prepare(
        `INSERT INTO tickets (subject, body, category, source, facility, hospital_id, requester_name, requester_email,
                              requester_mobile, is_anonymous, priority, status, raised_by_staff_id)
         VALUES (@subject, @body, @category, @source, @facility, @hospitalId, @rname, @remail, @rmobile, @anon, @priority, 'OPEN', @by)`
    ).run({
        subject: dto.subject, body: dto.body, category: dto.category ?? null, source: dto.source || 'STAFF',
        facility: dto.facility ?? null, hospitalId: dto.hospitalId ?? null,
        rname: dto.requesterName ?? null, remail: dto.requesterEmail ?? null, rmobile: dto.requesterMobile ?? null,
        anon: dto.isAnonymous ? 1 : 0, priority: dto.priority || 'MEDIUM', by: dto.raisedByStaffId ?? null
    });
    const id = Number(info.lastInsertRowid);
    db.prepare('UPDATE tickets SET ref_no = ? WHERE id = ?').run(buildRef('TKT', id), id);
    event(id, 'CREATED', dto.createdByName ? `Raised by ${dto.createdByName}` : 'Created', dto.createdByName ?? null);
    return id;
}

/** Creates a ticket and auto-routes it locally (used by feedback + internal staff tickets). */
export function createTicketAutoRouted(dto) {
    const id = insertTicketRecord(dto);
    const recommendation = buildRecommendation(getRow(id));
    if (recommendation.recommended) {
        const r = recommendation.recommended;
        assign(id, r.staffId, r.staffName, { auto: true });
        event(id, 'RECOMMENDATION', `Suggested ${r.staffName}: ${r.reason} (${recommendation.source})`, 'Recommendation engine');
    }
    return { ticket: getRow(id), recommendation };
}

/**
 * Groq-analyzes a grievance (module / technology / priority / severity), then auto-assigns it to a
 * developer of the matching specialty and emails them (CC the OIC/PM/TL). Falls back to local
 * routing when AI is unavailable or returns no technology. Best-effort — never throws.
 */
export async function enrichAndRouteWithAI(id) {
    try {
        const t = getRow(id);
        if (!t) return;
        let dev = null, reason = '', src = '';

        const ai = await analyzeGrievance({ description: t.body });
        if (ai) {
            db.prepare('UPDATE tickets SET module=?, technology=?, severity=?, priority=?, ai_summary=?, updated_at=? WHERE id=?')
                .run(ai.module, ai.technology, ai.severity, ai.priority, ai.summary, nowIso(), id);
            event(id, 'AI_ANALYSIS', `Groq: module=${ai.module}, tech=${ai.technology || '—'}, priority=${ai.priority}, severity=${ai.severity}`, 'Groq AI');
            dev = leastLoadedBySpecialty(ai.technology);
            if (dev) { reason = `${ai.technology} developer for ${ai.module}`; src = 'ai'; }
        }
        if (!dev) {
            const rec = buildRecommendation(getRow(id));
            if (rec.recommended) { dev = { staffId: rec.recommended.staffId, staffName: rec.recommended.staffName }; reason = rec.recommended.reason; src = rec.source; }
        }
        if (dev) {
            assign(id, dev.staffId, dev.staffName, { auto: true, cc: leadershipEmails() });
            event(id, 'RECOMMENDATION', `Assigned ${dev.staffName} — ${reason} (${src})`, 'Router');
        }
    } catch (err) {
        console.warn('[ai] enrichAndRouteWithAI failed:', err.message); // eslint-disable-line no-console
    }
}

// ---- Router ----
const router = Router();

// Public routes (citizen-facing) — declared before the auth guard.
router.post('/rewrite', vBody(rewriteSchema), asyncHandler(async (req, res) => {
    const rewritten = await rewriteText({ subject: req.body.subject, text: req.body.text });
    sendSuccess(res, { rewritten, aiAvailable: rewritten !== null }, rewritten ? 'Rewritten' : (aiEnabled() ? 'AI service is not reachable' : 'AI is not configured'));
}));

// Live "suggested resolutions" while the citizen types — resolutions from similar RESOLVED
// grievances only (no internal fields), for self-service before submitting.
const suggestSchema = Joi.object({ text: Joi.string().min(6).max(2000).required() });
router.post('/suggest', vBody(suggestSchema), asyncHandler((req, res) => {
    const target = toVector(tokenize(req.body.text));
    if (!target.norm) return sendSuccess(res, { suggestions: [] }, 'Suggestions');
    const rows = db.prepare(`SELECT subject, body, module, resolution FROM tickets WHERE status IN ('RESOLVED','CLOSED') AND resolution IS NOT NULL`).all();
    const suggestions = rows
        .map((r) => ({ module: r.module, resolution: r.resolution, score: cosine(target, toVector(tokenize(`${r.subject} ${r.body}`))) }))
        .filter((r) => r.score >= 0.15) // only genuinely similar resolved grievances (drops weak/junk matches)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((r) => ({ module: r.module, resolution: r.resolution, match: Math.round(r.score * 100) }));
    sendSuccess(res, { suggestions }, 'Suggestions');
}));

router.post('/public', vBody(publicSchema), asyncHandler((req, res) => {
    const d = req.body;
    const subject = (d.subject && d.subject.trim()) || d.description.trim().slice(0, 80);
    const id = insertTicketRecord({
        subject, body: d.description, category: 'GRIEVANCE', source: 'WEB', hospitalId: d.hospitalId ?? null,
        isAnonymous: d.isAnonymous,
        requesterName: d.isAnonymous ? null : (d.requesterName || null),
        requesterEmail: d.isAnonymous ? null : (d.requesterEmail || null),
        requesterMobile: d.isAnonymous ? null : (d.requesterMobile || null),
        createdByName: d.isAnonymous ? 'Anonymous' : (d.requesterName || 'Public')
    });
    const ticket = getRow(id);
    enrichAndRouteWithAI(id); // background: Groq analysis → specialty routing → email (CC OIC/PM/TL)
    // Public response carries only the reference — no assignee, analysis, or other internal detail.
    sendCreated(res, { refNo: ticket.refNo, status: ticket.status }, `Submitted. Your reference number is ${ticket.refNo}`);
}));

router.get('/track/:refNo', vParams(refParam), asyncHandler((req, res) => {
    const t = db.prepare(`SELECT ref_no AS refNo, subject, category, priority, status, created_at AS createdAt, resolved_at AS resolvedAt
                          FROM tickets WHERE ref_no = ?`).get(req.params.refNo);
    if (!t) throw new NotFoundError('No record found for that reference number');
    const events = db.prepare(`SELECT te.event_type AS eventType, te.detail, te.created_at AS createdAt
                               FROM ticket_events te JOIN tickets tk ON tk.id = te.ticket_id
                               WHERE tk.ref_no = ? AND te.event_type IN ('CREATED','STATUS_CHANGE') ORDER BY te.created_at ASC`).all(req.params.refNo);
    const replies = db.prepare(`SELECT tm.body AS detail, tm.created_at AS createdAt
                                FROM ticket_messages tm JOIN tickets tk ON tk.id = tm.ticket_id
                                WHERE tk.ref_no = ? AND tm.is_internal = 0 AND tm.direction = 'REPLY' ORDER BY tm.created_at ASC`).all(req.params.refNo)
        .map((r) => ({ eventType: 'REPLY', detail: r.detail, createdAt: r.createdAt }));
    const timeline = [...events, ...replies].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    sendSuccess(res, { ...t, timeline }, 'Status');
}));

// ---- Staff routes (auth required) ----
router.use(authenticate);

router.post('/', vBody(createSchema), asyncHandler((req, res) => {
    const d = req.body;
    const result = createTicketAutoRouted({ ...d, raisedByStaffId: req.staff.id, createdByName: req.staff.name });
    sendCreated(res, result, `Ticket created: ${result.ticket.refNo}`);
}));

router.get('/staff-directory', asyncHandler((req, res) => {
    sendSuccess(res, db.prepare("SELECT id, name, department, skills FROM staff WHERE status = 1 AND role IN ('agent','officer') ORDER BY name").all(), 'Assignable staff');
}));

// Team roster (OIC → PM → TL → Developer) with each member's open + resolved ticket load.
router.get('/team', asyncHandler((req, res) => {
    const rows = db.prepare(`
        SELECT s.id, s.name, s.name_hi AS nameHi, s.email, s.grade, s.specialty, s.department, s.skills,
            (SELECT COUNT(*) FROM tickets t WHERE t.assigned_staff_id = s.id AND t.status NOT IN ('RESOLVED','CLOSED')) AS openCount,
            (SELECT COUNT(*) FROM tickets t WHERE t.assigned_staff_id = s.id AND t.status IN ('RESOLVED','CLOSED')) AS resolvedCount
        FROM staff s
        WHERE s.status = 1 AND s.grade IS NOT NULL
        ORDER BY CASE s.grade WHEN 'OIC' THEN 0 WHEN 'PM' THEN 1 WHEN 'TL' THEN 2 ELSE 3 END, s.name`).all();
    sendSuccess(res, rows, 'Team');
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
    const rows = db.prepare(`SELECT ${ROW} FROM tickets t ${JOINS} ${clause}
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

// Developer-only: root cause, technical analysis, and re-classification (never exposed publicly).
router.patch('/:id/analysis', vParams(idParam), vBody(analysisSchema), asyncHandler((req, res) => {
    const id = Number(req.params.id);
    if (!getRow(id)) throw new NotFoundError('Ticket not found');
    const d = req.body;
    db.prepare(`UPDATE tickets SET root_cause=COALESCE(@rc, root_cause), technical_analysis=COALESCE(@ta, technical_analysis),
                    module=COALESCE(@mod, module), technology=COALESCE(@tech, technology), severity=COALESCE(@sev, severity), updated_at=@now
                WHERE id=@id`)
        .run({ id, rc: d.rootCause || null, ta: d.technicalAnalysis || null, mod: d.module || null, tech: d.technology || null, sev: d.severity || null, now: nowIso() });
    event(id, 'ANALYSIS', 'Root cause / technical analysis updated', req.staff.name);
    sendSuccess(res, getRow(id), 'Analysis saved');
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
