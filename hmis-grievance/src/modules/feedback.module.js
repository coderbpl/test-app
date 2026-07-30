import { Router } from 'express';
import Joi from 'joi';
import { db } from '../config/db.js';
import { sendSuccess, sendCreated, sendPaginated, asyncHandler, sanitizePagination, buildRef, NotFoundError } from '../utils/index.js';
import { authenticate, vBody, vParams, vQuery } from '../middlewares/index.js';
import { createGrievance } from './grievances.module.js';

const r1to5 = Joi.number().integer().min(1).max(5);
const createSchema = Joi.object({
    facility: Joi.string().max(150).allow('', null),
    department: Joi.string().max(100).allow('', null),
    visitRef: Joi.string().max(60).allow('', null),
    ratingOverall: r1to5.required(),
    ratingStaff: r1to5.optional(),
    ratingCleanliness: r1to5.optional(),
    ratingWaiting: r1to5.optional(),
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
    minRating: r1to5.optional(),
    maxRating: r1to5.optional()
});

const ROW = `id, ref_no AS refNo, facility, department, visit_ref AS visitRef, rating_overall AS ratingOverall,
    rating_staff AS ratingStaff, rating_cleanliness AS ratingCleanliness, rating_waiting AS ratingWaiting,
    would_recommend AS wouldRecommend, comment, is_anonymous AS isAnonymous, patient_name AS patientName,
    linked_grievance_id AS linkedGrievanceId, created_at AS createdAt`;

const router = Router();

// Public — submit feedback
router.post('/', vBody(createSchema), asyncHandler((req, res) => {
    const d = req.body;
    const info = db.prepare(
        `INSERT INTO feedback (facility, department, visit_ref, rating_overall, rating_staff, rating_cleanliness, rating_waiting,
                               would_recommend, comment, is_anonymous, patient_name, patient_mobile)
         VALUES (@facility, @department, @visitRef, @overall, @staff, @clean, @wait, @rec, @comment, @anon, @pname, @pmobile)`
    ).run({
        facility: d.facility ?? null, department: d.department ?? null, visitRef: d.visitRef ?? null,
        overall: d.ratingOverall, staff: d.ratingStaff ?? null, clean: d.ratingCleanliness ?? null, wait: d.ratingWaiting ?? null,
        rec: d.wouldRecommend === undefined ? null : (d.wouldRecommend ? 1 : 0),
        comment: d.comment ?? null, anon: d.isAnonymous === false ? 0 : 1, pname: d.patientName ?? null, pmobile: d.patientMobile ?? null
    });
    const id = Number(info.lastInsertRowid);
    db.prepare('UPDATE feedback SET ref_no = ? WHERE id = ?').run(buildRef('FBK', id), id);

    // Closed-loop: a poor rating (<=2) becomes a grievance so someone actually follows up.
    let linkedGrievance = null;
    if (d.ratingOverall <= 2) {
        linkedGrievance = createGrievance({
            subject: `Low patient feedback (${d.ratingOverall}/5)${d.department ? ' — ' + d.department : ''}`,
            description: d.comment?.trim() ? d.comment.trim() : `Patient rated the experience ${d.ratingOverall}/5. No comment provided.`,
            facility: d.facility ?? null, department: d.department ?? null, isAnonymous: d.isAnonymous !== false,
            complainantName: d.patientName ?? null, complainantMobile: d.patientMobile ?? null
        }, { actorName: 'Feedback system' });
        db.prepare('UPDATE feedback SET linked_grievance_id = ? WHERE id = ?').run(linkedGrievance.id, id);
    }

    const feedback = db.prepare(`SELECT ${ROW} FROM feedback WHERE id = ?`).get(id);
    sendCreated(res, { feedback, linkedGrievance }, linkedGrievance
        ? `Thank you. We've logged a follow-up (${linkedGrievance.refNo}) for your concern.`
        : 'Thank you for your feedback.');
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
    sendSuccess(res, { totals, distribution, byDepartment }, 'Feedback analytics');
}));

// Staff — list
router.get('/', authenticate, vQuery(listQuery), asyncHandler((req, res) => {
    const { page, limit, offset } = sanitizePagination(req.query);
    const where = []; const p = {};
    if (req.query.department) { where.push('department = @d'); p.d = req.query.department; }
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
