# MP HMIS — Grievance, Feedback & Ticketing

A single, standalone system for a government hospital that unifies **three** things patients and
staff actually need, in the **Madhya Pradesh HMIS design language** (navy/blue/amber, bilingual
Hindi+English, fixed left tab-rail console):

1. **Grievance handling** — patients file complaints (bilingual, anonymous option); each is
   prioritized, tracked on a timeline, and assigned/escalated by an officer.
2. **Patient feedback** — a star-rating survey for either the **hospital service** or the **HMIS
   app**, with department + type analytics. A poor **service** rating (≤2) auto-opens a linked
   grievance; a poor **app** rating auto-raises a routed IT ticket — closed loops, not dead-end
   surveys.
3. **Internal ticketing** — handled by an **OIC → PM → TL → Developer** team. New tickets are
   **auto-assigned to the right developer based on the description** (similar past tickets, then
   skill tags), and the assignee is **notified by email**.

Everything runs **locally, no cloud, no external AI** — the right default for patient data. The
"smart" parts (description-based ticket routing, feedback→follow-up loops, analytics) need no API
keys or model server. Optional add-ons: **email** notifications (configure SMTP in `.env`) and
**"Rewrite with AI"** on grievances (local Ollama by default).

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

Seeded logins: `admin@mphmis.local` / your `ADMIN_PASSWORD`. Grievance officers `sunita@` / `anil@`.
Ticket team (all `staff123`): `oic@` (OIC), `pm@` (PM), `tl.backend@` / `tl.frontend@` (Team Leads),
and developers `vikram@` (backend/API), `neha@` (frontend/UI), `amit@` (database), `ravi@` (devops),
`pooja@mphmis.local` (mobile). Seeded with resolved sample tickets (routing history) and feedback.

### Try the smart bits (no setup needed)

- Raise a ticket *"API returns 500 when saving a record"* → auto-assigned to **Vikram** (backend);
  *"dashboard layout broken, CSS overlaps"* → **Neha** (frontend); *"reports page query timeout"* →
  **Amit** (database). The assignee is emailed (logged to the console when SMTP is off).
- Submit **service** feedback of 1/5 → a **linked grievance** is auto-created; submit **HMIS app**
  feedback of 1/5 → a routed **IT ticket** is auto-raised.

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
                + ai.service (Rewrite with AI) · email.service (assignment notifications)
  routes/       API router + /health
public/
  hmis.css      MP HMIS design system (navy/blue/amber, bilingual, left-rail)
  index.html    patient site (grievance · feedback · track)
  console.html  staff console (fixed left tab rail: Dashboard/Grievances/Feedback/Tickets)
```

## Notes on fitting the real MP HMIS

Standalone by design (SQLite, own JWT). To fold into the main HMIS later, the data access is
plain SQL in each module — swap for the HMIS `mssql` stored-procedure DAM and reuse its
gateway auth/roles. The schema, workflows, feedback→grievance / app→ticket loops, and the
local routing engine all carry over. For scale, replace the brute-force cosine in
`utils/textSimilarity.js` with a vector index; the routing service boundary stays the same.
