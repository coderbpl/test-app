import * as service from './grievance.service.js';
import { sendSuccess, sendCreated, sendPaginated } from '../../utils/response.js';

// ---- Public (no auth) ------------------------------------------------------

export function fileGrievance(req, res) {
    const created = service.createGrievance(req.body, req.officer || null);
    sendCreated(res, created, `Grievance filed. Your tracking number is ${created.trackingNo}`);
}

export function track(req, res) {
    const result = service.trackByNo(req.params.trackingNo);
    sendSuccess(res, result, 'Grievance status');
}

export function listCategories(req, res) {
    sendSuccess(res, service.listCategories(), 'Categories');
}

// ---- Officer (auth) --------------------------------------------------------

export function list(req, res) {
    const { rows, total, page, limit } = service.listGrievances(req.query, req.officer);
    sendPaginated(res, rows, total, page, limit, 'Grievances');
}

export function getById(req, res) {
    sendSuccess(res, service.getGrievance(Number(req.params.id)), 'Grievance detail');
}

export function updateStatus(req, res) {
    sendSuccess(res, service.updateStatus(Number(req.params.id), req.body, req.officer), 'Status updated');
}

export function assign(req, res) {
    sendSuccess(res, service.assign(Number(req.params.id), req.body, req.officer), 'Grievance assigned');
}

export function escalate(req, res) {
    sendSuccess(res, service.escalate(Number(req.params.id), req.body, req.officer), 'Grievance escalated');
}

export function addComment(req, res) {
    sendSuccess(res, service.addComment(Number(req.params.id), req.body, req.officer), 'Comment added');
}

export async function reclassify(req, res) {
    sendSuccess(res, await service.reclassify(Number(req.params.id)), 'Re-classified by AI');
}

export async function draftReply(req, res) {
    const result = await service.draftReply(Number(req.params.id), req.query.kind);
    sendSuccess(res, result, result.aiAvailable ? 'Draft reply generated' : 'AI is unavailable — draft could not be generated');
}

export function dashboard(req, res) {
    sendSuccess(res, service.dashboard(req.query, req.officer), 'Dashboard');
}

// ---- Feedback (public, post-resolution) ------------------------------------

export function saveFeedback(req, res) {
    sendSuccess(res, service.saveFeedback(Number(req.params.id), req.body), 'Thank you for your feedback');
}
