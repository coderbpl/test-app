# Smart Helpdesk — email-driven ticketing with similarity-based recommendations

A standalone ticketing system where:

1. **Tickets are created automatically from email** (inbound webhook or IMAP polling) — or raised
   manually via the web form / API.
2. **Each ticket is auto-assigned** to the agent who resolved the most *similar* past tickets.
3. **Agents get recommendations**: the most similar past tickets (with how they were resolved), the
   suggested owner, and an **AI-drafted reply** grounded in those past resolutions.

The "similar tickets → same agent" engine is **local and deterministic** (lexical TF-cosine over
past tickets), so routing works with **no API key and no data leaving the server**. **Groq** (a fast
cloud LLM) is layered on top only for classification and reply-drafting.

---

## How the recommendation works

```
new ticket ──► lexical similarity vs. all past tickets ──► top-K similar
                                                              │
                          ┌───────────────────────────────────┤
                          ▼                                   ▼
        similarity-weighted vote among the           surfaced to the agent
        RESOLVED neighbours' agents        ──►        as "similar tickets"
                          │                            + suggested reply (Groq,
                          ▼                              from their resolutions)
             auto-assign to that agent
        (fallback: least-loaded agent)
```

- **Retrieval:** `src/utils/textSimilarity.js` (TF vectors + cosine) — local, no dependencies.
- **Routing:** `src/modules/tickets/recommendation.service.js` — weighted vote of the agents who
  resolved similar tickets, with a least-loaded fallback.
- **LLM (Groq):** `src/modules/tickets/ticket.ai.service.js` — classification + reply drafting only.

---

## Quick start

```bash
cd smart-helpdesk
cp .env.example .env          # optionally add GROQ_API_KEY
npm install
npm start
```

- **Submit a ticket:** http://localhost:4100/
- **Agent console:** http://localhost:4100/agent.html

Seeded logins: `admin@helpdesk.local` / your `ADMIN_PASSWORD`; agents
`priya@ / arjun@ / neha@ / rohit@helpdesk.local` / `agent123`. The DB is seeded with **8 resolved
sample tickets** across billing/technical/account/shipping so routing has history to learn from.

### Try the routing (works without Groq)

File a ticket like *"I was charged twice for my invoice"* → it auto-routes to **Priya** (who
resolved the billing cases). *"App keeps crashing when I log in"* → routes to **Arjun**. Open the
ticket in the agent console to see the similar tickets and the recommendation.

### Turn on the AI (optional)

Add a Groq key to `.env` (`GROQ_API_KEY=...`, get one at https://console.groq.com/keys) and set
`GROQ_MODEL` to any model your account supports. Then incoming tickets are auto-classified
(category/priority/summary) and the **"AI draft"** button writes a reply from similar resolutions.

> ⚠️ Groq is a **cloud** service — text sent for classification/drafting leaves your server. The
> routing engine does not use it. If your tickets contain sensitive data, keep `ENABLE_AI=false`
> (or use the local-Ollama sibling project instead) and rely on the local routing + your own replies.

---

## Email → ticket

Two ways in, both funnel into the same intake (dedupe by `Message-ID`, replies thread onto the
open ticket by normalized subject):

**A. Inbound webhook** (works out of the box; point SES/SendGrid/Postmark inbound-parse here):

```bash
curl -X POST http://localhost:4100/api/email/inbound -H 'Content-Type: application/json' -d '{
  "from":"customer@example.com","fromName":"Asha",
  "subject":"Refund still not received","text":"I was told I would get a refund but nothing yet."
}'
```

Protect it in production by setting `EMAIL_WEBHOOK_SECRET` and sending `x-webhook-secret`.

**B. IMAP polling** of a real mailbox — set `ENABLE_EMAIL_POLL=true` + `IMAP_*` in `.env`. One-off:
`npm run poll:email`.

---

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET`  | `/api/health` | – | Server + Groq status |
| `GET`  | `/api/tickets/categories` | – | Categories |
| `POST` | `/api/tickets` | – | Raise a ticket (auto-routes) |
| `POST` | `/api/email/inbound` | –* | Email → ticket |
| `POST` | `/api/auth/login` | – | Agent login → JWT |
| `GET`  | `/api/tickets` | agent | Queue (filters: status, priority, `assignedAgentId=me`) |
| `GET`  | `/api/tickets/:id` | agent | Detail **+ recommendation** (similar tickets + suggested agent) |
| `PATCH`| `/api/tickets/:id/assign` | agent | Assign to an agent |
| `POST` | `/api/tickets/:id/assign-to-me` | agent | Claim |
| `POST` | `/api/tickets/:id/auto-assign` | agent | Re-run similarity routing |
| `PATCH`| `/api/tickets/:id/status` | agent | Status + resolution |
| `POST` | `/api/tickets/:id/reply` | agent | Reply / internal note |
| `GET`  | `/api/tickets/:id/draft-reply` | agent | Groq draft from similar resolutions |

\* optional shared-secret via `EMAIL_WEBHOOK_SECRET`.

---

## Project layout

```
src/
  config/       env, sqlite, groq client
  db/           schema.sql, migrate, seed (agents + sample resolved tickets)
  utils/        textSimilarity (TF-cosine engine), response, refNo, ...
  middlewares/  auth (JWT), validate, error
  modules/
    auth/       agent login
    tickets/    repository / service / controller / routes / validator
                + ticket.ai.service (Groq)  + recommendation.service (local routing)
    email/      inbound webhook route
  jobs/         emailPoll (IMAP)
  routes/       API router + /health
public/         submit page + agent console
```

## Scaling notes

At small scale the similarity engine brute-forces cosine over all tickets (fine for thousands). For
large volumes, swap `recommendation.service.js` for a vector index (e.g. `sqlite-vss`, pgvector, or a
dedicated vector DB) — the service boundary stays the same. The data layer is isolated in
`ticket.repository.js` for moving off SQLite.
