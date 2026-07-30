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

async function callGroq(system, user) {
    const res = await withTimeout((signal) => fetch(`${groq.baseUrl}/chat/completions`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groq.apiKey}` },
        body: JSON.stringify({ model: groq.model, temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
    }));
    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
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
