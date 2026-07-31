import { Router } from 'express';
import { db } from '../config/db.js';
import { sendSuccess, asyncHandler } from '../utils/index.js';
import { authenticate } from '../middlewares/index.js';

const router = Router();

/** Combined snapshot across grievances, feedback, and tickets for the console home. */
router.get('/', authenticate, asyncHandler((req, res) => {
    const grievances = db.prepare(`SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status NOT IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END), 0) AS open,
            COALESCE(SUM(CASE WHEN is_urgent = 1 AND status NOT IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END), 0) AS urgentOpen,
            COALESCE(SUM(CASE WHEN status IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END), 0) AS resolved
        FROM grievances`).get();
    grievances.byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM grievances GROUP BY status').all();

    const tickets = db.prepare(`SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status NOT IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END), 0) AS open,
            COALESCE(SUM(CASE WHEN status IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END), 0) AS resolved
        FROM tickets`).get();
    tickets.byCategory = db.prepare("SELECT COALESCE(category,'OTHER') AS category, COUNT(*) AS count FROM tickets GROUP BY category").all();

    const feedback = db.prepare(`SELECT COUNT(*) AS count, ROUND(AVG(rating_overall),2) AS avgOverall,
            ROUND(100.0 * SUM(CASE WHEN would_recommend = 1 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN would_recommend IS NOT NULL THEN 1 ELSE 0 END),0), 0) AS pctRecommend,
            SUM(CASE WHEN rating_overall <= 2 THEN 1 ELSE 0 END) AS lowRatings
        FROM feedback`).get();

    sendSuccess(res, { grievances, tickets, feedback }, 'Dashboard');
}));

export default router;
