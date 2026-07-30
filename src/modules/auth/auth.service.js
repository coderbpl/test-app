import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../../config/db.js';
import { env } from '../../config/env.js';
import { UnauthorizedError } from '../../utils/ApiError.js';

/**
 * Authenticates an officer by email + password and returns a signed JWT plus a safe profile.
 *
 * @param {string} email
 * @param {string} password
 * @returns {{token: string, officer: object}}
 */
export function login(email, password) {
    const officer = db
        .prepare('SELECT * FROM officers WHERE email = ? AND status = 1')
        .get(email.toLowerCase());

    if (!officer || !bcrypt.compareSync(password, officer.password_hash)) {
        throw new UnauthorizedError('Invalid email or password');
    }

    const payload = {
        id: officer.id,
        name: officer.name,
        email: officer.email,
        role: officer.role,
        tier: officer.tier,
        hospitalId: officer.hospital_id,
        districtId: officer.district_id,
        divisionId: officer.division_id
    };

    const token = jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
    return { token, officer: payload };
}
