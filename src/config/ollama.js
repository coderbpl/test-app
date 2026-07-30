import axios from 'axios';
import { env } from './env.js';

/**
 * Pre-configured axios client for the local Ollama server. All AI calls go through here so
 * the base URL and timeout live in one place. Nothing here reaches the public internet —
 * Ollama runs on the same host, which is exactly why it's safe for patient data.
 */
export const ollamaClient = axios.create({
    baseURL: env.ai.baseUrl,
    timeout: env.ai.timeoutMs,
    headers: { 'Content-Type': 'application/json' }
});

export const OLLAMA_MODEL = env.ai.model;
export const AI_ENABLED = env.ai.enabled;
