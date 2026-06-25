# Nexus Revenue Recovery Agent

An always-on agent that finds revenue you're about to lose, decides how to win it
back, and **works the outreach itself** — sending emails, running follow-up
sequences, placing voice calls, and closing each opportunity as recovered or lost
without anyone clicking through a list.

Express + SQLite, with optional OpenAI (or local Ollama) reasoning and real Gmail
sending. It runs end-to-end with **no API key and no email setup** — missing
services fall back to built-in scripted behavior so the demo always works.

> **Deployed:** runs live on Render (`render.yaml` included). The server
> auto-seeds a demo opportunity set on first boot, so a fresh deploy is never
> empty.

---

## Run locally

```powershell
npm.cmd install
npm.cmd run seed     # load the demo opportunities into data.db
npm.cmd start
```

Open http://localhost:3000.

PowerShell may block the bare `npm` shim on this machine, so `npm.cmd` is the most
reliable form.

## Deploy on Render

The repo ships a `render.yaml` blueprint — point Render at the repo and it builds
and starts automatically (`npm install` / `npm start`, health check on
`/api/config`). Set secrets in the Render dashboard, **never in the repo**:

- `OPENAI_API_KEY` — optional. Without it the agent uses its offline reasoning.
- `GMAIL_USER` + `GMAIL_APP_PASSWORD` + `EMAIL_ENABLED=true` — optional, to send
  real email.

Render's filesystem is ephemeral, so `data.db` is wiped on each deploy. The server
**auto-seeds the demo set on startup when the table is empty** (`lib/seedData.js`),
so the live app always boots with data to work.

## Configuration

Copy `.env.example` to `.env` and fill in what you need:

```dotenv
LLM_PROVIDER=openai          # or "ollama" for a free local model
OPENAI_API_KEY=              # empty -> built-in offline agent
OPENAI_MODEL=gpt-4o-mini
OLLAMA_MODEL=llama3.2
EMAIL_ENABLED=false          # true -> send real email via Gmail SMTP
GMAIL_USER=
GMAIL_APP_PASSWORD=          # Gmail app password, not your login password
FOLLOWUP_MAX_TOUCHES=4       # touches before auto-closing as lost
CALL_TURN_DELAY_MS=3500      # pacing between voice-call turns
PORT=3000
```

With no `OPENAI_API_KEY`, the app falls back to deterministic scripted responses so
the demo still works. Set `LLM_PROVIDER=ollama` with a local Ollama server for a
free, fully local model path. The header badge shows **Live** vs **Simulated**
email so you always know which mode you're in.

---

## What the agent does

### Detect → decide → act (per opportunity)

For each opportunity the agent (`lib/agent.js`):

1. **Detects the leakage** — labels the signal (`abandoned_cart`, `stalled_quote`,
   `churn_risk`, `dormant_account`, …) and rates urgency.
2. **Chooses a recovery play** — picks the next-best action and the channel
   (email or voice), and flags whether it needs human approval.
3. **Drafts the outreach** — warm, specific, no-template copy addressed to the
   real customer and product, with no placeholder brackets.

### Autopilot — it sends and follows up, not just drafts

Click **▶ Run Autopilot** (or hit `POST /api/agent/autopilot`) and the agent works
the whole list on its own:

- **Email plays** → **sends** the recovery email automatically (real Gmail SMTP
  when `EMAIL_ENABLED=true`, otherwise simulated so the flow still runs).
- **Voice plays** → spins up a background call pod that conducts a short recovery
  call and records the outcome.
- **Risky plays** (discounts, pricing, legal, warranty, contracts) → **held for
  your approval**. Clear the whole queue at once with **Approve & send all**.

**Follow-up cadence.** Re-run autopilot and it doesn't repeat the first email — it
sends the **next follow-up** to everyone who hasn't responded, with escalating
copy. After `FOLLOWUP_MAX_TOUCHES` touches (default 4) with no result, it **closes
the opportunity as lost automatically**. You never hand-send or hand-chase; you
only glance at the approval queue.

