import { db } from '../../config/db.js';
import { buildRefNo } from '../../utils/refNo.js';

const nowIso = () => new Date().toISOString();

const TICKET_COLS = `
    t.id, t.ref_no AS refNo, t.source, t.subject, t.body,
    t.requester_name AS requesterName, t.requester_email AS requesterEmail,
    t.category_id AS categoryId, c.name AS categoryName,
    t.priority, t.status, t.assigned_agent_id AS assignedAgentId, a.name AS assignedAgentName,
    t.ai_summary AS aiSummary, t.ai_processed AS aiProcessed, t.resolution,
    t.email_message_id AS emailMessageId, t.email_thread_key AS emailThreadKey,
    t.resolved_at AS resolvedAt, t.closed_at AS closedAt, t.created_at AS createdAt, t.updated_at AS updatedAt
`;

export function listCategories() {
    return db.prepare('SELECT id, code, name FROM categories WHERE status = 1 ORDER BY name').all();
}
export function getCategoryByCode(code) {
    return db.prepare('SELECT * FROM categories WHERE code = ?').get(code) || null;
}
export function listAgents() {
    return db.prepare("SELECT id, name, email, skills, role FROM agents WHERE status = 1 ORDER BY role, name").all();
}
export function agentExists(id) {
    return Boolean(db.prepare('SELECT 1 FROM agents WHERE id = ? AND status = 1').get(id));
}

function logEvent({ ticketId, eventType, detail = null, actorAgentId = null, actorName = null }) {
    db.prepare(
        `INSERT INTO ticket_events (ticket_id, event_type, detail, actor_agent_id, actor_name)
         VALUES (?, ?, ?, ?, ?)`
    ).run(ticketId, eventType, detail, actorAgentId, actorName);
}

export function getTicketRow(id) {
    return db
        .prepare(`SELECT ${TICKET_COLS} FROM tickets t LEFT JOIN agents a ON a.id = t.assigned_agent_id LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = ?`)
        .get(id) || null;
}

export function getTicketDetail(id) {
    const ticket = getTicketRow(id);
    if (!ticket) return null;
    const messages = db
        .prepare(
            `SELECT id, direction, author_name AS authorName, author_email AS authorEmail, agent_id AS agentId,
                    body, is_internal AS isInternal, created_at AS createdAt
             FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC, id ASC`
        )
        .all(id);
    const events = db
        .prepare(
            `SELECT id, event_type AS eventType, detail, actor_name AS actorName, created_at AS createdAt
             FROM ticket_events WHERE ticket_id = ? ORDER BY created_at ASC, id ASC`
        )
        .all(id);
    return { ...ticket, messages, events };
}

export function findByEmailMessageId(messageId) {
    if (!messageId) return null;
    return db.prepare('SELECT id FROM tickets WHERE email_message_id = ?').get(messageId) || null;
}
export function findOpenByThreadKey(threadKey) {
    if (!threadKey) return null;
    return db
        .prepare("SELECT id FROM tickets WHERE email_thread_key = ? AND status NOT IN ('CLOSED') ORDER BY id DESC LIMIT 1")
        .get(threadKey) || null;
}

/**
 * Inserts a ticket + its first inbound message + CREATED event. Returns the new row.
 */
export function createTicket(data) {
    const tx = db.transaction((d) => {
        const info = db
            .prepare(
                `INSERT INTO tickets (source, subject, body, requester_name, requester_email, category_id,
                                      priority, status, email_message_id, email_thread_key)
                 VALUES (@source, @subject, @body, @requesterName, @requesterEmail, @categoryId,
                         @priority, 'OPEN', @emailMessageId, @emailThreadKey)`
            )
            .run({
                source: d.source || 'WEB',
                subject: d.subject,
                body: d.body,
                requesterName: d.requesterName ?? null,
                requesterEmail: d.requesterEmail ?? null,
                categoryId: d.categoryId ?? null,
                priority: d.priority || 'MEDIUM',
                emailMessageId: d.emailMessageId ?? null,
                emailThreadKey: d.emailThreadKey ?? null
            });
        const id = Number(info.lastInsertRowid);
        db.prepare('UPDATE tickets SET ref_no = ? WHERE id = ?').run(buildRefNo(id), id);
        db.prepare(
            `INSERT INTO ticket_messages (ticket_id, direction, author_name, author_email, body, email_message_id)
             VALUES (?, 'INBOUND', ?, ?, ?, ?)`
        ).run(id, d.requesterName ?? null, d.requesterEmail ?? null, d.body, d.emailMessageId ?? null);
        logEvent({ ticketId: id, eventType: 'CREATED', detail: `Created via ${d.source || 'WEB'}`, actorName: d.requesterName || d.requesterEmail || 'requester' });
        return id;
    });
    return getTicketRow(tx(data));
}

