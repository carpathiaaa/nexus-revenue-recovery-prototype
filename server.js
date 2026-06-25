require("dotenv").config();

const express = require("express");
const path = require("path");
const {
  allOpportunities,
  getOpportunity,
  updateOpportunity,
  addEvent,
  listEvents,
  db
} = require("./lib/db");
const { runAgent } = require("./lib/agent");
const { complete } = require("./lib/llm");
const { sendOpportunityEmail, saveDraft } = require("./lib/email");
const { actOnOpportunity, runAutopilot, approveAndSendAll, MAX_TOUCHES } = require("./lib/orchestrator");
const scheduler = require("./lib/scheduler");
const { generateLead } = require("./lib/leadgen");
const { startPod, stopPod, getPod, listPods } = require("./lib/callpods");
const { seedIfEmpty } = require("./lib/seedData");

const { EMPATHY_OVERRIDE } = require("./lib/prompts");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function parseDraft(row) {
  try {
    return JSON.parse(row.draft_outreach || "{}");
  } catch {
    return {};
  }
}

function requireOpportunity(id) {
  const opportunity = getOpportunity(Number(id));
  if (!opportunity) {
    const error = new Error("Opportunity not found");
    error.status = 404;
    throw error;
  }
  return opportunity;
}

app.get("/api/opportunities", (req, res) => {
  res.json(allOpportunities());
});

