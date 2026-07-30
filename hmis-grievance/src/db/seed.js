import bcrypt from 'bcryptjs';
import { db } from '../config/db.js';
import { env } from '../config/env.js';
import { migrate } from './migrate.js';
import { buildRef } from '../utils/index.js';

const CATEGORIES = [
    { code: 'OPD_WAIT',        name: 'Long OPD waiting time',          name_hi: 'ओपीडी में लंबा इंतजार',   pr: 'MEDIUM',   sla: 72 },
    { code: 'MEDICINE_STOCK',  name: 'Medicine not available',         name_hi: 'दवाई उपलब्ध नहीं',        pr: 'HIGH',     sla: 48 },
    { code: 'STAFF_BEHAVIOUR', name: 'Staff behaviour / misconduct',   name_hi: 'कर्मचारी का व्यवहार',      pr: 'HIGH',     sla: 48 },
    { code: 'CLEANLINESS',     name: 'Cleanliness / hygiene',          name_hi: 'साफ-सफाई',                pr: 'MEDIUM',   sla: 72 },
    { code: 'BILLING',         name: 'Billing / overcharging',         name_hi: 'बिलिंग / अधिक शुल्क',      pr: 'HIGH',     sla: 48 },
    { code: 'DIAGNOSTICS',     name: 'Diagnostics / lab / radiology',  name_hi: 'जांच / लैब / रेडियोलॉजी',  pr: 'MEDIUM',   sla: 72 },
    { code: 'DENIAL_OF_CARE',  name: 'Denial or delay of treatment',   name_hi: 'इलाज से इनकार या देरी',    pr: 'CRITICAL', sla: 12 },
    { code: 'AMBULANCE',       name: 'Ambulance / referral transport', name_hi: 'एम्बुलेंस / रेफरल परिवहन', pr: 'CRITICAL', sla: 12 },
    { code: 'CORRUPTION',      name: 'Bribery / corruption',           name_hi: 'रिश्वत / भ्रष्टाचार',      pr: 'CRITICAL', sla: 24 },
    { code: 'OTHER',           name: 'Other',                          name_hi: 'अन्य',                    pr: 'LOW',      sla: 120 }
];

const STAFF = [
    { name: 'Dr. Sunita Rao', name_hi: 'डॉ. सुनीता राव', email: 'sunita@mphmis.local', role: 'officer', dept: 'Administration', tier: 'DISTRICT', skills: '' },
    { name: 'Anil Kumar',     name_hi: 'अनिल कुमार',     email: 'anil@mphmis.local',   role: 'officer', dept: 'Grievance Cell', tier: 'FACILITY', skills: '' },
    { name: 'Ramesh Iyer',    name_hi: 'रमेश अय्यर',     email: 'ramesh@mphmis.local', role: 'agent',   dept: 'IT',            tier: 'FACILITY', skills: 'it,network,login,system,software,printer,hmis' },
    { name: 'Kavita Nair',    name_hi: 'कविता नायर',     email: 'kavita@mphmis.local', role: 'agent',   dept: 'Biomedical',    tier: 'FACILITY', skills: 'biomedical,equipment,monitor,ventilator,device,icu' },
    { name: 'Suresh Patel',   name_hi: 'सुरेश पटेल',     email: 'suresh@mphmis.local', role: 'agent',   dept: 'Facility',      tier: 'FACILITY', skills: 'facility,electrical,plumbing,ac,building,power' },
    { name: 'Meena Verma',    name_hi: 'मीना वर्मा',     email: 'meena@mphmis.local',  role: 'agent',   dept: 'Housekeeping',  tier: 'FACILITY', skills: 'housekeeping,cleaning,waste,sanitation,washroom' }
];

const TICKETS = [
    { cat: 'IT', agent: 'ramesh@mphmis.local', subject: 'Cannot log into HMIS, password not working', body: 'The HMIS login rejects my password at the registration counter, staff locked out.', res: 'Reset the account password and cleared the browser cache; login restored.' },
    { cat: 'IT', agent: 'ramesh@mphmis.local', subject: 'Printer at registration not connecting to network', body: 'The token printer at OPD registration is not printing, shows offline on the network.', res: 'Reassigned the printer IP and reinstalled the driver; printing works.' },
    { cat: 'BIOMEDICAL', agent: 'kavita@mphmis.local', subject: 'Patient monitor in ICU showing error', body: 'The bedside patient monitor in ICU bed 3 shows a sensor error and no reading.', res: 'Replaced the faulty SpO2 sensor cable; monitor reads correctly.' },
    { cat: 'BIOMEDICAL', agent: 'kavita@mphmis.local', subject: 'Ventilator alarm keeps going off', body: 'The ventilator in ICU keeps raising a low-pressure alarm intermittently.', res: 'Found a loose circuit connection; reseated and calibrated the ventilator.' },
    { cat: 'FACILITY', agent: 'suresh@mphmis.local', subject: 'AC not working in OPD ward', body: 'The air conditioning in the OPD waiting area has stopped, patients uncomfortable.', res: 'Compressor tripped; reset the unit and topped up gas, cooling restored.' },
    { cat: 'HOUSEKEEPING', agent: 'meena@mphmis.local', subject: 'Washroom on 2nd floor not cleaned', body: 'The patient washroom on the second floor has not been cleaned since morning.', res: 'Deployed housekeeping immediately and added it to the hourly cleaning roster.' }
];

