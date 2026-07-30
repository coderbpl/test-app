import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import grievanceRoutes from '../modules/grievances/grievance.routes.js';
import { checkHealth, isAiEnabled } from '../modules/grievances/grievance.ai.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/health', asyncHandler(async (req, res) => {
    const ai = await checkHealth();
    res.json({
        status: 'ok',
        aiEnabled: isAiEnabled(),
        ai,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
}));

router.use('/auth', authRoutes);
router.use('/grievances', grievanceRoutes);

export default router;
