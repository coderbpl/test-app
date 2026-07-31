import { Router } from 'express';
import Joi from 'joi';
import { db } from '../config/db.js';
import { sendSuccess, sendCreated, sendPaginated, asyncHandler, sanitizePagination, buildRef, NotFoundError } from '../utils/index.js';
import { authenticate, vBody, vParams, vQuery } from '../middlewares/index.js';
import { createGrievance } from './grievances.module.js';
import { createTicketAutoRouted } from './tickets.module.js';

const r1to5 = Joi.number().integer().min(1).max(5);
const createSchema = Joi.object({
    feedbackType: Joi.string().valid('SERVICE', 'APP').default('SERVICE'),
    hospitalId: Joi.number().integer().positive().optional(),
    facility: Joi.string().max(150).allow('', null),
    department: Joi.string().max(100).allow('', null),
    visitRef: Joi.string().max(60).allow('', null),
    ratingOverall: r1to5.required(),
    ratingStaff: r1to5.optional(),
    ratingCleanliness: r1to5.optional(),
    ratingWaiting: r1to5.optional(),
    ratingEase: r1to5.optional(),
    ratingSpeed: r1to5.optional(),
    wouldRecommend: Joi.boolean().optional(),
    comment: Joi.string().max(2000).allow('', null),
    isAnonymous: Joi.boolean().default(true),
    patientName: Joi.string().max(150).allow('', null),
    patientMobile: Joi.string().max(20).allow('', null)
});
const idParam = Joi.object({ id: Joi.number().integer().positive().required() });
const listQuery = Joi.object({
    page: Joi.number().integer().positive().default(1),
    limit: Joi.number().integer().positive().max(100).default(20),
    department: Joi.string().max(100).optional(),
    hospitalId: Joi.number().integer().positive().optional(),
    feedbackType: Joi.string().valid('SERVICE', 'APP').optional(),
    minRating: r1to5.optional(),
    maxRating: r1to5.optional()
});

const ROW = `id, ref_no AS refNo, feedback_type AS feedbackType, hospital_id AS hospitalId, facility, department,
    visit_ref AS visitRef, rating_overall AS ratingOverall, rating_staff AS ratingStaff,
    rating_cleanliness AS ratingCleanliness, rating_waiting AS ratingWaiting, rating_ease AS ratingEase,
    rating_speed AS ratingSpeed, would_recommend AS wouldRecommend, comment, is_anonymous AS isAnonymous,
    patient_name AS patientName, linked_grievance_id AS linkedGrievanceId, linked_ticket_id AS linkedTicketId, created_at AS createdAt`;

const router = Router();

// Public — submit feedback
router.post('/', vBody(createSchema), asyncHandler((req, res) => {
    const d = req.body;
    const info = db.prepare(
        `INSERT INTO feedback (feedback_type, hospital_id, facility, department, visit_ref, rating_overall, rating_staff, rating_cleanliness,
                               rating_waiting, rating_ease, rating_speed, would_recommend, comment, is_anonymous, patient_name, patient_mobile)
         VALUES (@type, @hospitalId, @facility, @department, @visitRef, @overall, @staff, @clean, @wait, @ease, @speed, @rec, @comment, @anon, @pname, @pmobile)`
    ).run({
        type: d.feedbackType || 'SERVICE', hospitalId: d.hospitalId ?? null, facility: d.facility ?? null, department: d.department ?? null, visitRef: d.visitRef ?? null,
        overall: d.ratingOverall, staff: d.ratingStaff ?? null, clean: d.ratingCleanliness ?? null, wait: d.ratingWaiting ?? null,
        ease: d.ratingEase ?? null, speed: d.ratingSpeed ?? null,
        rec: d.wouldRecommend === undefined ? null : (d.wouldRecommend ? 1 : 0),
        comment: d.comment ?? null, anon: d.isAnonymous === false ? 0 : 1, pname: d.patientName ?? null, pmobile: d.patientMobile ?? null
    });
    const id = Number(info.lastInsertRowid);
    db.prepare('UPDATE feedback SET ref_no = ? WHERE id = ?').run(buildRef('FBK', id), id);

    // Closed loop for poor ratings (<=2): a hospital-SERVICE rating becomes a grievance; an
    // HMIS-APP rating becomes a routed IT ticket. Both get followed up by the right team.
    let linkedGrievance = null, linkedTicket = null;
    if (d.ratingOverall <= 2) {
        if ((d.feedbackType || 'SERVICE') === 'SERVICE') {
            linkedGrievance = createGrievance({
                subject: `Low patient feedback (${d.ratingOverall}/5)${d.department ? ' — ' + d.department : ''}`,
                description: d.comment?.trim() ? d.comment.trim() : `Patient rated the experience ${d.ratingOverall}/5. No comment provided.`,
                hospitalId: d.hospitalId ?? null, facility: d.facility ?? null, department: d.department ?? null, isAnonymous: d.isAnonymous !== false,
                complainantName: d.patientName ?? null, complainantMobile: d.patientMobile ?? null
            }, { actorName: 'Feedback system' });
            db.prepare('UPDATE feedback SET linked_grievance_id = ? WHERE id = ?').run(linkedGrievance.id, id);
        } else {
            linkedTicket = createTicketAutoRouted({
                subject: `Low HMIS app rating (${d.ratingOverall}/5)`,
                body: d.comment?.trim() ? d.comment.trim() : `A user rated the HMIS application ${d.ratingOverall}/5 with no comment.`,
                category: 'BUG', priority: 'MEDIUM', createdByName: 'App feedback'
            }).ticket;
            db.prepare('UPDATE feedback SET linked_ticket_id = ? WHERE id = ?').run(linkedTicket.id, id);
        }
    }

    const feedback = db.prepare(`SELECT ${ROW} FROM feedback WHERE id = ?`).get(id);
    const msg = linkedGrievance ? `Thank you. We've logged a follow-up (${linkedGrievance.refNo}) for your concern.`
        : linkedTicket ? `Thank you. We've raised an IT ticket (${linkedTicket.refNo}) to improve the app.`
            : 'Thank you for your feedback.';
    sendCreated(res, { feedback, linkedGrievance, linkedTicket }, msg);
}));

