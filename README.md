# Nexus Revenue Recovery Prototype

Express + SQLite prototype for detecting revenue leakage, choosing a recovery
play, and executing outreach through browser voice or optional Gmail SMTP.

## Run

```powershell
npm.cmd install
npm.cmd run seed
npm.cmd start
```

Then open http://localhost:3000.

PowerShell may block the `npm` script shim on this machine, so `npm.cmd` is the
most reliable command form.

## Environment

Copy `.env.example` to `.env` and fill in keys as needed. The checked local
defaults use:

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=
EMAIL_ENABLED=false
PORT=3000
```

With no OpenAI key, the app falls back to deterministic scripted responses so
the demo still works. Set `LLM_PROVIDER=ollama` with a local Ollama server for a
free local model path.

## Autopilot (agentic mode)

Click **▶ Run Autopilot** and the agent works the whole list on its own — it does
not just draft, it **sends and follows up**. For each opportunity it analyzes the
signal, picks a recovery play, and executes the next-best action with no clicks:

- **Email plays** → **sends** the recovery email automatically (real Gmail SMTP
  when `EMAIL_ENABLED=true`, otherwise simulated so the flow still runs).
- **Voice plays** → conducts a short recovery call and records the outcome.
- **Risky plays** (discounts, pricing, legal, warranty, contracts) → **held for
  your approval**. Clear the whole queue at once with **Approve & send all**.

### Follow-up cadence (the part that saves your time)

Re-run autopilot and it doesn't repeat the first email — it sends the **next
follow-up** to everyone who hasn't responded, with escalating copy. After
`FOLLOWUP_MAX_TOUCHES` touches (default 4) with no result, it **closes the
opportunity as lost automatically**. You never hand-send or hand-chase anything;
you only glance at the approval queue. Each run prints an owner digest (emails
sent, follow-ups, calls, closed, dollars recovered).

To send for real: set `EMAIL_ENABLED=true`, `GMAIL_USER`, and a Gmail
[app password](https://myaccount.google.com/apppasswords) as `GMAIL_APP_PASSWORD`.
The header badge shows **Live** vs **Simulated** email.

Endpoints: `POST /api/agent/autopilot` (sweep + follow-ups),
`POST /api/agent/approve-all` (clear approval queue),
`POST /api/opportunities/:id/autopilot` (single). Logic lives in
`lib/orchestrator.js`.

### The agent decides outcomes itself

After each touch the agent judges what realistically happened — **recovered**
(closed, counts toward recovered dollars), **engaged** (still warm, keep the
sequence going), or **lost** — using the signal, value, urgency, and how many
times it's reached out. You don't mark anything; recovered revenue moves on its
own. (`judgeOutcome` in `lib/orchestrator.js`.)

### Scheduler — the agent runs itself

The **Auto-pilot scheduler** bar ticks autopilot on a cadence (30s–15m),
**server-side**, so it keeps working with no browser open. Tick it with
**ingest new leads** on and it also injects fresh leakage signals each cycle and
works them automatically — a true always-on loop. The green pulse + status line
show it's live. Endpoints: `GET/POST /api/scheduler[/start|/stop]`,
`POST /api/leads/generate` (inject one lead). See `lib/scheduler.js` and
`lib/leadgen.js`.

### Voice — isolated background pods you watch live

Calls are **isolated server-side pods** (`lib/callpods.js`). Each runs on its own:
it starts (from autopilot/scheduler, or the **Start a call** button), paces itself
turn by turn, and persists a growing transcript — all without a browser open.
Open the **Calls** tab and you're watching a live feed of conversations already
in progress; pick any call from the list to follow it. The agent and customer get
distinct natural voices (neural/online voices marked ✦ in the picker).

- **No clicking required:** turn on the scheduler and voice opportunities spin up
  call pods automatically; switch to the tab whenever to watch.
- **Audio never leaks:** speech only plays while the Calls tab is the active tab
  *and* the browser tab is visible. Switch tabs, alt-tab, or minimize and the
  audio stops immediately. Opening a call shows its backlog silently and only
  speaks new lines as they arrive.

Endpoints: `GET /api/calls`, `GET /api/calls/:id`, `POST /api/calls/:id/start|stop`.

### Empathy override

The agent now has a hard rule that outranks the sales objective
(`lib/prompts.js`): if the customer shares anything painful — a death, illness,
grief, job loss, hardship — it **stops selling immediately**, responds with
genuine compassion, and backs off. It will not pivot back to the product. This is
enforced in the live prompt, the call pods, and the offline fallback.

## Screens

- **Revenue Leakage Dashboard:** run the agent on seeded opportunities. For email
  plays you get an **editable subject/body** inline — tweak the copy, then either
  **Send** (Gmail SMTP if `EMAIL_ENABLED=true`), **Copy** the message, or
  **Open in mail app** (`mailto:`) to send manually. No SMTP required to demo.
- **Live Recovery Conversation:** talk to the agent by **typing** in the input box
  or by clicking **🎤 Speak** (Chrome/Edge speech recognition). The agent replies
  in character — acknowledging what was said and pushing toward the recovery play —
  and speaks aloud unless muted. End the call to auto-summarize the outcome.
- **Outcome Dashboard:** recovered revenue, contacted count, conversion rate,
  segment chart, and audit trail.

## Working without an LLM key

With no `OPENAI_API_KEY`, the app falls back to a **context-aware offline agent**
(`lib/llm.js`) that reads the customer's last line and replies appropriately
(price, shipping, returns, cancellation, interest, etc.) — so the conversation and
drafts still feel real in a pure local demo.
