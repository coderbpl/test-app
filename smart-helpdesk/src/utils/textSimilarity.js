/**
 * Local, dependency-free lexical similarity — the retrieval engine behind "similar tickets".
 * Tickets are turned into term-frequency vectors and compared with cosine similarity. This runs
 * entirely on the server (no embeddings API, no data egress) and is deterministic, which is why
 * it's the backbone of routing even when the Groq LLM is unavailable.
 */

const STOPWORDS = new Set(
    ('a an the and or but if then else for to of in on at by with without from is are was were be been ' +
     'being do does did have has had i you he she it we they me my your our their this that these those ' +
     'not no so as it s am pm please hi hello dear regards thanks thank you can cannot could would should ' +
     'will shall may might my me is was on off re fwd').split(/\s+/)
);

/**
 * Normalizes text to a list of meaningful tokens (lowercased, punctuation-stripped, stopwords and
 * very short tokens removed).
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
    if (!text) return [];
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Builds a term-frequency vector (Map) plus its L2 norm for cosine reuse.
 *
 * @param {string[]} tokens
 * @returns {{ tf: Map<string, number>, norm: number }}
 */
export function toVector(tokens) {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    let sq = 0;
    for (const c of tf.values()) sq += c * c;
    return { tf, norm: Math.sqrt(sq) };
}

/**
 * Cosine similarity between two vectors produced by {@link toVector}.
 *
 * @returns {number} 0..1
 */
export function cosine(a, b) {
    if (!a.norm || !b.norm) return 0;
    // Iterate the smaller map for the dot product.
    const [small, large] = a.tf.size <= b.tf.size ? [a, b] : [b, a];
    let dot = 0;
    for (const [term, count] of small.tf) {
        const other = large.tf.get(term);
        if (other) dot += count * other;
    }
    return dot / (a.norm * b.norm);
}

/**
 * Convenience: similarity between two raw strings, 0..1.
 */
export function similarity(textA, textB) {
    return cosine(toVector(tokenize(textA)), toVector(tokenize(textB)));
}
