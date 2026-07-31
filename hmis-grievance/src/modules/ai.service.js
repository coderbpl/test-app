import { env } from '../config/env.js';

/**
 * Minimal AI layer for "Rewrite with AI", provider-agnostic (local Ollama or Groq). Uses the
 * global fetch (Node 20+), so there's no extra dependency. Best-effort: returns null when the
 * provider is 'none', not configured, or unreachable — the caller then keeps the user's text.
 *
 * Default provider is 'ollama' (local) so patient-identifying complaint text never leaves the
 * server. Set AI_PROVIDER=groq (+ GROQ_API_KEY) to use the cloud model instead.
 */
const { provider, timeoutMs, ollama, groq } = env.ai;

export function aiEnabled() {
    if (provider === 'ollama') return true; // reachability checked at call time
    if (provider === 'groq') return Boolean(groq.apiKey);
    return false;
}

async function withTimeout(promiseFactory) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try { return await promiseFactory(ctrl.signal); }
    finally { clearTimeout(t); }
}

async function callOllama(prompt) {
    const res = await withTimeout((signal) => fetch(`${ollama.baseUrl}/api/generate`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: ollama.model, prompt, stream: false, options: { temperature: 0.3 } })
    }));
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = await res.json();
    return data?.response?.trim() || null;
}

async function callGroq(system, user, { json = false } = {}) {
    const res = await withTimeout((signal) => fetch(`${groq.baseUrl}/chat/completions`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groq.apiKey}` },
        body: JSON.stringify({
            model: groq.model, temperature: json ? 0 : 0.3,
            ...(json ? { response_format: { type: 'json_object' } } : {}),
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
        })
    }));
    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
}

async function callOllamaJson(prompt) {
    const res = await withTimeout((signal) => fetch(`${ollama.baseUrl}/api/generate`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: ollama.model, prompt, stream: false, format: 'json', options: { temperature: 0 } })
    }));
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = await res.json();
    return data?.response?.trim() || null;
}

const MODULES = ['Registration', 'OPD', 'Pharmacy', 'Laboratory', 'Radiology', 'Billing', 'Appointments', 'Reports/MIS', 'Login/Auth', 'Mobile App', 'Notifications', 'Other'];
const TECHNOLOGIES = ['UI_UX', 'BACKEND', 'DATABASE', 'MOBILE'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * Groq-analyzes a grievance about the MPSEDC HMIS application: which module + technology it
 * concerns, its priority and severity, and a one-line summary. The technology maps to the
 * developer specialty the ticket should route to. Best-effort — returns null when AI is off or on
 * any error, so the caller falls back to local routing.
 *
 * @param {{ description: string }} args
 * @returns {Promise<null | {module:string, technology:string, priority:string, severity:string, summary:string}>}
 */
export async function analyzeGrievance({ description }) {
    if (!aiEnabled() || !description?.trim()) return null;
    const system = 'You are a triage engineer for the MPSEDC-developed MP HMIS application. Respond with a strict JSON object only.';
    const user = `Analyze this grievance/issue about the HMIS software and classify it.

Choose exactly one module from: ${MODULES.join(', ')}
Choose exactly one technology from: ${TECHNOLOGIES.join(', ')}
  - UI_UX: screen layout, buttons, forms, display, styling, usability
  - BACKEND: server/API errors, business logic, integrations, timeouts, 500s
  - DATABASE: data wrong/missing, slow queries, reports, exports
  - MOBILE: the Android/iOS mobile app (crashes, login, app-only screens)
priority: LOW | MEDIUM | HIGH | URGENT (impact + urgency)
severity: LOW | MEDIUM | HIGH | CRITICAL (technical seriousness; CRITICAL = outage/data loss/security)

Return JSON exactly: {"module":"<module>","technology":"UI_UX|BACKEND|DATABASE|MOBILE","priority":"...","severity":"...","summary":"<one sentence, max 25 words>"}

Grievance: ${description}`;
    try {
        const raw = provider === 'groq' ? await callGroq(system, user, { json: true }) : await callOllamaJson(`${system}\n\n${user}`);
        if (!raw) return null;
        const match = raw.match(/\{[\s\S]*\}/);
        const out = JSON.parse(match ? match[0] : raw);
        const pick = (val, allowed, dflt) => (allowed.includes(String(val).toUpperCase()) ? String(val).toUpperCase() : dflt);
        return {
            module: MODULES.includes(out.module) ? out.module : 'Other',
            technology: TECHNOLOGIES.includes(String(out.technology).toUpperCase()) ? String(out.technology).toUpperCase() : null,
            priority: pick(out.priority, PRIORITIES, 'MEDIUM'),
            severity: pick(out.severity, SEVERITIES, 'MEDIUM'),
            summary: typeof out.summary === 'string' ? out.summary.trim().slice(0, 400) : null
        };
    } catch (err) {
        console.warn('[ai] analyzeGrievance failed:', err.message); // eslint-disable-line no-console
        return null;
    }
}

/**
 * Rewrites a rough grievance description into a clear, respectful, professional one.
 * @returns {Promise<string|null>}
 */
export async function rewriteText({ subject = '', text }) {
    if (!aiEnabled() || !text?.trim()) return null;
    const system = 'You rewrite rough hospital grievance descriptions into clear, respectful, professional text. You may respond in the same language as the input (English or Hindi).';
    const user = `Rewrite the grievance description below so it is clear, specific, and professional, in the same language it was written in.
Rules: keep it factual — do NOT invent details (names, dates, wards, amounts) that are not implied. 2-4 sentences. Return ONLY the rewritten text, no preamble or quotes.

Subject: ${subject || '(none)'}
Description: ${text}`;
    try {
        const out = provider === 'groq' ? await callGroq(system, user) : await callOllama(`${system}\n\n${user}`);
        return out ? out.replace(/^["']|["']$/g, '').trim() : null;
    } catch (err) {
        console.warn('[ai] rewrite failed:', err.message); // eslint-disable-line no-console
        return null;
    }
}
