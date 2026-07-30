import cron from 'node-cron';
import { env } from '../config/env.js';
import { ingestEmail } from '../modules/tickets/ticket.service.js';

/**
 * Polls an IMAP mailbox for unseen messages and turns each into a ticket (or threads it onto an
 * existing one). imapflow + mailparser are imported lazily so the app runs fine when polling is off.
 *
 * @returns {Promise<number>} Number of messages ingested.
 */
export async function pollOnce() {
    if (!env.email.host || !env.email.user || !env.email.password) {
        console.warn('[email] IMAP not configured (IMAP_HOST/USER/PASSWORD) — skipping poll.'); // eslint-disable-line no-console
        return 0;
    }
    const { ImapFlow } = await import('imapflow');
    const { simpleParser } = await import('mailparser');

    const client = new ImapFlow({
        host: env.email.host,
        port: env.email.port,
        secure: env.email.port === 993,
        auth: { user: env.email.user, pass: env.email.password },
        logger: false
    });

    let count = 0;
    await client.connect();
    const lock = await client.getMailboxLock(env.email.mailbox);
    try {
        for await (const msg of client.fetch({ seen: false }, { source: true })) {
            const parsed = await simpleParser(msg.source);
            const fromAddr = parsed.from?.value?.[0] || {};
            const result = ingestEmail({
                from: fromAddr.address || 'unknown@unknown',
                fromName: fromAddr.name || '',
                subject: parsed.subject || '(no subject)',
                text: (parsed.text || parsed.html || '').toString().slice(0, 20000),
                messageId: parsed.messageId || null,
                inReplyTo: parsed.inReplyTo || null
            });
            await client.messageFlagsAdd(msg.seq, ['\\Seen']);
            count += 1;
            // eslint-disable-next-line no-console
            console.log(`[email] ${result.created ? 'Created' : 'Threaded'} ${result.ticket.refNo} from ${fromAddr.address}`);
        }
    } finally {
        lock.release();
        await client.logout();
    }
    return count;
}

/**
 * Schedules the IMAP poll if enabled.
 */
export function startEmailPoll() {
    if (!env.email.pollEnabled) return null;
    if (!cron.validate(env.email.cron)) {
        console.warn(`[email] Invalid EMAIL_POLL_CRON "${env.email.cron}" — polling OFF.`); // eslint-disable-line no-console
        return null;
    }
    // eslint-disable-next-line no-console
    console.log(`[email] IMAP polling scheduled: "${env.email.cron}" (${env.email.user}@${env.email.host})`);
    return cron.schedule(env.email.cron, () => pollOnce().catch((e) => console.error('[email] poll error:', e.message))); // eslint-disable-line no-console
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { seed } = await import('../db/seed.js');
    seed();
    const n = await pollOnce();
    // eslint-disable-next-line no-console
    console.log(`[email] One-off poll ingested ${n} message(s).`);
    process.exit(0);
}
