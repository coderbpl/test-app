import * as repo from './ticket.repository.js';
import * as ai from './ticket.ai.service.js';
import { buildRecommendation, findSimilarTickets } from './recommendation.service.js';
import { sanitizePagination } from '../../utils/pagination.js';
import { NotFoundError, BadRequestError } from '../../utils/ApiError.js';

/**
 * Normalizes an email subject into a thread key (strips Re:/Fwd:, lowercases) so replies land on
 * the same ticket.
 */
function threadKey(subject) {
    return (subject || '')
        .replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, '')
        .trim()
        .toLowerCase()
        .slice(0, 200) || null;
}

/**
 * Core intake path used by manual creation, the API, and email ingestion. Creates the ticket,
 * runs the local recommendation engine, auto-assigns to the recommended agent, and kicks off
 * (best-effort) Groq classification in the background.
 *
 * @returns {{ ticket: object, recommendation: object }}
 */
export function createTicket(dto, { source = 'WEB' } = {}) {
    if (dto.categoryId) {
        const cats = repo.listCategories();
        if (!cats.some((c) => c.id === dto.categoryId)) throw new BadRequestError('Invalid category');
    }

    const ticket = repo.createTicket({ ...dto, source });

    // Local recommendation (deterministic, no external call) — drives auto-assignment.
    const recommendation = buildRecommendation(ticket);
    if (recommendation.recommendedAgent) {
        const r = recommendation.recommendedAgent;
        repo.assign(ticket.id, {
            agentId: r.agentId,
            agentName: r.agentName,
            auto: true,
            detail: `Auto-assigned to ${r.agentName} — ${r.reason} (${recommendation.source})`
        });
        repo.logRecommendation(ticket.id, `Suggested ${r.agentName}: ${r.reason}; ${recommendation.similar.length} similar tickets`);
    }

    // Background AI classification (Groq). Never blocks intake.
    enrichWithAi(ticket.id);

    return { ticket: repo.getTicketRow(ticket.id), recommendation };
}

/**
 * Best-effort Groq classification → category / priority / summary. Swallows all errors.
 */
export async function enrichWithAi(id) {
    if (!ai.isAiEnabled()) return;
    try {
        const t = repo.getTicketRow(id);
        if (!t) return;
        const categories = repo.listCategories();
        const result = await ai.classifyTicket({ subject: t.subject, body: t.body, categories });
        if (!result) return;
        const categoryId = t.categoryId ?? (result.categoryCode ? repo.getCategoryByCode(result.categoryCode)?.id ?? null : null);
        repo.applyClassification(id, { categoryId, priority: result.priority, aiSummary: result.summary });
    } catch (err) {
        console.warn('[ai] enrichWithAi failed:', err.message); // eslint-disable-line no-console
    }
}

/**
 * Ingests an inbound email: dedupes on Message-ID, threads replies onto an existing open ticket,
 * or creates a new one.
 *
 * @returns {{ ticket: object, created: boolean, recommendation?: object }}
 */
export function ingestEmail({ from, fromName, subject, text, messageId, inReplyTo }) {
    if (messageId && repo.findByEmailMessageId(messageId)) {
        const existing = repo.findByEmailMessageId(messageId);
        return { ticket: repo.getTicketRow(existing.id), created: false };
    }

    const key = threadKey(subject);
    const openThread = repo.findOpenByThreadKey(key);
    if (openThread) {
        repo.addMessage(openThread.id, { direction: 'INBOUND', body: text, authorName: fromName, authorEmail: from });
        return { ticket: repo.getTicketRow(openThread.id), created: false };
    }

    const { ticket, recommendation } = createTicket(
        {
            subject: subject || '(no subject)',
            body: text || '',
            requesterName: fromName || from,
            requesterEmail: from,
            emailMessageId: messageId || null,
            emailThreadKey: key
        },
        { source: 'EMAIL' }
    );
    return { ticket, created: true, recommendation };
}

/**
 * Ticket detail plus a freshly computed recommendation bundle (similar tickets + suggested agent).
 */
export function getTicket(id) {
    const detail = repo.getTicketDetail(id);
    if (!detail) throw new NotFoundError('Ticket not found');
    return { ...detail, recommendation: buildRecommendation(detail) };
}

export function listTickets(query) {
    const { page, limit, offset } = sanitizePagination(query);
    const { rows, total } = repo.listTickets({
        search: query.search,
        status: query.status,
        priority: query.priority,
        categoryId: query.categoryId,
        assignedAgentId: query.assignedAgentId === 'me' ? query._meId : query.assignedAgentId,
        limit,
        offset
    });
    return { rows, total, page, limit };
}

export function assignTicket(id, agentId, actor) {
    if (!repo.agentExists(agentId)) throw new BadRequestError('Unknown agent');
    const agent = repo.listAgents().find((a) => a.id === agentId);
    const updated = repo.assign(id, { agentId, agentName: agent?.name, actorAgentId: actor.id, actorName: actor.name });
    if (!updated) throw new NotFoundError('Ticket not found');
    return updated;
}

export function autoAssign(id) {
    const ticket = repo.getTicketRow(id);
    if (!ticket) throw new NotFoundError('Ticket not found');
    const rec = buildRecommendation(ticket);
    if (!rec.recommendedAgent) throw new BadRequestError('No agent could be recommended');
    const r = rec.recommendedAgent;
    const updated = repo.assign(id, { agentId: r.agentId, agentName: r.agentName, auto: true, detail: `Re-routed to ${r.agentName} — ${r.reason} (${rec.source})` });
    return { ticket: updated, recommendation: rec };
}

export function updateStatus(id, dto, actor) {
    const updated = repo.updateStatus(id, { status: dto.status, resolution: dto.resolution ?? null, actorAgentId: actor.id, actorName: actor.name });
    if (!updated) throw new NotFoundError('Ticket not found');
    return updated;
}

export function addReply(id, dto, actor) {
    // OUTBOUND = visible reply to requester; NOTE = internal. (Actual email send is out of scope;
    // this records the reply and would hand off to an SMTP sender in production.)
    const detail = repo.addMessage(id, {
        direction: dto.isInternal ? 'NOTE' : 'OUTBOUND',
        body: dto.body,
        isInternal: dto.isInternal ? 1 : 0,
        agentId: actor.id,
        authorName: actor.name
    });
    if (!detail) throw new NotFoundError('Ticket not found');
    return detail;
}

export async function draftReply(id) {
    const ticket = repo.getTicketRow(id);
    if (!ticket) throw new NotFoundError('Ticket not found');
    const similar = findSimilarTickets(ticket).filter((s) => s.resolution && ['RESOLVED', 'CLOSED'].includes(s.status));
    const draft = await ai.draftReply({ ticket, similarResolved: similar });
    return { draft, aiAvailable: draft !== null, basedOn: similar.slice(0, 3).map((s) => ({ refNo: s.refNo, subject: s.subject, score: s.score })) };
}

export function listCategories() { return repo.listCategories(); }
export function listAgents() { return repo.listAgents(); }
