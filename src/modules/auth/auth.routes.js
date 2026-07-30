import { Router } from 'express';
import * as controller from './auth.controller.js';
import { loginSchema } from './auth.validator.js';
import { validateBody } from '../../middlewares/validate.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.post('/login', validateBody(loginSchema), asyncHandler(controller.login));
router.get('/me', authenticate, asyncHandler(controller.me));

export default router;
