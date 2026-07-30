import Joi from 'joi';

const PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const STATUS = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'];
const TIER = ['FACILITY', 'BLOCK', 'DISTRICT', 'DIVISION', 'STATE'];

export const createGrievanceSchema = Joi.object({
    categoryId: Joi.number().integer().positive().optional(),
    title: Joi.string().max(250).allow('', null).optional(),
    description: Joi.string().min(5).max(5000).required(),
    language: Joi.string().max(10).optional(),

    isAnonymous: Joi.boolean().default(false),
    complainantName: Joi.string().max(150).allow('', null).optional(),
    complainantMobile: Joi.string().max(20).allow('', null).optional(),
    complainantEmail: Joi.string().email({ tlds: { allow: false } }).allow('', null).optional(),

    hospitalId: Joi.number().integer().positive().optional(),
    divisionId: Joi.number().integer().positive().optional(),
    districtId: Joi.number().integer().positive().optional(),
    blockId: Joi.number().integer().positive().optional(),
    locationText: Joi.string().max(200).allow('', null).optional()
});

export const idParamSchema = Joi.object({
    id: Joi.number().integer().positive().required()
});

export const trackingParamSchema = Joi.object({
    trackingNo: Joi.string().max(30).required()
});

export const listQuerySchema = Joi.object({
    page: Joi.number().integer().positive().default(1),
    limit: Joi.number().integer().positive().max(100).default(20),
    search: Joi.string().max(200).optional(),
    status: Joi.string().valid(...STATUS).optional(),
    priority: Joi.string().valid(...PRIORITY).optional(),
    categoryId: Joi.number().integer().positive().optional(),
    assignedToOfficerId: Joi.number().integer().positive().optional(),
    isUrgent: Joi.boolean().optional()
});

export const statusSchema = Joi.object({
    status: Joi.string().valid(...STATUS).required(),
    comment: Joi.string().max(2000).allow('', null).optional()
});

export const assignSchema = Joi.object({
    assignedToOfficerId: Joi.number().integer().positive().required(),
    ownerTier: Joi.string().valid(...TIER).optional()
});

export const escalateSchema = Joi.object({
    toTier: Joi.string().valid(...TIER).required(),
    reason: Joi.string().max(2000).allow('', null).optional()
});

export const commentSchema = Joi.object({
    comment: Joi.string().min(1).max(2000).required(),
    isInternal: Joi.boolean().default(false)
});

export const feedbackSchema = Joi.object({
    rating: Joi.number().integer().min(1).max(5).required(),
    comment: Joi.string().max(2000).allow('', null).optional()
});

export const draftQuerySchema = Joi.object({
    kind: Joi.string().valid('acknowledgement', 'resolution').default('acknowledgement')
});
