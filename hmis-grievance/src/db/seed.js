import bcrypt from 'bcryptjs';
import { db } from '../config/db.js';
import { env } from '../config/env.js';
import { migrate } from './migrate.js';
import { buildRef } from '../utils/index.js';

const HOSPITALS = [
    { name: 'Hamidia Hospital, Bhopal',        name_hi: 'हमीदिया अस्पताल, भोपाल',           district: 'Bhopal',   type: 'MC' },
    { name: 'JP District Hospital, Bhopal',    name_hi: 'जेपी जिला अस्पताल, भोपाल',          district: 'Bhopal',   type: 'DH' },
    { name: 'Gandhi Medical College, Bhopal',  name_hi: 'गांधी चिकित्सा महाविद्यालय, भोपाल', district: 'Bhopal',   type: 'MC' },
    { name: 'District Hospital, Indore',       name_hi: 'जिला अस्पताल, इंदौर',               district: 'Indore',   type: 'DH' },
    { name: 'MY Hospital, Indore',             name_hi: 'एमवाय अस्पताल, इंदौर',              district: 'Indore',   type: 'MC' },
    { name: 'District Hospital, Gwalior',      name_hi: 'जिला अस्पताल, ग्वालियर',            district: 'Gwalior',  type: 'DH' },
    { name: 'District Hospital, Jabalpur',     name_hi: 'जिला अस्पताल, जबलपुर',              district: 'Jabalpur', type: 'DH' }
];

// MPSEDC HMIS support team — OIC / PM / Technical Lead + developers by specialty.
const TEAM = [
    { name: 'Rakesh Sharma', name_hi: 'राकेश शर्मा', email: 'oic@mphmis.local', grade: 'OIC', specialty: null,       dept: 'MPSEDC',   skills: 'oversight,approval' },
    { name: 'Priya Menon',   name_hi: 'प्रिया मेनन', email: 'pm@mphmis.local',  grade: 'PM',  specialty: null,       dept: 'MPSEDC',   skills: 'planning,coordination' },
    { name: 'Arjun Rao',     name_hi: 'अर्जुन राव',  email: 'tl@mphmis.local',  grade: 'TL',  specialty: null,       dept: 'Technical', skills: 'architecture,review,api,ui,database,mobile' },
    { name: 'Neha Kapoor',   name_hi: 'नेहा कपूर',   email: 'neha@mphmis.local',   grade: 'DEVELOPER', specialty: 'UI_UX',    dept: 'UI/UX',    skills: 'ui,ux,layout,css,form,button,display,screen,alignment,responsive' },
    { name: 'Vikram Singh',  name_hi: 'विक्रम सिंह', email: 'vikram@mphmis.local', grade: 'DEVELOPER', specialty: 'BACKEND',  dept: 'Backend',  skills: 'backend,api,server,500,error,integration,timeout,logic,token' },
    { name: 'Ravi Verma',    name_hi: 'रवि वर्मा',   email: 'ravi@mphmis.local',   grade: 'DEVELOPER', specialty: 'BACKEND',  dept: 'Backend',  skills: 'backend,api,service,sync,integration,error' },
    { name: 'Amit Joshi',    name_hi: 'अमित जोशी',   email: 'amit@mphmis.local',   grade: 'DEVELOPER', specialty: 'DATABASE', dept: 'Database', skills: 'database,sql,query,report,export,data,slow,index' },
    { name: 'Pooja Nair',    name_hi: 'पूजा नायर',   email: 'pooja@mphmis.local',  grade: 'DEVELOPER', specialty: 'MOBILE',   dept: 'Mobile',   skills: 'mobile,android,ios,app,crash,login,apk' }
];