app.post("/api/opportunities/:id/run-agent", async (req, res, next) => {
  try {
    const opportunity = requireOpportunity(req.params.id);
    const updated = await runAgent(opportunity);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Agentic: let the orchestrator decide and execute the next-best action for a
// single opportunity (auto-send, auto-call, or hold for approval).
app.post("/api/opportunities/:id/autopilot", async (req, res, next) => {
  try {
    requireOpportunity(req.params.id);
    const result = await actOnOpportunity(Number(req.params.id));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Agentic: sweep every unresolved opportunity in one go.
app.post("/api/agent/autopilot", async (req, res, next) => {
  try {
    const actions = await runAutopilot();
    res.json({ actions });
  } catch (error) {
    next(error);
  }
});

// Owner clears the whole approval queue at once.
app.post("/api/agent/approve-all", async (req, res, next) => {
  try {
    const actions = await approveAndSendAll();
    res.json({ actions });
  } catch (error) {
    next(error);
  }
});

// Small config surface so the UI can show email mode and the cadence length.
app.get("/api/config", (req, res) => {
  res.json({
    emailEnabled: process.env.EMAIL_ENABLED === "true",
    maxTouches: MAX_TOUCHES
  });
});

// Scheduler: run autopilot on a cadence, optionally ingesting new leads each tick.
app.get("/api/scheduler", (req, res) => res.json(scheduler.status()));

app.post("/api/scheduler/start", (req, res) => {
  const { intervalSeconds, generateLeads } = req.body || {};
  res.json(scheduler.start({ intervalSeconds, generateLeads }));
});

app.post("/api/scheduler/stop", (req, res) => res.json(scheduler.stop()));

// Inject a single fresh lead (new leakage signal) on demand.
app.post("/api/leads/generate", (req, res) => {
  res.json(generateLead());
});

app.post("/api/voice/turn", async (req, res, next) => {
  try {
    const { opportunityId, history = [], customerText = "" } = req.body;
    const opportunity = requireOpportunity(opportunityId);
    const draft = parseDraft(opportunity);
    const line = await complete({
      system:
        "You are a warm, sharp revenue-recovery rep speaking live with the customer (voice or chat). Speak like a real person: acknowledge what they just said, then move one step toward finishing the deal in the recovery_play. Keep every reply to 1-2 short spoken sentences. Use the customer's first name occasionally, never every line. If you can't change a price or policy, say so plainly and offer to email the details instead of guessing. Never fabricate prices, discounts, or promises. End most replies with a simple question that keeps the conversation going.\n\n" +
        EMPATHY_OVERRIDE,
      user: JSON.stringify(
        {
          opportunity,
          opening_line: draft.opening_line,
          recovery_play: opportunity.recovery_play,
          history,
          customerText
        },
        null,
        2
      )
    });
    res.json({ agentText: String(line).trim() });
  } catch (error) {
    next(error);
  }
});

// Call pods: isolated, self-running voice calls you watch live.
app.get("/api/calls", (req, res) => res.json(listPods()));

app.get("/api/calls/:id", (req, res, next) => {
  try {
    const pod = getPod(Number(req.params.id));
    if (!pod) return res.status(404).json({ error: "No call for that opportunity" });
    res.json(pod);
  } catch (error) {
    next(error);
  }
});

app.post("/api/calls/:id/start", (req, res, next) => {
  try {
    const opportunity = requireOpportunity(req.params.id);
    res.json(startPod(opportunity));
  } catch (error) {
    next(error);
  }
});

app.post("/api/calls/:id/stop", (req, res, next) => {
  try {
    requireOpportunity(req.params.id);
    res.json(stopPod(Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

// Role-plays the customer's side so the voice call can run hands-free.
app.post("/api/voice/customer-sim", async (req, res, next) => {
  try {
    const { opportunityId, history = [] } = req.body;
    const opportunity = requireOpportunity(opportunityId);
    const line = await complete({
      system:
        "You are the CUSTOMER on a recovery call from this brand. Reply with ONE short, natural, realistic spoken sentence — a question, a hesitation about price or timing, or gradually warming up as the call goes on. No narration, no quotation marks.",
      user: JSON.stringify({ opportunity, history }, null, 2)
    });
    res.json({ customerText: String(line).trim() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/voice/summary", async (req, res, next) => {
  try {
    const { opportunityId, history = [] } = req.body;
    const opportunity = requireOpportunity(opportunityId);
    const result = await complete({
      json: true,
      system:
        "Summarize this revenue recovery call. Output { summary, outcome, follow_up_needed }. outcome must be contacted, recovered, or lost.",
      user: JSON.stringify({ opportunity, history }, null, 2)
    });
    const outcome = ["contacted", "recovered", "lost"].includes(result.outcome)
      ? result.outcome
      : "contacted";
    const summary = result.summary || "Call completed. Follow-up details may be needed.";
    const updated = updateOpportunity(opportunity.id, {
      call_summary: summary,
      status: outcome,
      follow_up_needed: Boolean(result.follow_up_needed)
    });
    addEvent(opportunity.id, outcome === "recovered" ? "recovered" : "called", summary);
    res.json({ opportunity: updated, summary, outcome });
  } catch (error) {
    next(error);
  }
});

app.put("/api/opportunities/:id/draft", (req, res, next) => {
  try {
    requireOpportunity(req.params.id);
    const { subject, body } = req.body || {};
    const updated = saveDraft(Number(req.params.id), { subject, body });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.post("/api/email/send", async (req, res, next) => {
  try {
    const { opportunityId } = req.body;
    const result = await sendOpportunityEmail(Number(opportunityId));
    res.json({ ...result, sent: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/opportunities/:id/resolve", (req, res, next) => {
  try {
    const opportunity = requireOpportunity(req.params.id);
    const { outcome } = req.body;
    if (!["recovered", "lost"].includes(outcome)) {
      return res.status(400).json({ error: "Outcome must be recovered or lost" });
    }
    const updated = updateOpportunity(opportunity.id, { status: outcome, follow_up_needed: false });
    addEvent(opportunity.id, outcome, `Marked ${outcome} by user`);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.get("/api/metrics", (req, res) => {
  const totals = db
    .prepare(
      `SELECT
        COALESCE(SUM(value), 0) AS total_value,
        COALESCE(SUM(CASE WHEN status = 'recovered' THEN value ELSE 0 END), 0) AS recovered_value,
        SUM(CASE WHEN status IN ('contacted', 'recovered', 'lost') THEN 1 ELSE 0 END) AS contacted,
        SUM(CASE WHEN status = 'recovered' THEN 1 ELSE 0 END) AS recovered,
        SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost,
        COUNT(*) AS total
       FROM opportunities`
    )
    .get();

  const bySegment = db
    .prepare(
      `SELECT segment, COALESCE(SUM(CASE WHEN status = 'recovered' THEN value ELSE 0 END), 0) AS recovered_value
       FROM opportunities
       GROUP BY segment
       ORDER BY segment`
    )
    .all();

  const conversionRate = totals.contacted ? totals.recovered / totals.contacted : 0;
  res.json({
    ...totals,
    conversion_rate: conversionRate,
    by_segment: bySegment,
    events: listEvents(20)
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || "Server error" });
});

// On hosts with an ephemeral filesystem (e.g. Render), data.db is wiped on each
// deploy — auto-seed the demo set so the app always boots with data.
if (seedIfEmpty()) {
  console.log("Seeded demo opportunities (empty database on startup).");
}

app.listen(port, () => {
  const liveEmail = process.env.EMAIL_ENABLED === "true";
  console.log(`Nexus Revenue Recovery Agent running at http://localhost:${port}`);
  console.log(
    liveEmail
      ? "Email: LIVE — autopilot sends real emails via Gmail SMTP."
      : "Email: SIMULATED — set EMAIL_ENABLED=true + Gmail creds in .env to send for real."
  );
});
