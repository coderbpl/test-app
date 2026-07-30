import bcrypt from 'bcryptjs';
import { db } from '../config/db.js';
import { env } from '../config/env.js';
import { migrate } from './migrate.js';
import { buildRefNo } from '../utils/refNo.js';

const CATEGORIES = [
    { code: 'BILLING', name: 'Billing & Refunds' },
    { code: 'TECHNICAL', name: 'Technical / Errors' },
    { code: 'ACCOUNT', name: 'Account & Login' },
    { code: 'SHIPPING', name: 'Shipping & Delivery' },
    { code: 'BUG', name: 'Bug Report' },
    { code: 'GENERAL', name: 'General' }
];

// Extra agents (besides the admin) with expertise, so routing has someone to route to.
const AGENTS = [
    { name: 'Priya Sharma', email: 'priya@helpdesk.local', skills: 'billing,refunds,invoice,payment' },
    { name: 'Arjun Mehta', email: 'arjun@helpdesk.local', skills: 'technical,login,error,crash,api' },
    { name: 'Neha Gupta', email: 'neha@helpdesk.local', skills: 'shipping,delivery,tracking,order' },
    { name: 'Rohit Verma', email: 'rohit@helpdesk.local', skills: 'account,password,email,profile' }
];

// Resolved history — this is what the recommendation engine learns from. Each is assigned to a
// specialist and carries a resolution, so a new similar ticket routes to the same person.
const SAMPLE_TICKETS = [
    { cat: 'BILLING', agent: 'priya@helpdesk.local', subject: 'Refund not received for cancelled order',
      body: 'I cancelled my order last week and was promised a refund but I still have not received the money back on my card.',
      resolution: 'Refund was stuck in the payment gateway. Re-initiated the refund; funds credited within 3-5 business days.' },
    { cat: 'BILLING', agent: 'priya@helpdesk.local', subject: 'Charged twice for the same invoice',
      body: 'My credit card was charged two times for invoice #4471. Please reverse the duplicate payment.',
      resolution: 'Confirmed duplicate charge, issued a reversal for the second transaction. Apologised for the inconvenience.' },
    { cat: 'ACCOUNT', agent: 'rohit@helpdesk.local', subject: 'Cannot reset my password',
      body: 'The password reset email never arrives. I have checked spam. I am locked out of my account.',
      resolution: 'Reset link was going to an old email. Updated the account email and sent a fresh reset link.' },
    { cat: 'ACCOUNT', agent: 'rohit@helpdesk.local', subject: 'Change the email address on my profile',
      body: 'I need to update the email associated with my account to a new address.',
      resolution: 'Verified identity and updated the profile email. Confirmation sent to the new address.' },
    { cat: 'TECHNICAL', agent: 'arjun@helpdesk.local', subject: 'App crashes on login',
      body: 'Every time I try to log in the mobile app crashes immediately with an error. Android 14.',
      resolution: 'Known crash on Android 14 fixed in app v3.2.1. Advised the user to update from the Play Store.' },
    { cat: 'TECHNICAL', agent: 'arjun@helpdesk.local', subject: 'API returns 500 error on checkout',
      body: 'When I call the checkout API I get a 500 internal server error intermittently.',
      resolution: 'Traced to a timeout in the payment service. Increased the timeout and added retry; issue resolved.' },
    { cat: 'SHIPPING', agent: 'neha@helpdesk.local', subject: 'Package not delivered, tracking stuck',
      body: 'My order shows shipped 6 days ago but the tracking has not updated and nothing has arrived.',
      resolution: 'Package was lost in transit. Reshipped with express delivery and shared new tracking.' },
    { cat: 'SHIPPING', agent: 'neha@helpdesk.local', subject: 'Wrong item delivered',
      body: 'I ordered a blue medium jacket but received a red large one. Need the correct item.',
      resolution: 'Arranged a free return pickup and dispatched the correct item on priority.' }
];

/** Seeds categories, agents, admin, and sample resolved tickets. Idempotent. */
export function seed() {
    migrate();

    const insCat = db.prepare('INSERT OR IGNORE INTO categories (code, name) VALUES (@code, @name)');
    db.transaction((rows) => rows.forEach((r) => insCat.run(r)))(CATEGORIES);

    const catId = (code) => db.prepare('SELECT id FROM categories WHERE code = ?').get(code)?.id ?? null;
    const agentId = (email) => db.prepare('SELECT id FROM agents WHERE email = ?').get(email)?.id ?? null;

    // Agents (only if none beyond admin exist)
    if (db.prepare('SELECT COUNT(*) AS n FROM agents').get().n === 0) {
        const hashAdmin = bcrypt.hashSync(env.admin.password, 10);
        db.prepare('INSERT INTO agents (name, email, password_hash, role, skills) VALUES (?, ?, ?, ?, ?)')
            .run(env.admin.name, env.admin.email.toLowerCase(), hashAdmin, 'admin', 'all');
        const hash = bcrypt.hashSync('agent123', 10);
        const insAgent = db.prepare('INSERT INTO agents (name, email, password_hash, role, skills) VALUES (?, ?, ?, ?, ?)');
        db.transaction((rows) => rows.forEach((a) => insAgent.run(a.name, a.email, hash, 'agent', a.skills)))(AGENTS);
        // eslint-disable-next-line no-console
        console.log(`[seed] Created admin (${env.admin.email}) + ${AGENTS.length} agents (password: agent123)`);
    }

    // Sample resolved tickets (only if no tickets yet)
    if (db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n === 0) {
        const insTicket = db.prepare(
            `INSERT INTO tickets (source, subject, body, requester_name, requester_email, category_id, priority,
                                  status, assigned_agent_id, resolution, resolved_at)
             VALUES ('EMAIL', @subject, @body, @rname, @remail, @catId, 'MEDIUM', 'RESOLVED', @agentId, @resolution,
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
        );
        const seedTickets = db.transaction((rows) => {
            rows.forEach((t, i) => {
                const info = insTicket.run({
                    subject: t.subject, body: t.body,
                    rname: 'Sample Customer', remail: `customer${i + 1}@example.com`,
                    catId: catId(t.cat), agentId: agentId(t.agent), resolution: t.resolution
                });
                const id = Number(info.lastInsertRowid);
                db.prepare('UPDATE tickets SET ref_no = ? WHERE id = ?').run(buildRefNo(id), id);
                db.prepare('INSERT INTO ticket_events (ticket_id, event_type, detail, actor_name) VALUES (?, ?, ?, ?)')
                    .run(id, 'CREATED', 'Seed ticket', 'seed');
            });
        });
        seedTickets(SAMPLE_TICKETS);
        // eslint-disable-next-line no-console
        console.log(`[seed] Inserted ${SAMPLE_TICKETS.length} resolved sample tickets (recommendation history)`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    seed();
    // eslint-disable-next-line no-console
    console.log('[seed] Done.');
    process.exit(0);
}

export default seed;
