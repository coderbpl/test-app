import { Router } from 'express';
import authRoutes from '../modules/auth.module.js';
import feedbackRoutes from '../modules/feedback.module.js';
import ticketRoutes from '../modules/tickets.module.js';
import dashboardRoutes from '../modules/dashboard.module.js';
import { db } from '../config/db.js';
import { aiEnabled } from '../modules/ai.service.js';

const router = Router();
router.get('/health', (req, res) => res.json({ status: 'ok', app: 'MP HMIS — Grievance, Feedback & Ticketing', aiEnabled: aiEnabled(), uptime: process.uptime(), timestamp: new Date().toISOString() }));
router.get('/config', (req, res) => res.json({ aiEnabled: aiEnabled() }));
router.get('/hospitals', (req, res) => res.json({
    success: true,
    data: db.prepare('SELECT id, name, name_hi AS nameHi, district, type FROM hospitals WHERE status = 1 ORDER BY district, name').all()
}));
router.use('/auth', authRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/tickets', ticketRoutes);
router.use('/dashboard', dashboardRoutes);
export default router;
