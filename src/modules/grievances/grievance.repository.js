import { db } from '../../config/db.js';
import { buildTrackingNo } from '../../utils/trackingNo.js';

const nowIso = () => new Date().toISOString();

// Column projection for a single grievance, aliased to camelCase for the API.
const GRIEVANCE_COLS = `
    g.id, g.tracking_no AS trackingNo, g.category_id AS categoryId, c.name AS categoryName,
    g.title, g.description, g.language,
    g.is_anonymous AS isAnonymous, g.complainant_name AS complainantName,
    g.complainant_mobile AS complainantMobile, g.complainant_email AS complainantEmail,
    g.hospital_id AS hospitalId, g.division_id AS divisionId, g.district_id AS districtId,
    g.block_id AS blockId, g.location_text AS locationText,
    g.priority, g.status, g.is_urgent AS isUrgent, g.ai_summary AS aiSummary, g.ai_processed AS aiProcessed,
    g.sla_due_at AS slaDueAt, g.current_owner_tier AS currentOwnerTier,
    g.assigned_to_officer_id AS assignedToOfficerId, g.created_by_officer_id AS createdByOfficerId,
    g.resolved_at AS resolvedAt, g.closed_at AS closedAt,
    g.created_at AS createdAt, g.updated_at AS updatedAt
`;

// ---- Categories ------------------------------------------------------------

export function listCategories(status = 1) {
    return db
        .prepare(
            `SELECT id, code, name, name_hi AS nameHi, default_priority AS defaultPriority,
                    sla_hours AS slaHours, status
             FROM categories
             WHERE (@status IS NULL OR status = @status)
             ORDER BY name ASC`
        )
        .all({ status });
}

export function getCategoryByCode(code) {
    return db.prepare('SELECT * FROM categories WHERE code = ?').get(code) || null;
}

export function getCategoryById(id) {
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) || null;
}

// ---- Timeline helper -------------------------------------------------------

function insertTimeline({ grievanceId, eventType, fromStatus = null, toStatus = null, comment = null, actorOfficerId = null, actorName = null, isInternal = 0 }) {
    db.prepare(
        `INSERT INTO timeline (grievance_id, event_type, from_status, to_status, comment, actor_officer_id, actor_name, is_internal)
         VALUES (@grievanceId, @eventType, @fromStatus, @toStatus, @comment, @actorOfficerId, @actorName, @isInternal)`
    ).run({ grievanceId, eventType, fromStatus, toStatus, comment, actorOfficerId, actorName, isInternal });
}

// ---- Grievance reads -------------------------------------------------------

export function getGrievanceRow(id) {
    return db
        .prepare(`SELECT ${GRIEVANCE_COLS} FROM grievances g LEFT JOIN categories c ON c.id = g.category_id WHERE g.id = ?`)
        .get(id) || null;
}

export function getGrievanceDetail(id) {
    const grievance = getGrievanceRow(id);
    if (!grievance) return null;
    const timeline = db
        .prepare(
            `SELECT id, event_type AS eventType, from_status AS fromStatus, to_status AS toStatus,
                    comment, actor_officer_id AS actorOfficerId, actor_name AS actorName,
                    is_internal AS isInternal, created_at AS createdAt
             FROM timeline WHERE grievance_id = ? ORDER BY created_at ASC, id ASC`
        )
        .all(id);
    const attachments = db
        .prepare(
            `SELECT id, file_name AS fileName, file_path AS filePath, mime_type AS mimeType, created_at AS createdAt
             FROM attachments WHERE grievance_id = ? ORDER BY created_at ASC`
        )
        .all(id);
    const feedback = db.prepare('SELECT id, rating, comment, created_at AS createdAt FROM feedback WHERE grievance_id = ?').get(id) || null;
    return { ...grievance, timeline, attachments, feedback };
}

