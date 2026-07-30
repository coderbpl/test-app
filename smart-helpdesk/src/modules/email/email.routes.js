import { Router } from 'express';
import { emailInbound } from '../tickets/ticket.controller.js';
import { emailInboundSchema } from '../tickets/ticket.validator.js';
import { validateBody } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

/**
 * Inbound email webhook — point your provider's inbound-parse (AWS SES, SendGrid, Postmark, …) here,
 * or POST directly for testing. Optionally protect it with a shared secret via EMAIL_WEBHOOK_SECRET.
 *
 * Body: { from, fromName?, subject, text, messageId?, inReplyTo? }
 */
router.post(
    '/inbound',
    (req, res, next) => {
        const secret = process.env.EMAIL_WEBHOOK_SECRET;
        if (secret && req.headers['x-webhook-secret'] !== secret) {
            return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
        }
        next();
    },
    validateBody(emailInboundSchema),
    asyncHandler(emailInbound)
);

export default router;
