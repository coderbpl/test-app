import Joi from 'joi';

const PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const STATUS = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'REOPENED'];
const email = Joi.string().email({ tlds: { allow: false } });

export const createTicketSchema = Joi.object({
    subject: Joi.string().min(3).max(250).required(),
    body: Joi.string().min(3).max(10000).required(),
    requesterName: Joi.string().max(150).allow('', null),
    requesterEmail: email.allow('', null),
    categoryId: Joi.number().integer().positive().optional(),
    priority: Joi.string().valid(...PRIORITY).optional()
});

export const idParamSchema = Joi.object({ id: Joi.number().integer().positive().required() });

export const listQuerySchema = Joi.object({
    page: Joi.number().integer().positive().default(1),
    limit: Joi.number().integer().positive().max(100).default(20),
    search: Joi.string().max(200).optional(),
    status: Joi.string().valid(...STATUS).optional(),
    priority: Joi.string().valid(...PRIORITY).optional(),
    categoryId: Joi.number().integer().positive().optional(),
    assignedAgentId: Joi.alternatives(Joi.number().integer().positive(), Joi.string().valid('me')).optional()
});

export const assignSchema = Joi.object({ agentId: Joi.number().integer().positive().required() });

export const statusSchema = Joi.object({
    status: Joi.string().valid(...STATUS).required(),
    resolution: Joi.string().max(5000).allow('', null).optional()
});

export const replySchema = Joi.object({
    body: Joi.string().min(1).max(10000).required(),
    isInternal: Joi.boolean().default(false)
});

export const emailInboundSchema = Joi.object({
    from: email.required(),
    fromName: Joi.string().max(150).allow('', null),
    subject: Joi.string().max(250).allow('', null),
    text: Joi.string().max(20000).required(),
    messageId: Joi.string().max(300).allow('', null),
    inReplyTo: Joi.string().max(300).allow('', null)
});
