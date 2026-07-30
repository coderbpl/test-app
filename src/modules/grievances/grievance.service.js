import * as repo from './grievance.repository.js';
import * as ai from './grievance.ai.service.js';
import { sanitizePagination } from '../../utils/pagination.js';
import { NotFoundError, BadRequestError } from '../../utils/ApiError.js';

const DEFAULT_PRIORITY = 'MEDIUM';
const DEFAULT_SLA_HOURS = 72;

/**
 * Files a grievance. Priority + SLA are seeded from the chosen category (or defaults), then AI
 * classification runs in the background so intake stays fast and never blocks on the model.
 *
 * @param {object} dto - Validated intake payload.
 * @param {object|null} [officer] - The staff member filing on behalf, if authenticated.
 * @returns {object} The created grievance row.
 */
export function createGrievance(dto, officer = null) {
    let priority = DEFAULT_PRIORITY;
    let slaHours = DEFAULT_SLA_HOURS;

    if (dto.categoryId) {
        const category = repo.getCategoryById(dto.categoryId);
        if (!category) throw new BadRequestError('Invalid category');
        priority = category.default_priority;
        slaHours = category.sla_hours;
    }

    const slaDueAt = new Date(Date.now() + slaHours * 3600 * 1000).toISOString();

    const created = repo.createGrievance({
        ...dto,
        priority,
        slaDueAt,
        createdByOfficerId: officer?.id ?? null,
        actorName: officer?.name ?? dto.complainantName ?? null
    });

    // Fire-and-forget AI enrichment — errors are swallowed inside enrichWithAi.
    enrichWithAi(created.id);

    return created;
}

/**
 * Runs (or re-runs) local Ollama classification over a grievance and persists the result.
 * Best-effort: any failure leaves the grievance untouched.
 *
 * @param {number} id
 * @returns {Promise<object|null>} The updated grievance row, or the untouched row on AI failure.
 */
export async function enrichWithAi(id) {
    const grievance = repo.getGrievanceRow(id);
    if (!grievance) return null;
    if (!ai.isAiEnabled()) return grievance;

    try {
        const categories = repo.listCategories();
        const result = await ai.classifyGrievance({ text: grievance.description, categories });
        if (!result) return grievance;

        // Respect an explicit citizen-chosen category; otherwise adopt the AI's.
        let categoryId = grievance.categoryId ?? null;
        if (!categoryId && result.categoryCode) {
            categoryId = categories.find((c) => c.code === result.categoryCode)?.id ?? null;
        }

        return repo.applyAiClassification(id, {
            categoryId,
            priority: result.priority,
            language: result.language,
            isUrgent: result.isUrgent,
            aiSummary: result.summary
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[ai] enrichWithAi failed:', err.message);
        return grievance;
    }
}

export function getGrievance(id) {
    const detail = repo.getGrievanceDetail(id);
    if (!detail) throw new NotFoundError('Grievance not found');
    return detail;
}

export function trackByNo(trackingNo) {
    const result = repo.getByTrackingNo(trackingNo);
    if (!result) throw new NotFoundError('No grievance found for that tracking number');
    return result;
}

export function listGrievances(query, officer) {
    const { page, limit, offset } = sanitizePagination(query);

    // Scope: non-admin officers only see grievances within their patch.
    const scope = {};
    if (officer && officer.role !== 'admin') {
        if (officer.hospitalId) scope.hospitalId = officer.hospitalId;
        if (officer.districtId) scope.districtId = officer.districtId;
        if (officer.divisionId) scope.divisionId = officer.divisionId;
    }

    const { rows, total } = repo.listGrievances({
        ...scope,
        search: query.search,
        status: query.status,
        priority: query.priority,
        categoryId: query.categoryId,
        assignedToOfficerId: query.assignedToOfficerId,
        isUrgent: query.isUrgent,
        limit,
        offset
    });

    return { rows, total, page, limit };
}

export function updateStatus(id, dto, officer) {
    const updated = repo.updateStatus(id, {
        status: dto.status,
        comment: dto.comment ?? null,
        actorOfficerId: officer.id,
        actorName: officer.name
    });
    if (!updated) throw new NotFoundError('Grievance not found');
    return updated;
}

export function assign(id, dto, officer) {
    const updated = repo.assign(id, {
        assignedToOfficerId: dto.assignedToOfficerId,
        ownerTier: dto.ownerTier ?? null,
        actorOfficerId: officer.id,
        actorName: officer.name
    });
    if (!updated) throw new NotFoundError('Grievance not found');
    return updated;
}

export function escalate(id, dto, officer) {
    const updated = repo.escalate(id, {
        toTier: dto.toTier,
        reason: dto.reason ?? null,
        actorOfficerId: officer.id,
        actorName: officer.name
    });
    if (!updated) throw new NotFoundError('Grievance not found');
    return updated;
}

export function addComment(id, dto, officer) {
    const result = repo.addComment(id, {
        comment: dto.comment,
        isInternal: dto.isInternal ?? false,
        actorOfficerId: officer.id,
        actorName: officer.name
    });
    if (!result) throw new NotFoundError('Grievance not found');
    return result;
}

export function saveFeedback(id, dto) {
    const result = repo.saveFeedback(id, { rating: dto.rating, comment: dto.comment ?? null });
    if (result.error === 'NOT_FOUND') throw new NotFoundError('Grievance not found');
    if (result.error === 'NOT_RESOLVED') throw new BadRequestError('Feedback can only be given after the grievance is resolved');
    return result.feedback;
}

/**
 * Produces an AI-drafted reply for an officer to review. Returns { draft, aiAvailable } — never
 * sends anything.
 */
export async function draftReply(id, kind) {
    const grievance = repo.getGrievanceRow(id);
    if (!grievance) throw new NotFoundError('Grievance not found');
    const draft = await ai.draftReply({
        grievance: { tracking_no: grievance.trackingNo, description: grievance.description, language: grievance.language, status: grievance.status },
        kind
    });
    return { draft, aiAvailable: draft !== null };
}

export async function reclassify(id) {
    const updated = await enrichWithAi(id);
    if (!updated) throw new NotFoundError('Grievance not found');
    return updated;
}

export function dashboard(query, officer) {
    const scope = {};
    if (officer && officer.role !== 'admin') {
        if (officer.hospitalId) scope.hospitalId = officer.hospitalId;
        if (officer.districtId) scope.districtId = officer.districtId;
        if (officer.divisionId) scope.divisionId = officer.divisionId;
    }
    return repo.dashboard(scope);
}

export function listCategories() {
    return repo.listCategories();
}
