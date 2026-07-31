import { Router } from 'express';
import { db } from '../config/db.js';
import { sendSuccess, asyncHandler } from '../utils/index.js';
import { authenticate } from '../middlewares/index.js';

const router = Router();

/** Combined snapshot across tickets (incl. public grievances) and feedback. */
router.get('/', authenticate, asyncHandler((req, res) => {
    const tickets = db.prepare(`SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status NOT IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END), 0) AS open,
            COALESCE(SUM(CASE WHEN status IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END), 0) AS resolved,
            COALESCE(SUM(CASE WHEN source = 'WEB' THEN 1 ELSE 0 END), 0) AS fromPublic,
            COALESCE(SUM(CASE WHEN priority = 'URGENT' AND status NOT IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END), 0) AS urgentOpen
        FROM tickets`).get();
    tickets.byCategory = db.prepare("SELECT COALESCE(category,'OTHER') AS category, COUNT(*) AS count FROM tickets GROUP BY category ORDER BY count DESC").all();
    tickets.byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM tickets GROUP BY status').all();

    const feedback = db.prepare(`SELECT COUNT(*) AS count, ROUND(AVG(rating_overall),2) AS avgOverall,
            ROUND(100.0 * SUM(CASE WHEN would_recommend = 1 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN would_recommend IS NOT NULL THEN 1 ELSE 0 END),0), 0) AS pctRecommend,
            COALESCE(SUM(CASE WHEN rating_overall <= 2 THEN 1 ELSE 0 END), 0) AS lowRatings
        FROM feedback`).get();

    sendSuccess(res, { tickets, feedback }, 'Dashboard');
}));

export default router;
