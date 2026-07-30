# MP HMIS — Grievance, Feedback & Ticketing

A single, standalone system for a government hospital that unifies **three** things patients and
staff actually need, in the **Madhya Pradesh HMIS design language** (navy/blue/amber, bilingual
Hindi+English, fixed left tab-rail console):

1. **Grievance handling** — patients file complaints (bilingual, anonymous option); each is
   prioritized, given an SLA, tracked on a timeline, assigned, and **auto-escalated up the
   governance ladder** (Facility → District → Division → State) when overdue.
2. **Patient feedback** — a star-rating survey (overall, staff, cleanliness, waiting) with
   department analytics. **A poor rating (≤2) automatically opens a linked grievance** so it gets
   followed up — a closed loop, not a dead-end survey.
3. **Internal ticketing** — staff raise IT / biomedical / facility / housekeeping / supply tickets
   that are **auto-routed to the staff member who resolved the most similar past tickets**.

Everything runs **locally, no cloud, no external AI** — the right default for patient data. The
"smart" parts (SLA auto-escalation, similarity-based ticket routing, feedback analytics) need no
API keys or model server.

> Design is original to this app (not copied from any template): it follows the HMIS palette
> navy `#16357E` / blue `#2E6BE6` / amber `#F5A623`, bilingual labels, and the doctor-app
> convention of a **fixed left tab rail with same-page panel switching** (no page scroll).

---

## Quick start

```bash
cd hmis-grievance
cp .env.example .env
npm install
npm start
```

- **Patient site:** http://localhost:4200/ — file a grievance, give feedback, or track status
- **Staff console:** http://localhost:4200/console.html — Dashboard · Grievances · Feedback · Tickets

Seeded logins: `admin@mphmis.local` / your `ADMIN_PASSWORD`; staff
`ramesh@` (IT), `kavita@` (biomedical), `suresh@` (facility), `meena@mphmis.local` (housekeeping) /
`staff123`. Seeded with resolved sample tickets (routing history) and sample feedback (analytics).

### Try the smart bits (no setup needed)

- File a feedback of **1/5** → the console shows a **linked grievance** was auto-created.
- Raise a ticket *"ICU patient monitor not showing readings"* → routes to **Kavita** (biomedical);
  *"HMIS login not working"* → **Ramesh** (IT).
- A grievance past its SLA is escalated a tier by the cron sweep (`npm run sla:sweep` to run once).

---

## API (summary)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/grievances/categories` | – | Bilingual categories |
| `POST` | `/api/grievances` | – | File a grievance |
| `GET` | `/api/grievances/track/:refNo` | – | Public status + timeline |
| `POST` | `/api/feedback` | – | Submit feedback (low rating → linked grievance) |
| `POST` | `/api/auth/login` | – | Staff login |
| `GET` | `/api/dashboard` | staff | Combined snapshot (all 3 domains) |
| `GET`/`PATCH` | `/api/grievances…` | staff | List / detail / status / assign / escalate / comment |
| `GET` | `/api/feedback/analytics` | staff | Ratings by department, % recommend, distribution |
| `POST`/`GET`/`PATCH` | `/api/tickets…` | staff | Create (auto-route) / list / detail (+recommendation) / assign / status / reply |

---

## Project layout

```
src/
  config/       env, sqlite
  db/           schema.sql (staff + grievances + feedback + tickets), migrate, seed
  utils/        response/errors/pagination/refNo (index.js) + textSimilarity (routing engine)
  middlewares/  auth (JWT), validate (Joi), error
  modules/      auth · grievances · feedback · tickets · dashboard  (one cohesive file each)
  jobs/         slaSweep (cron auto-escalation)
  routes/       API router + /health
public/
  hmis.css      MP HMIS design system (navy/blue/amber, bilingual, left-rail)
  index.html    patient site (grievance · feedback · track)
  console.html  staff console (fixed left tab rail: Dashboard/Grievances/Feedback/Tickets)
```

## Notes on fitting the real MP HMIS

Standalone by design (SQLite, own JWT). To fold into the main HMIS later, the data access is
plain SQL in each module — swap for the HMIS `mssql` stored-procedure DAM and reuse its
gateway auth/roles. The schema, workflows, SLA/escalation, feedback→grievance loop, and the
local routing engine all carry over. For scale, replace the brute-force cosine in
`utils/textSimilarity.js` with a vector index; the routing service boundary stays the same.