export function getByTrackingNo(trackingNo) {
    const grievance = db
        .prepare(
            `SELECT g.tracking_no AS trackingNo, c.name AS categoryName, g.title, g.priority, g.status,
                    g.created_at AS createdAt, g.resolved_at AS resolvedAt
             FROM grievances g LEFT JOIN categories c ON c.id = g.category_id
             WHERE g.tracking_no = ?`
        )
        .get(trackingNo);
    if (!grievance) return null;
    const timeline = db
        .prepare(
            `SELECT t.event_type AS eventType, t.to_status AS toStatus, t.comment, t.actor_name AS actorName, t.created_at AS createdAt
             FROM timeline t
             JOIN grievances g ON g.id = t.grievance_id
             WHERE g.tracking_no = ? AND t.is_internal = 0
             ORDER BY t.created_at ASC, t.id ASC`
        )
        .all(trackingNo);
    return { ...grievance, timeline };
}

// ---- Grievance list (officer inbox) ---------------------------------------

/**
 * Builds a WHERE clause + params object from filter/scope options shared by list + dashboard.
 */
function buildFilter(opts = {}) {
    const where = [];
    const params = {};
    const add = (cond, key, val) => {
        if (val !== undefined && val !== null && val !== '') {
            where.push(cond);
            params[key] = val;
        }
    };
    if (opts.search) {
        where.push('(g.title LIKE @search OR g.description LIKE @search OR g.tracking_no LIKE @search)');
        params.search = `%${opts.search}%`;
    }
    add('g.status = @status', 'status', opts.status);
    add('g.priority = @priority', 'priority', opts.priority);
    add('g.category_id = @categoryId', 'categoryId', opts.categoryId);
    add('g.hospital_id = @hospitalId', 'hospitalId', opts.hospitalId);
    add('g.division_id = @divisionId', 'divisionId', opts.divisionId);
    add('g.district_id = @districtId', 'districtId', opts.districtId);
    add('g.assigned_to_officer_id = @assignedToOfficerId', 'assignedToOfficerId', opts.assignedToOfficerId);
    if (opts.isUrgent !== undefined && opts.isUrgent !== null) {
        where.push('g.is_urgent = @isUrgent');
        params.isUrgent = opts.isUrgent ? 1 : 0;
    }
    return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listGrievances(opts = {}) {
    const { clause, params } = buildFilter(opts);
    const rows = db
        .prepare(
            `SELECT g.id, g.tracking_no AS trackingNo, g.category_id AS categoryId, c.name AS categoryName,
                    g.title, g.language, g.priority, g.status, g.is_urgent AS isUrgent, g.ai_summary AS aiSummary,
                    g.hospital_id AS hospitalId, g.district_id AS districtId,
                    g.current_owner_tier AS currentOwnerTier, g.assigned_to_officer_id AS assignedToOfficerId,
                    g.sla_due_at AS slaDueAt,
                    CASE WHEN g.status NOT IN ('RESOLVED','CLOSED') AND g.sla_due_at < @now THEN 1 ELSE 0 END AS slaBreached,
                    g.created_at AS createdAt, g.updated_at AS updatedAt
             FROM grievances g LEFT JOIN categories c ON c.id = g.category_id
             ${clause}
             ORDER BY g.is_urgent DESC,
                      CASE g.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
                      g.created_at DESC
             LIMIT @limit OFFSET @offset`
        )
        .all({ ...params, now: nowIso(), limit: opts.limit, offset: opts.offset });
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM grievances g ${clause}`).get(params);
    return { rows, total };
}

// ---- Grievance writes ------------------------------------------------------

export function createGrievance(data) {
    const tx = db.transaction((d) => {
        const info = db
            .prepare(
                `INSERT INTO grievances
                    (category_id, title, description, language, is_anonymous, complainant_name,
                     complainant_mobile, complainant_email, hospital_id, division_id, district_id,
                     block_id, location_text, priority, status, sla_due_at, current_owner_tier, created_by_officer_id)
                 VALUES
                    (@categoryId, @title, @description, @language, @isAnonymous, @complainantName,
                     @complainantMobile, @complainantEmail, @hospitalId, @divisionId, @districtId,
                     @blockId, @locationText, @priority, 'NEW', @slaDueAt, 'FACILITY', @createdByOfficerId)`
            )
            .run({
                categoryId: d.categoryId ?? null,
                title: d.title ?? null,
                description: d.description,
                language: d.language ?? null,
                isAnonymous: d.isAnonymous ? 1 : 0,
                complainantName: d.complainantName ?? null,
                complainantMobile: d.complainantMobile ?? null,
                complainantEmail: d.complainantEmail ?? null,
                hospitalId: d.hospitalId ?? null,
                divisionId: d.divisionId ?? null,
                districtId: d.districtId ?? null,
                blockId: d.blockId ?? null,
                locationText: d.locationText ?? null,
                priority: d.priority,
                slaDueAt: d.slaDueAt,
                createdByOfficerId: d.createdByOfficerId ?? null
            });
        const id = Number(info.lastInsertRowid);
        const trackingNo = buildTrackingNo(id);
        db.prepare('UPDATE grievances SET tracking_no = ? WHERE id = ?').run(trackingNo, id);
        insertTimeline({
            grievanceId: id,
            eventType: 'CREATED',
            toStatus: 'NEW',
            comment: 'Grievance filed',
            actorOfficerId: d.createdByOfficerId ?? null,
            actorName: d.actorName || d.complainantName || 'Anonymous'
        });
        return id;
    });
    const id = tx(data);
    return getGrievanceRow(id);
}

export function updateStatus(id, { status, comment, actorOfficerId, actorName }) {
    const current = db.prepare('SELECT status FROM grievances WHERE id = ?').get(id);
    if (!current) return null;
    const tx = db.transaction(() => {
        db.prepare(
            `UPDATE grievances
             SET status = @status,
                 resolved_at = CASE WHEN @status = 'RESOLVED' THEN @now
                                    WHEN @status = 'REOPENED' THEN NULL ELSE resolved_at END,
                 closed_at   = CASE WHEN @status = 'CLOSED' THEN @now ELSE closed_at END,
                 updated_at  = @now
             WHERE id = @id`
        ).run({ id, status, now: nowIso() });
        insertTimeline({ grievanceId: id, eventType: 'STATUS_CHANGE', fromStatus: current.status, toStatus: status, comment, actorOfficerId, actorName });
    });
    tx();
    return getGrievanceRow(id);
}

export function assign(id, { assignedToOfficerId, ownerTier, actorOfficerId, actorName }) {
    if (!db.prepare('SELECT 1 FROM grievances WHERE id = ?').get(id)) return null;
    const tx = db.transaction(() => {
        db.prepare(
            `UPDATE grievances
             SET assigned_to_officer_id = @assignedToOfficerId,
                 current_owner_tier = COALESCE(@ownerTier, current_owner_tier),
                 status = CASE WHEN status = 'NEW' THEN 'ACKNOWLEDGED' ELSE status END,
                 updated_at = @now
             WHERE id = @id`
        ).run({ id, assignedToOfficerId, ownerTier: ownerTier ?? null, now: nowIso() });
        insertTimeline({ grievanceId: id, eventType: 'ASSIGNED', comment: `Assigned to officer #${assignedToOfficerId}`, actorOfficerId, actorName });
    });
    tx();
    return getGrievanceRow(id);
}

