import * as authService from './auth.service.js';
import { sendSuccess } from '../../utils/response.js';

export function login(req, res) {
    const { email, password } = req.body;
    const result = authService.login(email, password);
    sendSuccess(res, result, 'Logged in');
}

export function me(req, res) {
    sendSuccess(res, req.officer, 'Current officer');
}
