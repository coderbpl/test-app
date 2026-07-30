import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import { db } from '../config/db.js';
import { env } from '../config/env.js';
import { sendSuccess, asyncHandler, UnauthorizedError } from '../utils/index.js';
import { authenticate, vBody } from '../middlewares/index.js';

const loginSchema = Joi.object({
    email: Joi.string().email({ tlds: { allow: false } }).required(),
    password: Joi.string().min(1).required()
});

function login(email, password) {
    const s = db.prepare('SELECT * FROM staff WHERE email = ? AND status = 1').get(email.toLowerCase());
    if (!s || !bcrypt.compareSync(password, s.password_hash)) throw new UnauthorizedError('Invalid email or password');
    const payload = { id: s.id, name: s.name, email: s.email, role: s.role, department: s.department, tier: s.tier };
    return { token: jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn }), staff: payload };
}

const router = Router();
router.post('/login', vBody(loginSchema), asyncHandler((req, res) => sendSuccess(res, login(req.body.email, req.body.password), 'Logged in')));
router.get('/me', authenticate, asyncHandler((req, res) => sendSuccess(res, req.staff, 'Current staff')));
router.get('/staff', authenticate, asyncHandler((req, res) => {
    const rows = db.prepare("SELECT id, name, name_hi AS nameHi, email, role, department, skills FROM staff WHERE status = 1 ORDER BY role, name").all();
    sendSuccess(res, rows, 'Staff directory');
}));
export default router;
