// Local lexical similarity (TF-cosine) — the ticket-routing engine. Fully on-server, no external
// service, which is the right default for a system that may touch patient information.

const STOP = new Set(('a an the and or but if then for to of in on at by with from is are was were be ' +
    'been being do does did have has had i you it we they me my your our their this that these those not no ' +
    'so as please hi hello dear regards thanks thank can could would should will may re fwd').split(/\s+/));

export function tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
}
export function toVector(tokens) {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    let sq = 0; for (const c of tf.values()) sq += c * c;
    return { tf, norm: Math.sqrt(sq) };
}
export function cosine(a, b) {
    if (!a.norm || !b.norm) return 0;
    const [small, large] = a.tf.size <= b.tf.size ? [a, b] : [b, a];
    let dot = 0;
    for (const [term, count] of small.tf) { const o = large.tf.get(term); if (o) dot += count * o; }
    return dot / (a.norm * b.norm);
}