export function escalate(id, { toTier, reason, actorOfficerId, actorName }) {
    const current = db.prepare('SELECT current_owner_tier FROM grievances WHERE id = ?').get(id);
    if (!current) return null;
    const tx = db.transaction(() => {
        db.prepare(
            `UPDATE grievances
             SET current_owner_tier = @toTier,
                 assigned_to_officer_id = NULL,
                 priority = CASE WHEN priority = 'LOW' THEN 'MEDIUM' WHEN priority = 'MEDIUM' THEN 'HIGH' ELSE priority END,
                 updated_at = @now
             WHERE id = @id`
        ).run({ id, toTier, now: nowIso() });
        insertTimeline({
            grievanceId: id,
            eventType: 'ESCALATED',
            comment: `Escalated ${current.current_owner_tier} -> ${toTier}${reason ? `. Reason: ${reason}` : ''}`,
            actorOfficerId,
            actorName
        });
    });
    tx();
    return getGrievanceRow(id);
}

export function addComment(id, { comment, isInternal, actorOfficerId, actorName }) {
    if (!db.prepare('SELECT 1 FROM grievances WHERE id = ?').get(id)) return null;
    insertTimeline({ grievanceId: id, eventType: 'COMMENT', comment, isInternal: isInternal ? 1 : 0, actorOfficerId, actorName });
    db.prepare('UPDATE grievances SET updated_at = ? WHERE id = ?').run(nowIso(), id);
    return getGrievanceDetail(id);
}

