import bcrypt from 'bcryptjs';
import { db } from '../config/db.js';
import { env } from '../config/env.js';
import { migrate } from './migrate.js';

const CATEGORIES = [
    { code: 'OPD_WAIT',        name: 'Long OPD waiting time',          name_hi: 'ओपीडी में लंबा इंतजार',   priority: 'MEDIUM',   sla: 72 },
    { code: 'MEDICINE_STOCK',  name: 'Medicine not available',         name_hi: 'दवाई उपलब्ध नहीं',        priority: 'HIGH',     sla: 48 },
    { code: 'STAFF_BEHAVIOUR', name: 'Staff behaviour / misconduct',   name_hi: 'कर्मचारी का व्यवहार',      priority: 'HIGH',     sla: 48 },
    { code: 'CLEANLINESS',     name: 'Cleanliness / hygiene',          name_hi: 'साफ-सफाई',                priority: 'MEDIUM',   sla: 72 },
    { code: 'BILLING',         name: 'Billing / overcharging',         name_hi: 'बिलिंग / अधिक शुल्क',      priority: 'HIGH',     sla: 48 },
    { code: 'DIAGNOSTICS',     name: 'Diagnostics / lab / radiology',  name_hi: 'जांच / लैब / रेडियोलॉजी',  priority: 'MEDIUM',   sla: 72 },
    { code: 'DENIAL_OF_CARE',  name: 'Denial or delay of treatment',   name_hi: 'इलाज से इनकार या देरी',    priority: 'CRITICAL', sla: 12 },
    { code: 'INFRASTRUCTURE',  name: 'Infrastructure / equipment',     name_hi: 'ढांचा / उपकरण',           priority: 'MEDIUM',   sla: 96 },
    { code: 'AMBULANCE',       name: 'Ambulance / referral transport', name_hi: 'एम्बुलेंस / रेफरल परिवहन', priority: 'CRITICAL', sla: 12 },
    { code: 'CORRUPTION',      name: 'Bribery / corruption',           name_hi: 'रिश्वत / भ्रष्टाचार',      priority: 'CRITICAL', sla: 24 },
    { code: 'OTHER',           name: 'Other',                          name_hi: 'अन्य',                    priority: 'LOW',      sla: 120 }
];

/**
 * Seeds category master data and the initial admin officer. Idempotent — inserts only what's
 * missing, so it's safe to run on every startup.
 */
export function seed() {
    migrate();

    const insertCategory = db.prepare(
        `INSERT OR IGNORE INTO categories (code, name, name_hi, default_priority, sla_hours)
         VALUES (@code, @name, @name_hi, @priority, @sla)`
    );
    const seedCategories = db.transaction((rows) => {
        for (const row of rows) insertCategory.run(row);
    });
    seedCategories(CATEGORIES);

    // Create the admin officer only if no officers exist yet (first boot).
    const officerCount = db.prepare('SELECT COUNT(*) AS n FROM officers').get().n;
    if (officerCount === 0) {
        const hash = bcrypt.hashSync(env.admin.password, 10);
        db.prepare(
            `INSERT INTO officers (name, email, password_hash, tier, role)
             VALUES (?, ?, ?, 'STATE', 'admin')`
        ).run(env.admin.name, env.admin.email.toLowerCase(), hash);
        // eslint-disable-next-line no-console
        console.log(`[seed] Admin officer created: ${env.admin.email}`);
    }
}

// Allow `npm run seed` to run this file directly.
if (import.meta.url === `file://${process.argv[1]}`) {
    seed();
    // eslint-disable-next-line no-console
    console.log('[seed] Done.');
    process.exit(0);
}

export default seed;