export function applyClassification(id, { categoryId, priority, aiSummary }) {
    if (!getTicketRow(id)) return null;
    db.prepare(
        `UPDATE tickets SET category_id = COALESCE(?, category_id), priority = COALESCE(?, priority),
                            ai_summary = COALESCE(?, ai_summary), ai_processed = 1, updated_at = ?
         WHERE id = ?`
    ).run(categoryId ?? null, priority ?? null, aiSummary ?? null, nowIso(), id);
    logEvent({ ticketId: id, eventType: 'AI_CLASSIFIED', detail: `priority=${priority ?? '-'}, category=${categoryId ?? '-'}`, actorName: 'Groq AI' });
    return getTicketRow(id);
}

export function assign(id, { agentId, agentName, auto = false, detail = null, actorAgentId = null, actorName = null }) {
    if (!getTicketRow(id)) return null;
    db.prepare(
        `UPDATE tickets SET assigned_agent_id = ?, status = CASE WHEN status = 'OPEN' THEN 'ASSIGNED' ELSE status END, updated_at = ?
         WHERE id = ?`
    ).run(agentId, nowIso(), id);
    logEvent({
        ticketId: id,
        eventType: auto ? 'AUTO_ASSIGNED' : 'ASSIGNED',
        detail: detail || `Assigned to ${agentName || 'agent #' + agentId}`,
        actorAgentId,
        actorName: actorName || (auto ? 'Auto-router' : agentName)
    });
    return getTicketRow(id);
}

export function updateStatus(id, { status, resolution, actorAgentId, actorName }) {
    const cur = db.prepare('SELECT status FROM tickets WHERE id = ?').get(id);
    if (!cur) return null;
    db.prepare(
        `UPDATE tickets
         SET status = @status,
             resolution = COALESCE(@resolution, resolution),
             resolved_at = CASE WHEN @status = 'RESOLVED' THEN @now WHEN @status = 'REOPENED' THEN NULL ELSE resolved_at END,
             closed_at   = CASE WHEN @status = 'CLOSED' THEN @now ELSE closed_at END,
             updated_at  = @now
         WHERE id = @id`
    ).run({ id, status, resolution: resolution ?? null, now: nowIso() });
    logEvent({ ticketId: id, eventType: 'STATUS_CHANGE', detail: `${cur.status} -> ${status}`, actorAgentId, actorName });
    return getTicketRow(id);
}

export function addMessage(id, { direction, body, isInternal = 0, agentId = null, authorName = null, authorEmail = null }) {
    if (!getTicketRow(id)) return null;
    db.prepare(
        `INSERT INTO ticket_messages (ticket_id, direction, author_name, author_email, agent_id, body, is_internal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, direction, authorName, authorEmail, agentId, body, isInternal ? 1 : 0);
    logEvent({ ticketId: id, eventType: direction === 'NOTE' ? 'NOTE' : 'REPLY', detail: direction, actorAgentId: agentId, actorName: authorName });
    db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(nowIso(), id);
    return getTicketDetail(id);
}

export function logRecommendation(id, detail) {
    logEvent({ ticketId: id, eventType: 'RECOMMENDATION', detail, actorName: 'Recommendation engine' });
}

export function listTickets(opts = {}) {
    const where = [];
    const params = {};
    if (opts.search) { where.push('(t.subject LIKE @search OR t.body LIKE @search OR t.ref_no LIKE @search)'); params.search = `%${opts.search}%`; }
    const add = (cond, key, val) => { if (val !== undefined && val !== null && val !== '') { where.push(cond); params[key] = val; } };
    add('t.status = @status', 'status', opts.status);
    add('t.priority = @priority', 'priority', opts.priority);
    add('t.category_id = @categoryId', 'categoryId', opts.categoryId);
    add('t.assigned_agent_id = @assignedAgentId', 'assignedAgentId', opts.assignedAgentId);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db
        .prepare(
            `SELECT ${TICKET_COLS} FROM tickets t
             LEFT JOIN agents a ON a.id = t.assigned_agent_id LEFT JOIN categories c ON c.id = t.category_id
             ${clause}
             ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
                      t.created_at DESC
             LIMIT @limit OFFSET @offset`
        )
        .all({ ...params, limit: opts.limit, offset: opts.offset });
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM tickets t ${clause}`).get(params);
    return { rows, total };
}
