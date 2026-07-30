import { db } from '../../config/db.js';
import { env } from '../../config/env.js';
import { tokenize, toVector, cosine } from '../../utils/textSimilarity.js';

/**
 * The recommendation engine — fully local, no external service. Given a ticket, it finds the most
 * lexically similar past tickets and, from the ones that were resolved, recommends the agent who
 * handled them (weighted by similarity). This is what drives both the "similar tickets" panel and
 * auto-assignment.
 */

/**
 * Finds the top-K past tickets most similar to the given one (cosine over term-frequency vectors).
 *
 * @param {{ id?: number, subject: string, body: string }} ticket
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @returns {Array<{id:number, refNo:string, subject:string, status:string, resolution:string|null,
 *   assignedAgentId:number|null, agentName:string|null, categoryName:string|null, score:number}>}
 */
export function findSimilarTickets(ticket, { limit = env.reco.topK } = {}) {
    const target = toVector(tokenize(`${ticket.subject} ${ticket.body}`));
    if (!target.norm) return [];

    const rows = db
        .prepare(
            `SELECT t.id, t.ref_no AS refNo, t.subject, t.body, t.status, t.resolution,
                    t.assigned_agent_id AS assignedAgentId, a.name AS agentName, c.name AS categoryName
             FROM tickets t
             LEFT JOIN agents a ON a.id = t.assigned_agent_id
             LEFT JOIN categories c ON c.id = t.category_id
             WHERE t.id != @id`
        )
        .all({ id: ticket.id ?? -1 });

    return rows
        .map((r) => {
            const { body, ...rest } = r;
            return { ...rest, score: cosine(target, toVector(tokenize(`${r.subject} ${body}`))) };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((r) => ({ ...r, score: Math.round(r.score * 1000) / 1000 }));
}

/**
 * Recommends an agent for a ticket by a similarity-weighted vote over the resolved tickets among
 * its nearest neighbours. Only neighbours above the configured threshold count.
 *
 * @param {Array} similar - Output of findSimilarTickets.
 * @returns {null | { agentId:number, agentName:string, score:number, basedOn:number, reason:string }}
 */
export function recommendAgentFromSimilar(similar) {
    const votes = new Map(); // agentId -> { name, score, count }
    for (const s of similar) {
        if (s.score < env.reco.threshold) continue;
        if (!s.assignedAgentId || !['RESOLVED', 'CLOSED'].includes(s.status)) continue;
        const v = votes.get(s.assignedAgentId) || { name: s.agentName, score: 0, count: 0 };
        v.score += s.score;
        v.count += 1;
        votes.set(s.assignedAgentId, v);
    }
    if (votes.size === 0) return null;

    let best = null;
    for (const [agentId, v] of votes) {
        if (!best || v.score > best.score) best = { agentId, ...v };
    }
    return {
        agentId: best.agentId,
        agentName: best.name,
        score: Math.round(best.score * 1000) / 1000,
        basedOn: best.count,
        reason: `Resolved ${best.count} similar ticket${best.count > 1 ? 's' : ''}`
    };
}

/**
 * Least-loaded active agent (fewest open tickets) — the fallback when there's no confident
 * similarity-based recommendation.
 *
 * @returns {null | { agentId:number, agentName:string, reason:string }}
 */
export function leastLoadedAgent() {
    const row = db
        .prepare(
            `SELECT a.id AS agentId, a.name AS agentName,
                    (SELECT COUNT(*) FROM tickets t
                     WHERE t.assigned_agent_id = a.id AND t.status NOT IN ('RESOLVED','CLOSED')) AS load
             FROM agents a
             WHERE a.status = 1 AND a.role = 'agent'
             ORDER BY load ASC, a.id ASC
             LIMIT 1`
        )
        .get();
    return row ? { agentId: row.agentId, agentName: row.agentName, reason: 'Least-loaded agent (no similar history)' } : null;
}

/**
 * Full recommendation bundle for a ticket: similar tickets, recommended agent (similarity-based,
 * with load-based fallback), and the suggested-agent source.
 *
 * @param {{ id?: number, subject: string, body: string }} ticket
 */
export function buildRecommendation(ticket) {
    const similar = findSimilarTickets(ticket);
    const bySimilarity = recommendAgentFromSimilar(similar);
    const recommendedAgent = bySimilarity || leastLoadedAgent();
    return {
        similar,
        recommendedAgent,
        source: bySimilarity ? 'similarity' : (recommendedAgent ? 'load-balance' : 'none')
    };
}