export function saveFeedback(grievanceId, { rating, comment }) {
    const g = db.prepare('SELECT status FROM grievances WHERE id = ?').get(grievanceId);
    if (!g) return { error: 'NOT_FOUND' };
    if (!['RESOLVED', 'CLOSED'].includes(g.status)) return { error: 'NOT_RESOLVED' };
    const tx = db.transaction(() => {
        db.prepare(
            `INSERT INTO feedback (grievance_id, rating, comment) VALUES (@grievanceId, @rating, @comment)
             ON CONFLICT(grievance_id) DO UPDATE SET rating = @rating, comment = @comment, created_at = @now`
        ).run({ grievanceId, rating, comment: comment ?? null, now: nowIso() });
        insertTimeline({ grievanceId, eventType: 'FEEDBACK', comment: `Citizen rated ${rating}/5`, actorName: 'Citizen' });
    });
    tx();
    return { feedback: db.prepare('SELECT id, rating, comment, created_at AS createdAt FROM feedback WHERE grievance_id = ?').get(grievanceId) };
}

export function applyAiClassification(id, { categoryId, priority, language, isUrgent, aiSummary }) {
    const current = db.prepare('SELECT status, created_at FROM grievances WHERE id = ?').get(id);
    if (!current) return null;

    let slaDueAt = null;
    if (categoryId) {
        const cat = getCategoryById(categoryId);
        if (cat && !['RESOLVED', 'CLOSED'].includes(current.status)) {
            slaDueAt = new Date(new Date(current.created_at).getTime() + cat.sla_hours * 3600 * 1000).toISOString();
        }
    }

    const tx = db.transaction(() => {
        db.prepare(
            `UPDATE grievances
             SET category_id = COALESCE(@categoryId, category_id),
                 priority    = COALESCE(@priority, priority),
                 language    = COALESCE(@language, language),
                 is_urgent   = COALESCE(@isUrgent, is_urgent),
                 ai_summary  = COALESCE(@aiSummary, ai_summary),
                 ai_processed = 1,
                 sla_due_at  = COALESCE(@slaDueAt, sla_due_at),
                 updated_at  = @now
             WHERE id = @id`
        ).run({
            id,
            categoryId: categoryId ?? null,
            priority: priority ?? null,
            language: language ?? null,
            isUrgent: isUrgent === undefined || isUrgent === null ? null : (isUrgent ? 1 : 0),
            aiSummary: aiSummary ?? null,
            slaDueAt,
            now: nowIso()
        });
        insertTimeline({
            grievanceId: id,
            eventType: 'AI_CLASSIFIED',
            comment: `AI classified: priority=${priority ?? '-'}, urgent=${isUrgent ?? '-'}, lang=${language ?? '-'}`,
            actorName: 'AI Assistant',
            isInternal: 1
        });
    });
    tx();
    return getGrievanceRow(id);
}

