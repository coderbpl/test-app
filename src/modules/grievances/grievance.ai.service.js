import { ollamaClient, OLLAMA_MODEL, AI_ENABLED } from '../../config/ollama.js';

/**
 * AI layer, backed entirely by a LOCAL Ollama instance. Nothing here calls the public internet,
 * so grievance text — which may contain patient information — never leaves the server.
 *
 * Every function is best-effort: if Ollama is disabled, offline, slow, or returns junk, the
 * function returns null (or a fallback) and the grievance flow continues unaffected.
 */

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * @returns {boolean} Whether AI is switched on via config.
 */
export function isAiEnabled() {
    return AI_ENABLED;
}

/**
 * Pings the Ollama server to see whether it's reachable.
 *
 * @returns {Promise<{ up: boolean, model: string, models?: string[], error?: string }>}
 */
export async function checkHealth() {
    if (!AI_ENABLED) return { up: false, model: OLLAMA_MODEL, error: 'AI disabled via ENABLE_AI=false' };
    try {
        const { data } = await ollamaClient.get('/api/tags', { timeout: 5000 });
        const models = (data?.models || []).map((m) => m.name);
        return { up: true, model: OLLAMA_MODEL, models };
    } catch (err) {
        return { up: false, model: OLLAMA_MODEL, error: err.message };
    }
}

/**
 * Calls Ollama and parses a strict-JSON response.
 *
 * @param {string} prompt
 * @returns {Promise<object|null>} Parsed JSON, or null on any failure.
 */
async function generateJson(prompt) {
    const { data } = await ollamaClient.post('/api/generate', {
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        format: 'json',
        options: { temperature: 0 }
    });
    const raw = data?.response?.trim();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        // Occasionally a model wraps JSON in prose — salvage the first {...} block.
        const match = raw.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : null;
    }
}

/**
 * Calls Ollama for free-text output.
 *
 * @param {string} prompt
 * @param {number} [temperature]
 * @returns {Promise<string|null>}
 */
async function generateText(prompt, temperature = 0.4) {
    const { data } = await ollamaClient.post('/api/generate', {
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature }
    });
    return data?.response?.trim() || null;
}

/**
 * Classifies a free-text grievance into category / priority / language / urgency, plus a short
 * officer-facing summary. Returns null if AI is unavailable — the caller keeps the citizen's
 * chosen category (or defaults) in that case.
 *
 * @param {object} args
 * @param {string} args.text - The grievance description (any language, incl. Hindi/Hinglish).
 * @param {Array<{ code: string, name: string }>} args.categories - Allowed categories.
 * @returns {Promise<null | { categoryCode: string|null, priority: string|null, language: string|null, isUrgent: boolean, summary: string|null }>}
 */
export async function classifyGrievance({ text, categories }) {
    if (!AI_ENABLED || !text?.trim()) return null;

    const catList = categories.map((c) => `- ${c.code}: ${c.name}`).join('\n');
    const allowedCodes = categories.map((c) => c.code);

    const prompt = `You are a triage assistant for a government hospital grievance system in India.
Complaints arrive in English, Hindi, or a mix (Hinglish). Read the complaint and classify it.

Available categories (use the exact code):
${catList}

Rules:
- "priority" reflects harm/urgency: CRITICAL (patient safety, denial of emergency care, corruption),
  HIGH (medicine stock-out, staff misconduct, billing fraud), MEDIUM (waiting time, cleanliness),
  LOW (minor/other).
- "isUrgent" is true ONLY when there is a risk of serious patient harm, denial/delay of emergency
  treatment, or an ongoing safety issue.
- "language" is the ISO 639-1 code of the complaint text ("en", "hi", etc.).
- "summary" is one neutral English sentence (max 30 words) an officer can scan.

Respond with ONLY a JSON object of this exact shape:
{"categoryCode": "<one of the codes above>", "priority": "LOW|MEDIUM|HIGH|CRITICAL", "language": "<iso code>", "isUrgent": true|false, "summary": "<one sentence>"}

Complaint:
"""${text}"""`;

    try {
        const out = await generateJson(prompt);
        if (!out) return null;

        const categoryCode = allowedCodes.includes(out.categoryCode) ? out.categoryCode : null;
        const priority = PRIORITIES.includes(String(out.priority).toUpperCase())
            ? String(out.priority).toUpperCase()
            : null;
        const language = typeof out.language === 'string' ? out.language.slice(0, 10).toLowerCase() : null;
        const isUrgent = out.isUrgent === true || out.isUrgent === 'true';
        const summary = typeof out.summary === 'string' ? out.summary.trim().slice(0, 500) : null;

        return { categoryCode, priority, language, isUrgent, summary };
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[ai] classifyGrievance failed:', err.message);
        return null;
    }
}

/**
 * Drafts a citizen-facing reply for an officer to review and edit before sending. Never sent
 * automatically — this only produces text.
 *
 * @param {object} args
 * @param {object} args.grievance - Grievance row (needs description, language, status, tracking_no).
 * @param {'acknowledgement'|'resolution'} [args.kind]
 * @returns {Promise<string|null>}
 */
export async function draftReply({ grievance, kind = 'acknowledgement' }) {
    if (!AI_ENABLED || !grievance) return null;

    const langNote = grievance.language === 'hi'
        ? 'Write the reply in polite Hindi (Devanagari).'
        : 'Write the reply in the same language as the complaint (English or Hindi).';

    const intent = kind === 'resolution'
        ? 'The grievance has been resolved. Briefly explain that the issue was addressed and thank them.'
        : 'Acknowledge receipt of the grievance and reassure them it is being looked into.';

    const prompt = `You are a courteous government hospital grievance officer.
${intent}
${langNote}
Keep it under 80 words, warm and respectful. Reference their tracking number ${grievance.tracking_no}.
Do NOT invent specific facts, dates, names, or compensation. Do not include placeholders like [name].

Citizen's complaint (for context only, do not quote patient details):
"""${grievance.description}"""

Reply:`;

    try {
        return await generateText(prompt, 0.4);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[ai] draftReply failed:', err.message);
        return null;
    }
}
