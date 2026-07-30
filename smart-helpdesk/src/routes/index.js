import { Router } from 'express';
import authRoutes from '../modules/auth/auth.module.js';
import ticketRoutes from '../modules/tickets/ticket.routes.js';
import emailRoutes from '../modules/email/email.routes.js';
import { checkHealth, isAiEnabled } from '../modules/tickets/ticket.ai.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/health', asyncHandler(async (req, res) => {
    const ai = await checkHealth();
    res.json({ status: 'ok', aiProvider: 'groq', aiEnabled: isAiEnabled(), ai, uptime: process.uptime(), timestamp: new Date().toISOString() });
}));

router.use('/auth', authRoutes);
router.use('/tickets', ticketRoutes);
router.use('/email', emailRoutes);

export default router;
