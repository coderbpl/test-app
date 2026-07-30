import * as service from './ticket.service.js';
import { sendSuccess, sendCreated, sendPaginated } from '../../utils/response.js';

// ---- Public ----------------------------------------------------------------
export function create(req, res) {
    const result = service.createTicket(req.body, { source: 'WEB' });
    sendCreated(res, result, `Ticket created: ${result.ticket.refNo}`);
}
export function listCategories(req, res) {
    sendSuccess(res, service.listCategories(), 'Categories');
}
export function emailInbound(req, res) {
    const result = service.ingestEmail(req.body);
    sendCreated(res, result, result.created ? `Ticket created: ${result.ticket.refNo}` : `Appended to ${result.ticket.refNo}`);
}
export async function rewrite(req, res) {
    const result = await service.rewriteDescription(req.body);
    sendSuccess(res, result, result.aiAvailable ? 'Rewritten' : 'AI unavailable (set GROQ_API_KEY)');
}

// ---- Agent -----------------------------------------------------------------
export function list(req, res) {
    if (req.query.assignedAgentId === 'me') req.query._meId = req.agent.id;
    const { rows, total, page, limit } = service.listTickets(req.query);
    sendPaginated(res, rows, total, page, limit, 'Tickets');
}
export function getById(req, res) {
    sendSuccess(res, service.getTicket(Number(req.params.id)), 'Ticket detail');
}
export function assign(req, res) {
    sendSuccess(res, service.assignTicket(Number(req.params.id), req.body.agentId, req.agent), 'Ticket assigned');
}
export function autoAssign(req, res) {
    sendSuccess(res, service.autoAssign(Number(req.params.id)), 'Ticket auto-assigned');
}
export function assignToMe(req, res) {
    sendSuccess(res, service.assignTicket(Number(req.params.id), req.agent.id, req.agent), 'Assigned to you');
}
export function updateStatus(req, res) {
    sendSuccess(res, service.updateStatus(Number(req.params.id), req.body, req.agent), 'Status updated');
}
export function reply(req, res) {
    sendSuccess(res, service.addReply(Number(req.params.id), req.body, req.agent), req.body.isInternal ? 'Note added' : 'Reply recorded');
}
export async function draftReply(req, res) {
    const result = await service.draftReply(Number(req.params.id));
    sendSuccess(res, result, result.aiAvailable ? 'Draft generated' : 'AI unavailable (set GROQ_API_KEY)');
}
export function listAgents(req, res) {
    sendSuccess(res, service.listAgents(), 'Agents');
}
