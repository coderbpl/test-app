import { Router } from 'express';
import * as controller from './grievance.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
    createGrievanceSchema, idParamSchema, trackingParamSchema, listQuerySchema,
    statusSchema, assignSchema, escalateSchema, commentSchema, feedbackSchema, draftQuerySchema
} from './grievance.validator.js';

const router = Router();

// ---- Public routes (citizen-facing, no auth) -------------------------------
router.get('/categories', asyncHandler(controller.listCategories));
router.post('/', validateBody(createGrievanceSchema), asyncHandler(controller.fileGrievance));
router.get('/track/:trackingNo', validateParams(trackingParamSchema), asyncHandler(controller.track));
router.post('/:id/feedback', validateParams(idParamSchema), validateBody(feedbackSchema), asyncHandler(controller.saveFeedback));

// ---- Officer routes (auth required) ----------------------------------------
// The dashboard route is declared before '/:id' so "dashboard" isn't captured as an id.
router.get('/dashboard', authenticate, asyncHandler(controller.dashboard));
router.get('/', authenticate, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/:id', authenticate, validateParams(idParamSchema), asyncHandler(controller.getById));
router.patch('/:id/status', authenticate, validateParams(idParamSchema), validateBody(statusSchema), asyncHandler(controller.updateStatus));
router.patch('/:id/assign', authenticate, validateParams(idParamSchema), validateBody(assignSchema), asyncHandler(controller.assign));
router.patch('/:id/escalate', authenticate, validateParams(idParamSchema), validateBody(escalateSchema), asyncHandler(controller.escalate));
router.post('/:id/comments', authenticate, validateParams(idParamSchema), validateBody(commentSchema), asyncHandler(controller.addComment));
router.post('/:id/reclassify', authenticate, validateParams(idParamSchema), asyncHandler(controller.reclassify));
router.get('/:id/draft-reply', authenticate, validateParams(idParamSchema), validateQuery(draftQuerySchema), asyncHandler(controller.draftReply));

export default router;