const FEEDBACK = [
    { dept: 'OPD', overall: 4, staff: 5, clean: 4, wait: 3, rec: 1, comment: 'Doctor was very helpful, but waiting was long.' },
    { dept: 'Pharmacy', overall: 5, staff: 5, clean: 5, wait: 5, rec: 1, comment: 'Quick and polite.' },
    { dept: 'Laboratory', overall: 3, staff: 3, clean: 4, wait: 2, rec: 1, comment: 'Report took longer than told.' },
    { dept: 'OPD', overall: 2, staff: 2, clean: 3, wait: 1, rec: 0, comment: 'Very crowded, staff rushed.' },
    { dept: 'Emergency', overall: 5, staff: 5, clean: 4, wait: 4, rec: 1, comment: 'Fast emergency response, thankful.' }
];

export function seed() {
    migrate();

    const insCat = db.prepare('INSERT OR IGNORE INTO grievance_categories (code, name, name_hi, default_priority, sla_hours) VALUES (@code, @name, @name_hi, @pr, @sla)');
    db.transaction((rows) => rows.forEach((r) => insCat.run(r)))(CATEGORIES);

    if (db.prepare('SELECT COUNT(*) AS n FROM staff').get().n === 0) {
        db.prepare('INSERT INTO staff (name, email, password_hash, role, department, tier, skills) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(env.admin.name, env.admin.email.toLowerCase(), bcrypt.hashSync(env.admin.password, 10), 'admin', 'Administration', 'STATE', 'all');
        const h = bcrypt.hashSync('staff123', 10);
        const ins = db.prepare('INSERT INTO staff (name, name_hi, email, password_hash, role, department, tier, skills) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        db.transaction((rows) => rows.forEach((s) => ins.run(s.name, s.name_hi, s.email, h, s.role, s.dept, s.tier, s.skills)))(STAFF);
        console.log(`[seed] admin (${env.admin.email}) + ${STAFF.length} staff (password: staff123)`); // eslint-disable-line no-console
    }

    const staffId = (email) => db.prepare('SELECT id FROM staff WHERE email = ?').get(email)?.id ?? null;

    if (db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n === 0) {
        const insT = db.prepare(
            `INSERT INTO tickets (subject, body, category, facility, status, assigned_staff_id, resolution, resolved_at)
             VALUES (@subject, @body, @cat, 'District Hospital · Bhopal', 'RESOLVED', @agentId, @res, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
        );
        db.transaction((rows) => rows.forEach((t) => {
            const info = insT.run({ subject: t.subject, body: t.body, cat: t.cat, agentId: staffId(t.agent), res: t.res });
            const id = Number(info.lastInsertRowid);
            db.prepare('UPDATE tickets SET ref_no = ? WHERE id = ?').run(buildRef('TKT', id), id);
            db.prepare('INSERT INTO ticket_events (ticket_id, event_type, detail, actor_name) VALUES (?, ?, ?, ?)').run(id, 'CREATED', 'Seed ticket', 'seed');
        }))(TICKETS);
        console.log(`[seed] ${TICKETS.length} resolved sample tickets (routing history)`); // eslint-disable-line no-console
    }

    if (db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n === 0) {
        const insF = db.prepare(
            `INSERT INTO feedback (facility, department, rating_overall, rating_staff, rating_cleanliness, rating_waiting, would_recommend, comment, is_anonymous)
             VALUES ('District Hospital · Bhopal', @dept, @overall, @staff, @clean, @wait, @rec, @comment, 1)`
        );
        db.transaction((rows) => rows.forEach((f) => {
            const info = insF.run(f);
            db.prepare('UPDATE feedback SET ref_no = ? WHERE id = ?').run(buildRef('FBK', Number(info.lastInsertRowid)), Number(info.lastInsertRowid));
        }))(FEEDBACK);
        console.log(`[seed] ${FEEDBACK.length} sample feedback entries`); // eslint-disable-line no-console
    }
}

if (import.meta.url === `file://${process.argv[1]}`) { seed(); console.log('[seed] Done.'); process.exit(0); } // eslint-disable-line no-console
export default seed;
