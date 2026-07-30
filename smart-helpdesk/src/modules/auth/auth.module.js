import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import { db } from '../../config/db.js';
import { env } from '../../config/env.js';
import { UnauthorizedError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/response.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateBody } from '../../middlewares/validate.js';
import { authenticate } from '../../middlewares/auth.middleware.js';

const loginSchema = Joi.object({
    email: Joi.string().email({ tlds: { allow: false } }).required(),
    password: Joi.string().min(1).required()
});

/**
 * Authenticates an agent and returns a signed JWT + safe profile.
 */
export function login(email, password) {
    const agent = db.prepare('SELECT * FROM agents WHERE email = ? AND status = 1').get(email.toLowerCase());
    if (!agent || !bcrypt.compareSync(password, agent.password_hash)) {
        throw new UnauthorizedError('Invalid email or password');
    }
    const payload = { id: agent.id, name: agent.name, email: agent.email, role: agent.role };
    return { token: jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn }), agent: payload };
}

const router = Router();
router.post('/login', validateBody(loginSchema), asyncHandler((req, res) => {
    sendSuccess(res, login(req.body.email, req.body.password), 'Logged in');
}));
router.get('/me', authenticate, asyncHandler((req, res) => sendSuccess(res, req.agent, 'Current agent')));

export default router;
