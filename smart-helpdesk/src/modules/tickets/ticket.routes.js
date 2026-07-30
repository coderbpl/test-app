import { Router } from 'express';
import * as controller from './ticket.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
    createTicketSchema, idParamSchema, listQuerySchema, assignSchema, statusSchema, replySchema, rewriteSchema
} from './ticket.validator.js';

const router = Router();

// ---- Public (customer-facing) ---------------------------------------------
router.get('/categories', asyncHandler(controller.listCategories));
router.post('/rewrite', validateBody(rewriteSchema), asyncHandler(controller.rewrite));
router.post('/', validateBody(createTicketSchema), asyncHandler(controller.create));

// ---- Agent (auth) ----------------------------------------------------------
router.get('/agents', authenticate, asyncHandler(controller.listAgents));
router.get('/', authenticate, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/:id', authenticate, validateParams(idParamSchema), asyncHandler(controller.getById));
router.patch('/:id/assign', authenticate, validateParams(idParamSchema), validateBody(assignSchema), asyncHandler(controller.assign));
router.post('/:id/assign-to-me', authenticate, validateParams(idParamSchema), asyncHandler(controller.assignToMe));
router.post('/:id/auto-assign', authenticate, validateParams(idParamSchema), asyncHandler(controller.autoAssign));
router.patch('/:id/status', authenticate, validateParams(idParamSchema), validateBody(statusSchema), asyncHandler(controller.updateStatus));
router.post('/:id/reply', authenticate, validateParams(idParamSchema), validateBody(replySchema), asyncHandler(controller.reply));
router.get('/:id/draft-reply', authenticate, validateParams(idParamSchema), asyncHandler(controller.draftReply));

export default router;