**The agent decides outcomes itself.** After each touch it judges what realistically
happened — **recovered** (counts toward recovered dollars), **engaged** (still warm,
keep the sequence going), or **lost** — from the signal, value, urgency, and touch
count (`judgeOutcome` in `lib/orchestrator.js`). You don't mark anything; recovered
revenue moves on its own.

### Scheduler — the agent runs itself, server-side

The **Auto-pilot scheduler** bar ticks autopilot on a cadence (30s–15m),
**server-side**, so it keeps working with no browser open. Turn on **ingest new
leads** and each cycle also injects a fresh leakage signal and works it — a true
always-on loop. `lib/scheduler.js` + `lib/leadgen.js`.

### Voice — isolated background pods you watch live

Calls are **isolated server-side pods** (`lib/callpods.js`). Each one starts on its
own (from autopilot, the scheduler, or the **Start a call** button), paces itself
turn by turn, and persists a growing transcript — all with no browser open. Open
the **Voice Agent** tab and you're watching conversations already in progress.

- **Audio never leaks:** speech only plays while the Voice tab is active *and* the
  browser tab is visible. Switch tabs or minimize and it stops immediately.

### Empathy override — a human moment beats the deal

A hard rule that outranks the sales objective (`lib/prompts.js`): if the customer
shares anything painful — a death, illness, grief, job loss, hardship — the agent
**stops selling immediately**, responds with genuine compassion, and backs off. It
will not pivot back to the product. Enforced in the live prompt, the call pods,
**and** the offline fallback.

---

## Screens

- **Revenue Leakage Dashboard** — run autopilot, or work one opportunity at a time.
  For email plays you get an **editable subject/body** inline — tweak it, then
  **Send**, **Copy**, or **Open in mail app** (`mailto:`). No SMTP required to demo.
- **Voice Agent** — watch live recovery calls, or talk to the agent yourself by
  typing or clicking **🎤 Speak** (Chrome/Edge speech recognition). The agent
  replies in character and speaks aloud unless muted.
- **Outcomes Dashboard** — recovered revenue, contacted count, conversion rate,
  segment breakdown, and a full audit trail of every action.

## API surface

| Endpoint | What it does |
| --- | --- |
| `GET /api/opportunities` | List all opportunities |
| `POST /api/opportunities/:id/run-agent` | Detect + decide + draft (no send) |
| `POST /api/opportunities/:id/autopilot` | Act on one opportunity |
| `POST /api/agent/autopilot` | Sweep every unresolved opportunity |
| `POST /api/agent/approve-all` | Clear the approval queue |
| `GET/POST /api/scheduler[/start\|/stop]` | Control the always-on loop |
| `POST /api/leads/generate` | Inject one fresh leakage signal |
| `GET /api/calls`, `GET /api/calls/:id` | List / follow live call pods |
| `POST /api/calls/:id/start\|stop` | Start or stop a call pod |
| `POST /api/email/send` | Send (or simulate) a recovery email |
| `GET /api/metrics` | Recovered revenue, conversion, audit trail |
| `GET /api/config` | Email mode + cadence length (also the health check) |

## Project layout

```
server.js            Express app + routes + startup auto-seed
lib/agent.js         detect leakage -> choose play -> draft outreach
lib/orchestrator.js  autopilot state machine, follow-up cadence, outcome judging
lib/scheduler.js     server-side always-on loop
lib/callpods.js      isolated background voice calls
lib/leadgen.js       injects fresh leakage signals
lib/llm.js           OpenAI / Ollama client + full offline fallback
lib/email.js         Gmail SMTP send (or simulated)
lib/prompts.js       shared prompt fragments (empathy override)
lib/db.js            SQLite schema + queries
lib/seedData.js      demo opportunity set + non-destructive auto-seed
public/              dashboard UI (vanilla HTML/CSS/JS)
```

See [`for-joseph.md`](./for-joseph.md) for the business case — what this is, why
it's more than a Claude skill or an n8n flow, and where it fits Nexus.
