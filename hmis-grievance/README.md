# MP HMIS — Grievance, Feedback & Ticketing

A single, standalone system for a government hospital that unifies **three** things patients and
staff actually need, in the **Madhya Pradesh HMIS design language** (navy/blue/amber, bilingual
Hindi+English, fixed left tab-rail console):

1. **Grievance = Ticket (unified).** The public "grievance" form creates a **ticket** directly
   (one record, tracked by `TKT-…`) — no separate grievance entity. Every issue is handled
   ticket-based (not on phone calls).
2. **Patient feedback** — a star-rating survey for either the **hospital service** or the **HMIS
   app** (Hospital field hidden for app feedback), with department + type analytics. Any poor
   rating (≤2) **auto-raises a routed ticket** — a closed loop, not a dead-end survey.
3. **Ticketing team** — an **OIC → PM → TL → Developer** hierarchy. Every ticket (public grievance,
   feedback follow-up, or internal) is **auto-assigned to the right developer by its description**
   (similar past tickets, then skill tags), the assignee is **emailed**, and a **Team view** shows
   each member's load with one-click **reassignment**.

Runs **locally, no cloud** — the right default for patient data. PII (names, mobiles, emails) is
**encrypted in transit over HTTPS/TLS** when a cert is configured (see Security). The "smart"
parts (routing, follow-up loops, analytics) need no API keys. Optional: **email** (SMTP) and
**"Rewrite with AI"** (local Ollama by default).

## Security — PII in transit (HTTPS)

Set a key + cert to serve over TLS so PII isn't sent as plain text. For local dev:

```bash
mkdir -p certs && openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem -out certs/cert.pem -days 365 -subj "/CN=localhost"
# in .env:  SSL_KEY_FILE=./certs/key.pem   SSL_CERT_FILE=./certs/cert.pem
```

The server then boots on `https://…`. In production, terminate TLS at a load balancer / reverse
proxy with a real certificate. Without a cert it runs HTTP (dev only) and warns on startup.

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
