import { groqClient, GROQ_MODEL, AI_ENABLED } from '../../config/groq.js';

/**
 * LLM layer, backed by Groq (OpenAI-compatible chat completions). Used for classifying incoming
 * tickets and drafting suggested replies. This is a CLOUD call — text sent here leaves the server.
 * Similar-ticket retrieval and agent routing live in recommendation.service.js and stay local.
 *
 * Every function is best-effort: with no API key or on any error, it returns null and the ticket
 * flow continues (manual category/priority, no draft).
 */
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export function isAiEnabled() {
    return AI_ENABLED;
}

export async function checkHealth() {
    if (!AI_ENABLED) return { up: false, model: GROQ_MODEL, error: 'AI disabled or GROQ_API_KEY not set' };
    try {
        await groqClient.get('/models', { timeout: 8000 });
        return { up: true, model: GROQ_MODEL };
    } catch (err) {
        return { up: false, model: GROQ_MODEL, error: err.response?.data?.error?.message || err.message };
    }
}

async function chat(messages, { json = false, temperature = 0.2 } = {}) {
    const { data } = await groqClient.post('/chat/completions', {
        model: GROQ_MODEL,
        messages,
        temperature,
        ...(json ? { response_format: { type: 'json_object' } } : {})
    });
    return data?.choices?.[0]?.message?.content?.trim() || null;
}

/**
 * Classifies a ticket into category / priority + a one-line summary.
 *
 * @param {object} args
 * @param {string} args.subject
 * @param {string} args.body
 * @param {Array<{code:string,name:string}>} args.categories
 * @returns {Promise<null | {categoryCode:string|null, priority:string|null, summary:string|null}>}
 */
export async function classifyTicket({ subject, body, categories }) {
    if (!AI_ENABLED) return null;
    const codes = categories.map((c) => c.code);
    const list = categories.map((c) => `- ${c.code}: ${c.name}`).join('\n');
    const system = 'You are a support-desk triage assistant. Respond with a strict JSON object only.';
    const user = `Classify this support ticket.

Categories (use the exact code):
${list}

Priority: URGENT (outage, data loss, payment failure, security), HIGH (blocked user, refund/billing error),
MEDIUM (normal issue), LOW (question/how-to).

Return JSON exactly: {"categoryCode":"<code>","priority":"LOW|MEDIUM|HIGH|URGENT","summary":"<one sentence, max 25 words>"}

Subject: ${subject}
Body: ${body}`;

    try {
        const raw = await chat([{ role: 'system', content: system }, { role: 'user', content: user }], { json: true });
        if (!raw) return null;
        const out = JSON.parse(raw);
        return {
            categoryCode: codes.includes(out.categoryCode) ? out.categoryCode : null,
            priority: PRIORITIES.includes(String(out.priority).toUpperCase()) ? String(out.priority).toUpperCase() : null,
            summary: typeof out.summary === 'string' ? out.summary.trim().slice(0, 400) : null
        };
    } catch (err) {
        console.warn('[ai] classifyTicket failed:', err.response?.data?.error?.message || err.message); // eslint-disable-line no-console
        return null;
    }
}

/**
 * Drafts a suggested reply grounded in how similar past tickets were resolved. Never sent
 * automatically — the agent reviews and edits it.
 *
 * @param {object} args
 * @param {object} args.ticket - Current ticket ({ subject, body, requesterName }).
 * @param {Array<{subject:string, resolution:string, score:number}>} args.similarResolved
 * @returns {Promise<string|null>}
 */
export async function draftReply({ ticket, similarResolved }) {
    if (!AI_ENABLED) return null;
    const context = similarResolved
        .filter((s) => s.resolution)
        .slice(0, 3)
        .map((s, i) => `Past case ${i + 1} (similarity ${(s.score * 100).toFixed(0)}%): "${s.subject}"\nResolution: ${s.resolution}`)
        .join('\n\n') || 'No closely matching past cases were found.';

    const system = 'You are a helpful, concise customer-support agent. Write a reply the agent can send after light editing.';
    const user = `Draft a reply to this customer, grounded in how we resolved similar past tickets.
Keep it under 120 words, warm and professional. Do not invent specific facts (order numbers, dates, amounts) —
if a detail is needed, ask for it. Do not include placeholders like [name].

New ticket
Subject: ${ticket.subject}
Message: ${ticket.body}

How we handled similar cases:
${context}

Reply:`;

    try {
        return await chat([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.4 });
    } catch (err) {
        console.warn('[ai] draftReply failed:', err.response?.data?.error?.message || err.message); // eslint-disable-line no-console
        return null;
    }
}
