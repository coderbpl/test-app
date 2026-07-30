# Grievance Redressal System

A **standalone**, AI-assisted grievance (complaint) redressal system for a government hospital
network. Citizens file complaints (in Hindi or English); a **local Ollama model** auto-classifies,
prioritizes, and flags urgent cases; officers triage and resolve them; and overdue complaints
**auto-escalate up the governance ladder** (Facility → District → Division → State).

Runs entirely on your own infrastructure — **no external API, no cloud**. That matters here: hospital
grievances contain patient information, and with local Ollama that text never leaves the server.

---

## Why it's useful (not just a ticket box)

- **AI intake (local Ollama).** Reads free-text Hindi/English/Hinglish complaints and fills in
  category, priority, language, a one-line officer summary, and an **urgent / patient-safety flag**.
- **SLA + auto-escalation.** Every category has an SLA (e.g. *denial of care* = 12h). A cron sweep
  escalates anything overdue one tier up and records it on the timeline.
- **Public tracking.** Every complaint gets a `GRV-YYYY-NNNNNN` number; citizens track status with
  no login.
- **Officer console.** Scope-filtered inbox (urgent + SLA-breached first), full audit timeline,
  status workflow, assignment, escalation, internal notes, **AI-drafted replies** (officer edits &
  sends — never auto-sent), and a live dashboard with SLA-compliance %.
- **Post-resolution feedback.** 1–5 citizen rating.

---

## Quick start

```bash
cd grievance-system
cp .env.example .env        # edit ADMIN_PASSWORD + JWT_SECRET
npm install
npm start
```

Then open:

- **Citizen site:** http://localhost:4000/
- **Officer console:** http://localhost:4000/officer.html  (log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`)

The SQLite database and admin officer are created automatically on first run.

### Enable the AI (optional but recommended)

The system works without AI — it just skips enrichment. To turn it on, install
[Ollama](https://ollama.com) and pull a model:

```bash
ollama pull llama3.1      # or set OLLAMA_MODEL to any model you've pulled
```

Ollama listens on `http://127.0.0.1:11434` by default (matches `.env.example`). Check
`GET /api/health` — it reports whether Ollama is reachable.

---

## How the AI stays private

All AI calls go to a **local** Ollama server (`src/config/ollama.js`). Nothing is sent to a
third-party API, so complaint text containing patient details never leaves the host. If Ollama is
off or slow, classification is skipped and the grievance is still filed, tracked, and worked —
AI is strictly best-effort (`src/modules/grievances/grievance.ai.service.js`).

---

## API overview

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET`  | `/api/health` | – | Server + Ollama status |
| `GET`  | `/api/grievances/categories` | – | Category master |
| `POST` | `/api/grievances` | – | File a grievance (anonymous or named) |
| `GET`  | `/api/grievances/track/:trackingNo` | – | Public status + public timeline |
| `POST` | `/api/grievances/:id/feedback` | – | Post-resolution rating |
| `POST` | `/api/auth/login` | – | Officer login → JWT |
| `GET`  | `/api/grievances` | officer | Scope-filtered inbox (paginated) |
| `GET`  | `/api/grievances/dashboard` | officer | Counts + SLA compliance |
| `GET`  | `/api/grievances/:id` | officer | Full detail + timeline |
| `PATCH`| `/api/grievances/:id/status` | officer | Change status |
| `PATCH`| `/api/grievances/:id/assign` | officer | Assign to an officer |
| `PATCH`| `/api/grievances/:id/escalate` | officer | Escalate a tier |
| `POST` | `/api/grievances/:id/comments` | officer | Add note (public or internal) |
| `POST` | `/api/grievances/:id/reclassify` | officer | Re-run AI classification |
| `GET`  | `/api/grievances/:id/draft-reply` | officer | AI-drafted reply (review before sending) |

Example — file a grievance:

```bash
curl -X POST http://localhost:4000/api/grievances \
  -H 'Content-Type: application/json' \
  -d '{"description":"दवाई नहीं मिली और 3 घंटे लाइन में खड़ा रहना पड़ा","locationText":"District Hospital"}'
```

---

## Project layout

```
src/
  config/        env, sqlite connection, ollama client
  db/            schema.sql, migrate, seed (categories + admin)
  middlewares/   auth (JWT), validate (Joi), error handler
  modules/
    auth/        officer login
    grievances/  repository / service / controller / routes / validator + ai.service (Ollama)
  jobs/          slaSweep — cron auto-escalation
  routes/        API router + /health
  app.js         express app
  server.js      bootstrap (seed → cron → listen)
public/          citizen + officer UI (vanilla JS)
```

---

## Configuration (`.env`)

See `.env.example`. Key ones: `PORT`, `JWT_SECRET`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `DB_FILE`,
`ENABLE_AI`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `SLA_SWEEP_CRON`.

Run a one-off SLA escalation sweep without the server:

```bash
npm run sla:sweep
```

---

## Notes on integrating with the MP HMIS API

This is deliberately standalone (SQLite, self-contained auth). To fold it into the existing
MSSQL HMIS later, the data layer is isolated in `grievance.repository.js` — swap `better-sqlite3`
for the HMIS `mssql` + stored-procedure pattern and reuse its JWT/roles instead of the local
officer table. The schema, workflow, SLA/escalation logic, and Ollama service carry over unchanged.

---

## Docker

```bash
docker compose up --build
```

Brings up the API (port 4000) and an Ollama container. After it's up, pull a model into Ollama once:

```bash
docker compose exec ollama ollama pull llama3.1
```
