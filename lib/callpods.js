const { complete } = require("./llm");
const { getOpportunity, updateOpportunity, addEvent } = require("./db");
const { EMPATHY_OVERRIDE } = require("./prompts");

// A "call pod" is an isolated, self-running voice conversation. It lives entirely
// server-side: it starts on its own (from autopilot/scheduler or a manual kick),
// paces itself turn by turn, and persists a growing transcript. The browser is
// just a viewer — open the tab and you watch a call that's already in progress.
const pods = new Map(); // opportunityId -> pod
const MAX_EXCHANGES = 4;
const TURN_DELAY_MS = Number(process.env.CALL_TURN_DELAY_MS || 3500);

const AGENT_SYSTEM =
  [
    "You are a warm, sharp revenue-recovery rep on a live phone call. Respond to what the customer just said, then move one step toward the outcome in the recovery_play.",
    "Talk like a real person, not a script: use contractions, natural rhythm, and plain spoken language. 1-2 short sentences.",
    "DO NOT repeat the customer's first name. You already greeted them by name in the opening — saying it again every turn sounds robotic. Use it at most once more in the entire call, and only if it feels truly natural; otherwise don't use it at all.",
    "DO NOT open with filler acknowledgments. Never start a line with 'I understand,' 'I hear you,' 'I get it,' 'totally,' 'absolutely,' 'of course,' or 'that makes sense.' Just respond directly, or react in a fresh, specific way to the actual thing they said.",
    "Vary how each line begins — never start two of your turns the same way. Avoid stock sales phrases.",
    "Never invent prices, discounts, or policy. End with a light, specific question that moves things forward — unless the empathy rule applies.",
    "Output only the spoken words. No narration, no stage directions, no quotation marks, no emojis."
  ].join(" ") +
  "\n\n" +
  EMPATHY_OVERRIDE;

const CUSTOMER_SYSTEM =
  "You are the CUSTOMER on a recovery call from this brand. Reply with ONE short, natural, realistic spoken sentence that reacts to what the rep just said — a question, a hesitation about price or timing, or gradually warming up as the call goes on. Don't repeat the rep's name, don't reuse the same reaction twice, and vary your phrasing. No narration, no quotation marks.";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDraft(opportunity) {
  try {
    return JSON.parse(opportunity.draft_outreach || "{}");
  } catch {
    return {};
  }
}

function pushTurn(pod, role, text) {
  pod.turns.push({ role, text, ts: new Date().toISOString() });
}

function snapshot(pod) {
  return {
    opportunityId: pod.opportunityId,
    company: pod.company,
    customer: pod.customer,
    product: pod.product,
    status: pod.status,
    outcome: pod.outcome || null,
    summary: pod.summary || null,
    turns: pod.turns,
    startedAt: pod.startedAt,
    endedAt: pod.endedAt || null
  };
}

function listPods() {
  return [...pods.values()]
    .sort((a, b) => (b.startedAt < a.startedAt ? -1 : 1))
    .map((p) => ({
      opportunityId: p.opportunityId,
      company: p.company,
      customer: p.customer,
      product: p.product,
      status: p.status,
      outcome: p.outcome || null,
      turns: p.turns.length,
      lastText: p.turns.length ? p.turns[p.turns.length - 1].text : "",
      startedAt: p.startedAt
    }));
}

function getPod(opportunityId) {
  const pod = pods.get(Number(opportunityId));
  return pod ? snapshot(pod) : null;
}

async function runPod(pod) {
  try {
    const opportunity = getOpportunity(pod.opportunityId);
    if (!opportunity) {
      pod.status = "ended";
      return;
    }
    const draft = parseDraft(opportunity);
    const opening =
      draft.opening_line ||
      `Hi ${opportunity.customer_name.split(" ")[0]}, this is ${opportunity.company} reaching out about ${opportunity.product} — do you have a quick moment?`;
    pushTurn(pod, "agent", opening);
    await sleep(TURN_DELAY_MS);

    for (let i = 0; i < MAX_EXCHANGES && pod.status === "live"; i += 1) {
      const customerText = String(
        await complete({ system: CUSTOMER_SYSTEM, user: JSON.stringify({ opportunity, history: pod.turns }, null, 2) })
      ).trim();
      if (pod.status !== "live") break;
      pushTurn(pod, "customer", customerText);
      await sleep(TURN_DELAY_MS);

      const agentText = String(
        await complete({
          system: AGENT_SYSTEM,
          user: JSON.stringify(
            { opportunity, recovery_play: opportunity.recovery_play, history: pod.turns, customerText },
            null,
            2
          )
        })
      ).trim();
      if (pod.status !== "live") break;
      pushTurn(pod, "agent", agentText);
      await sleep(TURN_DELAY_MS);
    }

    // Wrap up: summarize and let the agent decide the outcome.
    const result = await complete({
      json: true,
      system:
        "Summarize this revenue recovery call. Output { summary, outcome }. outcome must be contacted, recovered, or lost. If the customer shared grief or hardship and the agent backed off, outcome is 'lost' or 'contacted' — never 'recovered'.",
      user: JSON.stringify({ opportunity: getOpportunity(pod.opportunityId), history: pod.turns }, null, 2)
    });
    pod.outcome = ["contacted", "recovered", "lost"].includes(result.outcome) ? result.outcome : "contacted";
    pod.summary = result.summary || "Call completed.";
    pod.status = "ended";
    pod.endedAt = new Date().toISOString();

    const current = getOpportunity(pod.opportunityId);
    updateOpportunity(pod.opportunityId, {
      call_summary: pod.summary,
      status: pod.outcome,
      touch_count: (current.touch_count || 0) + 1,
      last_touch_at: new Date().toISOString()
    });
    addEvent(pod.opportunityId, pod.outcome === "recovered" ? "recovered" : "called", `Live call ended → ${pod.outcome}: ${pod.summary}`);
  } catch (error) {
    pod.status = "ended";
    pod.endedAt = new Date().toISOString();
    pod.summary = `Call error: ${error.message}`;
    console.error("[callpod]", error.message);
  }
}

// Start (or return) a pod for an opportunity. Marks it 'calling' so the rest of
// the system leaves it alone while the call runs.
function startPod(opportunity) {
  const existing = pods.get(opportunity.id);
  if (existing && existing.status === "live") return snapshot(existing);

  const pod = {
    opportunityId: opportunity.id,
    company: opportunity.company,
    customer: opportunity.customer_name,
    product: opportunity.product,
    turns: [],
    status: "live",
    startedAt: new Date().toISOString()
  };
  pods.set(opportunity.id, pod);
  updateOpportunity(opportunity.id, { status: "calling" });
  addEvent(opportunity.id, "autopilot", "Started a live recovery call (background pod).");
  runPod(pod); // fire-and-forget; the call plays out on its own
  return snapshot(pod);
}

function stopPod(opportunityId) {
  const pod = pods.get(Number(opportunityId));
  if (pod && pod.status === "live") {
    pod.status = "ended";
    pod.endedAt = new Date().toISOString();
  }
  return getPod(opportunityId);
}

module.exports = { startPod, stopPod, getPod, listPods };