export function addAttachment({ grievanceId, fileName, filePath, mimeType, uploadedByOfficerId }) {
    if (!db.prepare('SELECT 1 FROM grievances WHERE id = ?').get(grievanceId)) return null;
    const info = db
        .prepare(
            `INSERT INTO attachments (grievance_id, file_name, file_path, mime_type, uploaded_by_officer_id)
             VALUES (?, ?, ?, ?, ?)`
        )
        .run(grievanceId, fileName, filePath, mimeType ?? null, uploadedByOfficerId ?? null);
    insertTimeline({ grievanceId, eventType: 'ATTACHMENT', comment: `Attachment added: ${fileName}`, actorOfficerId: uploadedByOfficerId ?? null });
    return db.prepare('SELECT id, file_name AS fileName, file_path AS filePath FROM attachments WHERE id = ?').get(Number(info.lastInsertRowid));
}

// ---- Dashboard + SLA sweep -------------------------------------------------

export function dashboard(opts = {}) {
    const { clause, params } = buildFilter(opts);
    const now = nowIso();

    const totals = db
        .prepare(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN g.status NOT IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END) AS open,
                SUM(CASE WHEN g.status IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END) AS resolved,
                SUM(CASE WHEN g.is_urgent = 1 AND g.status NOT IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END) AS urgentOpen,
                SUM(CASE WHEN g.status NOT IN ('RESOLVED','CLOSED') AND g.sla_due_at < @now THEN 1 ELSE 0 END) AS slaBreached
             FROM grievances g ${clause}`
        )
        .get({ ...params, now });

    const total = totals.total || 0;
    const slaCompliancePct = total === 0 ? 100 : Math.round(((total - (totals.slaBreached || 0)) / total) * 10000) / 100;

    const byStatus = db.prepare(`SELECT g.status, COUNT(*) AS count FROM grievances g ${clause} GROUP BY g.status`).all(params);
    const byPriority = db.prepare(`SELECT g.priority, COUNT(*) AS count FROM grievances g ${clause} GROUP BY g.priority`).all(params);
    const byCategory = db
        .prepare(
            `SELECT COALESCE(c.name, 'Unclassified') AS categoryName, COUNT(*) AS count
             FROM grievances g LEFT JOIN categories c ON c.id = g.category_id ${clause}
             GROUP BY categoryName ORDER BY count DESC`
        )
        .all(params);

    return { totals: { ...totals, slaCompliancePct }, byStatus, byPriority, byCategory };
}

const NEXT_TIER = { FACILITY: 'DISTRICT', BLOCK: 'DISTRICT', DISTRICT: 'DIVISION', DIVISION: 'STATE' };

/**
 * Escalates every overdue, still-open grievance one tier up the ladder. Returns the affected rows.
 * Intended for the scheduled SLA sweep.
 */
export function escalateOverdue() {
    const now = nowIso();
    const overdue = db
        .prepare(
            `SELECT id, current_owner_tier AS tier FROM grievances
             WHERE status NOT IN ('RESOLVED','CLOSED') AND sla_due_at < ? AND current_owner_tier <> 'STATE'`
        )
        .all(now);

    const results = [];
    const tx = db.transaction(() => {
        for (const g of overdue) {
            const toTier = NEXT_TIER[g.tier] || 'STATE';
            db.prepare('UPDATE grievances SET current_owner_tier = ?, assigned_to_officer_id = NULL, updated_at = ? WHERE id = ?').run(toTier, now, g.id);
            insertTimeline({
                grievanceId: g.id,
                eventType: 'ESCALATED',
                comment: `Auto-escalated (SLA breach) ${g.tier} -> ${toTier}`,
                actorName: 'System (SLA)',
                isInternal: 1
            });
            results.push({ id: g.id, fromTier: g.tier, toTier });
        }
    });
    tx();
    return results;
}
