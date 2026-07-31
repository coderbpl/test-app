import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

/**
 * Best-effort email notifier for ticket auto-assignment. When SMTP isn't configured it logs the
 * message instead of sending, so the assignment flow works out of the box; configure SMTP in
 * .env to actually deliver mail. Never throws to the caller.
 */
let transporter;
function getTransporter() {
    if (transporter !== undefined) return transporter;
    const { host, port, secure, user, pass } = env.email.smtp;
    transporter = env.email.enabled && host
        ? nodemailer.createTransport({ host, port, secure, auth: user ? { user, pass } : undefined })
        : null;
    return transporter;
}

export function emailConfigured() {
    return Boolean(env.email.enabled && env.email.smtp.host);
}

/**
 * @param {{ to:string, subject:string, text:string }} msg
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
export async function sendMail({ to, subject, text }) {
    if (!to) return { sent: false, reason: 'no-recipient' };
    const t = getTransporter();
    if (!t) {
        // eslint-disable-next-line no-console
        console.log(`[email] (SMTP off — not sent) → ${to} | ${subject}`);
        return { sent: false, reason: 'smtp-not-configured' };
    }
    try {
        await t.sendMail({ from: env.email.from, to, subject, text });
        // eslint-disable-next-line no-console
        console.log(`[email] sent → ${to} | ${subject}`);
        return { sent: true };
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[email] send failed:', err.message);
        return { sent: false, reason: err.message };
    }
}
