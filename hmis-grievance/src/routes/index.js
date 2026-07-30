import { Router } from 'express';
import authRoutes from '../modules/auth.module.js';
import grievanceRoutes from '../modules/grievances.module.js';
import feedbackRoutes from '../modules/feedback.module.js';
import ticketRoutes from '../modules/tickets.module.js';
import dashboardRoutes from '../modules/dashboard.module.js';

const router = Router();
router.get('/health', (req, res) => res.json({ status: 'ok', app: 'MP HMIS — Grievance, Feedback & Ticketing', uptime: process.uptime(), timestamp: new Date().toISOString() }));
router.use('/auth', authRoutes);
router.use('/grievances', grievanceRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/tickets', ticketRoutes);
router.use('/dashboard', dashboardRoutes);
export default router;
