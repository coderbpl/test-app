import axios from 'axios';
import { env } from './env.js';

/**
 * Groq client (OpenAI-compatible chat completions). Used for ticket classification and drafting
 * suggested replies. NOTE: this is a cloud API — text sent here leaves your server. Similar-ticket
 * retrieval + agent routing is done locally and does not use this client.
 */
export const groqClient = axios.create({
    baseURL: env.ai.baseUrl,
    timeout: env.ai.timeoutMs,
    headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.ai.apiKey}`
    }
});

export const GROQ_MODEL = env.ai.model;
export const AI_ENABLED = env.ai.enabled;
