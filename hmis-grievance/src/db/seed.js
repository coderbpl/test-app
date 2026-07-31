import bcrypt from 'bcryptjs';
import { db } from '../config/db.js';
import { env } from '../config/env.js';
import { migrate } from './migrate.js';
import { buildRef } from '../utils/index.js';

const CATEGORIES = [
    { code: 'OPD_WAIT',        name: 'Long OPD waiting time',          name_hi: 'ओपीडी में लंबा इंतजार',   pr: 'MEDIUM' },
    { code: 'MEDICINE_STOCK',  name: 'Medicine not available',         name_hi: 'दवाई उपलब्ध नहीं',        pr: 'HIGH' },
    { code: 'STAFF_BEHAVIOUR', name: 'Staff behaviour / misconduct',   name_hi: 'कर्मचारी का व्यवहार',      pr: 'HIGH' },
    { code: 'CLEANLINESS',     name: 'Cleanliness / hygiene',          name_hi: 'साफ-सफाई',                pr: 'MEDIUM' },
    { code: 'BILLING',         name: 'Billing / overcharging',         name_hi: 'बिलिंग / अधिक शुल्क',      pr: 'HIGH' },
    { code: 'DIAGNOSTICS',     name: 'Diagnostics / lab / radiology',  name_hi: 'जांच / लैब / रेडियोलॉजी',  pr: 'MEDIUM' },
    { code: 'DENIAL_OF_CARE',  name: 'Denial or delay of treatment',   name_hi: 'इलाज से इनकार या देरी',    pr: 'CRITICAL' },
    { code: 'AMBULANCE',       name: 'Ambulance / referral transport', name_hi: 'एम्बुलेंस / रेफरल परिवहन', pr: 'CRITICAL' },
    { code: 'CORRUPTION',      name: 'Bribery / corruption',           name_hi: 'रिश्वत / भ्रष्टाचार',      pr: 'CRITICAL' },
    { code: 'OTHER',           name: 'Other',                          name_hi: 'अन्य',                    pr: 'LOW' }
];

const HOSPITALS = [
    { name: 'Hamidia Hospital, Bhopal',        name_hi: 'हमीदिया अस्पताल, भोपाल',           district: 'Bhopal',   type: 'MC' },
    { name: 'JP District Hospital, Bhopal',    name_hi: 'जेपी जिला अस्पताल, भोपाल',          district: 'Bhopal',   type: 'DH' },
    { name: 'Gandhi Medical College, Bhopal',  name_hi: 'गांधी चिकित्सा महाविद्यालय, भोपाल', district: 'Bhopal',   type: 'MC' },
    { name: 'District Hospital, Indore',       name_hi: 'जिला अस्पताल, इंदौर',               district: 'Indore',   type: 'DH' },
    { name: 'MY Hospital, Indore',             name_hi: 'एमवाय अस्पताल, इंदौर',              district: 'Indore',   type: 'MC' },
    { name: 'District Hospital, Gwalior',      name_hi: 'जिला अस्पताल, ग्वालियर',            district: 'Gwalior',  type: 'DH' },
    { name: 'District Hospital, Jabalpur',     name_hi: 'जिला अस्पताल, जबलपुर',              district: 'Jabalpur', type: 'DH' },
    { name: 'CHC Bairagarh, Bhopal',           name_hi: 'सीएचसी बैरागढ़, भोपाल',             district: 'Bhopal',   type: 'CHC' }
];

// Grievance officers (handle citizen complaints).
const OFFICERS = [
    { name: 'Dr. Sunita Rao', name_hi: 'डॉ. सुनीता राव', email: 'sunita@mphmis.local', dept: 'Administration', tier: 'DISTRICT' },
    { name: 'Anil Kumar',     name_hi: 'अनिल कुमार',     email: 'anil@mphmis.local',   dept: 'Grievance Cell', tier: 'FACILITY' }
];

// Ticket team — the OIC → PM → TL → Developer hierarchy. Tickets auto-route to a DEVELOPER by
// the ticket description (skills + similarity to past resolved tickets).
const TEAM = [
    { name: 'Rakesh Sharma', name_hi: 'राकेश शर्मा', email: 'oic@mphmis.local', grade: 'OIC', dept: 'IT Cell',  skills: 'oversight,approval' },
    { name: 'Priya Menon',   name_hi: 'प्रिया मेनन', email: 'pm@mphmis.local',  grade: 'PM',  dept: 'IT Cell',  skills: 'planning,coordination' },
    { name: 'Arjun Rao',     name_hi: 'अर्जुन राव',  email: 'tl.backend@mphmis.local',  grade: 'TL', dept: 'Backend',  skills: 'backend,api,server,integration' },
    { name: 'Sneha Iyer',    name_hi: 'स्नेहा अय्यर', email: 'tl.frontend@mphmis.local', grade: 'TL', dept: 'Frontend', skills: 'frontend,ui,ux' },
    { name: 'Vikram Singh',  name_hi: 'विक्रम सिंह', email: 'vikram@mphmis.local', grade: 'DEVELOPER', dept: 'Backend',  skills: 'backend,api,server,node,integration,error,500,save' },
    { name: 'Neha Kapoor',   name_hi: 'नेहा कपूर',   email: 'neha@mphmis.local',   grade: 'DEVELOPER', dept: 'Frontend', skills: 'frontend,ui,ux,react,layout,css,display,dashboard' },
    { name: 'Amit Joshi',    name_hi: 'अमित जोशी',   email: 'amit@mphmis.local',   grade: 'DEVELOPER', dept: 'Database', skills: 'database,sql,query,performance,slow,report,timeout' },
    { name: 'Ravi Verma',    name_hi: 'रवि वर्मा',   email: 'ravi@mphmis.local',   grade: 'DEVELOPER', dept: 'DevOps',   skills: 'devops,deployment,build,pipeline,infra,server,release' },
    { name: 'Pooja Nair',    name_hi: 'पूजा नायर',   email: 'pooja@mphmis.local',  grade: 'DEVELOPER', dept: 'Mobile',   skills: 'mobile,android,app,login,crash,ios' }
];