// Resolved HMIS grievances — routing history AND the source of "suggested resolutions" shown
// to citizens as they type. Each carries the module/technology/root-cause it was solved under.
const TICKETS = [
    { mod: 'Registration', tech: 'UI_UX',    dev: 'neha@mphmis.local',   sev: 'LOW',
      subject: 'Login/Save button misaligned on the registration screen',
      body: 'The Save button on the patient registration form is misaligned and overlaps the field on smaller screens.',
      root: 'CSS flex container missing wrap; button pushed out of the row.',
      res: 'Fixed the flex alignment and added responsive wrapping on the registration form; the button is now aligned on all screen sizes.' },
    { mod: 'OPD', tech: 'BACKEND', dev: 'vikram@mphmis.local', sev: 'HIGH',
      subject: 'OPD token generation API returns 500 error on submit',
      body: 'Generating an OPD token intermittently returns a 500 internal server error when the department is selected.',
      root: 'Null department id reached the token service and threw an unhandled exception.',
      res: 'Added a null-check and validation on the department id in the token API and a clear error message; 500 resolved.' },
    { mod: 'Reports/MIS', tech: 'DATABASE', dev: 'amit@mphmis.local', sev: 'MEDIUM',
      subject: 'MIS report export is very slow and times out',
      body: 'Exporting the daily MIS report takes over a minute and the database query times out under load.',
      root: 'Full table scan on an unindexed visit_date column plus a large un-paginated export.',
      res: 'Added an index on visit_date and paginated the export; the report now loads in ~2 seconds.' },
    { mod: 'Mobile App', tech: 'MOBILE', dev: 'pooja@mphmis.local', sev: 'HIGH',
      subject: 'Mobile app crashes on login for Android 14 users',
      body: 'The Android app crashes immediately on login for several users on Android 14.',
      root: 'Null auth-token dereference in the login flow on Android 14.',
      res: 'Fixed the null-token crash on Android 14 and released app v3.2.1 on the Play Store.' },
    { mod: 'Pharmacy', tech: 'BACKEND', dev: 'ravi@mphmis.local', sev: 'HIGH',
      subject: 'Pharmacy stock sync integration failing',
      body: 'The pharmacy stock sync with the central supply system is failing and stock counts are stale.',
      root: 'Expired integration API token and no retry on transient failures.',
      res: 'Renewed the integration token and added automatic retry with backoff; stock sync restored.' },
    { mod: 'Appointments', tech: 'UI_UX', dev: 'neha@mphmis.local', sev: 'LOW',
      subject: 'Patient name field overlaps date field on tablet view',
      body: 'On tablet width the patient name and appointment date fields overlap on the booking screen.',
      root: 'Fixed-width columns not adapting at the tablet breakpoint.',
      res: 'Corrected the responsive grid breakpoints; the booking form lays out correctly on tablet and mobile.' }
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

    if (db.prepare('SELECT COUNT(*) AS n FROM hospitals').get().n === 0) {
        const insH = db.prepare('INSERT INTO hospitals (name, name_hi, district, type) VALUES (@name, @name_hi, @district, @type)');
        db.transaction((rows) => rows.forEach((x) => insH.run(x)))(HOSPITALS);
        console.log(`[seed] ${HOSPITALS.length} hospitals`); // eslint-disable-line no-console
    }

    const staffId = (email) => db.prepare('SELECT id FROM staff WHERE email = ?').get(email)?.id ?? null;

    // Reconcile staff on EVERY boot (idempotent): add missing team members and keep grade/
    // specialty/password current, so the documented logins always work — even on a database that
    // was seeded before the MPSEDC team existed.
    const adminEmail = env.admin.email.toLowerCase();
    if (!db.prepare('SELECT 1 FROM staff WHERE email = ?').get(adminEmail)) {
        db.prepare('INSERT INTO staff (name, email, password_hash, role, department, tier, skills) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(env.admin.name, adminEmail, bcrypt.hashSync(env.admin.password, 10), 'admin', 'MPSEDC', 'STATE', 'all');
    }
    const h = bcrypt.hashSync('staff123', 10);
    let added = 0;
    db.transaction((rows) => rows.forEach((s) => {
        const existing = db.prepare('SELECT id FROM staff WHERE email = ?').get(s.email);
        if (existing) {
            db.prepare('UPDATE staff SET name=?, name_hi=?, password_hash=?, role=?, department=?, grade=?, specialty=?, skills=?, status=1 WHERE email=?')
                .run(s.name, s.name_hi, h, 'agent', s.dept, s.grade, s.specialty, s.skills, s.email);
        } else {
            db.prepare('INSERT INTO staff (name, name_hi, email, password_hash, role, department, tier, skills, grade, specialty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .run(s.name, s.name_hi, s.email, h, 'agent', s.dept, 'FACILITY', s.skills, s.grade, s.specialty);
            added += 1;
        }
    }))(TEAM);
    if (added) console.log(`[seed] reconciled MPSEDC team — added ${added} member(s) (password: staff123)`); // eslint-disable-line no-console

    if (db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n === 0) {
        const insT = db.prepare(
            `INSERT INTO tickets (subject, body, category, source, module, technology, severity, status, assigned_staff_id, root_cause, resolution, resolved_at)
             VALUES (@subject, @body, 'GRIEVANCE', 'WEB', @mod, @tech, @sev, 'RESOLVED', @devId, @root, @res, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
        );
        db.transaction((rows) => rows.forEach((t) => {
            const info = insT.run({ subject: t.subject, body: t.body, mod: t.mod, tech: t.tech, sev: t.sev, devId: staffId(t.dev), root: t.root, res: t.res });
            const id = Number(info.lastInsertRowid);
            db.prepare('UPDATE tickets SET ref_no = ? WHERE id = ?').run(buildRef('TKT', id), id);
            db.prepare('INSERT INTO ticket_events (ticket_id, event_type, detail, actor_name) VALUES (?, ?, ?, ?)').run(id, 'CREATED', 'Seed grievance', 'seed');
        }))(TICKETS);
        console.log(`[seed] ${TICKETS.length} resolved HMIS grievances (routing history + suggestions)`); // eslint-disable-line no-console
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