// Staff — analytics
router.get('/analytics', authenticate, asyncHandler((req, res) => {
    const totals = db.prepare(`SELECT COUNT(*) AS count,
            ROUND(AVG(rating_overall), 2) AS avgOverall,
            ROUND(AVG(rating_staff), 2) AS avgStaff,
            ROUND(AVG(rating_cleanliness), 2) AS avgCleanliness,
            ROUND(AVG(rating_waiting), 2) AS avgWaiting,
            ROUND(100.0 * SUM(CASE WHEN would_recommend = 1 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN would_recommend IS NOT NULL THEN 1 ELSE 0 END), 0), 0) AS pctRecommend
        FROM feedback`).get();
    const distribution = db.prepare('SELECT rating_overall AS rating, COUNT(*) AS count FROM feedback GROUP BY rating_overall ORDER BY rating_overall').all();
    const byDepartment = db.prepare(`SELECT COALESCE(department,'—') AS department, COUNT(*) AS count, ROUND(AVG(rating_overall),2) AS avgOverall
        FROM feedback GROUP BY department ORDER BY avgOverall ASC`).all();
    const byType = db.prepare("SELECT feedback_type AS type, COUNT(*) AS count, ROUND(AVG(rating_overall),2) AS avgOverall FROM feedback GROUP BY feedback_type").all();
    const app = db.prepare("SELECT ROUND(AVG(rating_ease),2) AS avgEase, ROUND(AVG(rating_speed),2) AS avgSpeed, COUNT(*) AS count FROM feedback WHERE feedback_type='APP'").get();
    sendSuccess(res, { totals, distribution, byDepartment, byType, app }, 'Feedback analytics');
}));

// Staff — list
router.get('/', authenticate, vQuery(listQuery), asyncHandler((req, res) => {
    const { page, limit, offset } = sanitizePagination(req.query);
    const where = []; const p = {};
    if (req.query.department) { where.push('department = @d'); p.d = req.query.department; }
    if (req.query.hospitalId) { where.push('hospital_id = @h'); p.h = req.query.hospitalId; }
    if (req.query.feedbackType) { where.push('feedback_type = @ft'); p.ft = req.query.feedbackType; }
    if (req.query.minRating) { where.push('rating_overall >= @min'); p.min = req.query.minRating; }
    if (req.query.maxRating) { where.push('rating_overall <= @max'); p.max = req.query.maxRating; }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT ${ROW} FROM feedback ${clause} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`).all({ ...p, limit, offset });
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM feedback ${clause}`).get(p);
    sendPaginated(res, rows, total, page, limit, 'Feedback');
}));

router.get('/:id', authenticate, vParams(idParam), asyncHandler((req, res) => {
    const row = db.prepare(`SELECT ${ROW} FROM feedback WHERE id = ?`).get(Number(req.params.id));
    if (!row) throw new NotFoundError('Feedback not found');
    sendSuccess(res, row, 'Feedback detail');
}));

export default router;