// Resolved dev tickets — the routing history each new ticket is matched against.
const TICKETS = [
    { cat: 'API',        agent: 'vikram@mphmis.local', subject: 'API returns 500 error when saving patient record', body: 'The patient save API intermittently returns a 500 internal server error on submit.', res: 'Null check added on the payment reference; 500 resolved.' },
    { cat: 'DATABASE',   agent: 'amit@mphmis.local',   subject: 'Reports page very slow, query times out', body: 'The MIS reports page takes over a minute and the database query times out under load.', res: 'Added an index on visit_date and rewrote the aggregate query; report loads in 2s.' },
    { cat: 'UI_UX',      agent: 'neha@mphmis.local',   subject: 'Dashboard layout broken on tablet, cards overlap', body: 'On tablet width the dashboard cards overlap and the CSS grid breaks.', res: 'Fixed the responsive grid breakpoints; layout correct on tablet and mobile.' },
    { cat: 'DEPLOYMENT', agent: 'ravi@mphmis.local',   subject: 'Deployment pipeline failing at build step', body: 'The CI/CD deployment pipeline fails during the build with a dependency error.', res: 'Pinned the failing package version and cleared the build cache; pipeline green.' },
    { cat: 'BUG',        agent: 'pooja@mphmis.local',  subject: 'Mobile app crashes on login for Android users', body: 'The Android app crashes immediately on login for several users.', res: 'Fixed a null token crash on Android 14; released app v3.2.1.' },
    { cat: 'API',        agent: 'vikram@mphmis.local', subject: 'Lab system integration returns error', body: 'The integration with the external lab system returns an error and results do not sync.', res: 'Renewed the integration API token and added retry; sync restored.' }
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

    const insCat = db.prepare('INSERT OR IGNORE INTO grievance_categories (code, name, name_hi, default_priority) VALUES (@code, @name, @name_hi, @pr)');
    db.transaction((rows) => rows.forEach((r) => insCat.run(r)))(CATEGORIES);

    if (db.prepare('SELECT COUNT(*) AS n FROM hospitals').get().n === 0) {
        const insH = db.prepare('INSERT INTO hospitals (name, name_hi, district, type) VALUES (@name, @name_hi, @district, @type)');
        db.transaction((rows) => rows.forEach((h) => insH.run(h)))(HOSPITALS);
        console.log(`[seed] ${HOSPITALS.length} hospitals`); // eslint-disable-line no-console
    }

    const staffId = (email) => db.prepare('SELECT id FROM staff WHERE email = ?').get(email)?.id ?? null;

    if (db.prepare('SELECT COUNT(*) AS n FROM staff').get().n === 0) {
        db.prepare('INSERT INTO staff (name, email, password_hash, role, department, tier, skills) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(env.admin.name, env.admin.email.toLowerCase(), bcrypt.hashSync(env.admin.password, 10), 'admin', 'Administration', 'STATE', 'all');
        const h = bcrypt.hashSync('staff123', 10);
        const insOfficer = db.prepare('INSERT INTO staff (name, name_hi, email, password_hash, role, department, tier) VALUES (?, ?, ?, ?, ?, ?, ?)');
        db.transaction((rows) => rows.forEach((s) => insOfficer.run(s.name, s.name_hi, s.email, h, 'officer', s.dept, s.tier)))(OFFICERS);
        const insTeam = db.prepare('INSERT INTO staff (name, name_hi, email, password_hash, role, department, tier, skills, grade) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        db.transaction((rows) => rows.forEach((s) => insTeam.run(s.name, s.name_hi, s.email, h, 'agent', s.dept, 'FACILITY', s.skills, s.grade)))(TEAM);
        console.log(`[seed] admin + ${OFFICERS.length} officers + ${TEAM.length} ticket-team (OIC/PM/TL/Developers) (password: staff123)`); // eslint-disable-line no-console
    }

    if (db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n === 0) {
        const insT = db.prepare(
            `INSERT INTO tickets (subject, body, category, facility, status, assigned_staff_id, resolution, resolved_at)
             VALUES (@subject, @body, @cat, 'MP HMIS Platform', 'RESOLVED', @agentId, @res, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
        );
        db.transaction((rows) => rows.forEach((t) => {
            const info = insT.run({ subject: t.subject, body: t.body, cat: t.cat, agentId: staffId(t.agent), res: t.res });
            const id = Number(info.lastInsertRowid);
            db.prepare('UPDATE tickets SET ref_no = ? WHERE id = ?').run(buildRef('TKT', id), id);
            db.prepare('INSERT INTO ticket_events (ticket_id, event_type, detail, actor_name) VALUES (?, ?, ?, ?)').run(id, 'CREATED', 'Seed ticket', 'seed');
        }))(TICKETS);
        console.log(`[seed] ${TICKETS.length} resolved dev tickets (routing history)`); // eslint-disable-line no-console
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
