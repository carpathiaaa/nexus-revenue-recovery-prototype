const { runAgent, draftFollowUp } = require("./agent");
const { complete } = require("./llm");
const {
  allOpportunities,
  getOpportunity,
  updateOpportunity,
  addEvent
} = require("./db");
const { sendOpportunityEmail } = require("./email");
const { startPod } = require("./callpods");

const VOICE_SYSTEM =
  "You are a warm, sharp revenue-recovery rep on a live call. Acknowledge what the customer said, then move one step toward finishing the deal in the recovery_play. 1-2 short spoken sentences. Never invent prices or policy. End with a simple question.";

// How many times the agent will reach out before it gives up and closes the
// opportunity as lost. Initial touch + (MAX_TOUCHES - 1) follow-ups.
const MAX_TOUCHES = Number(process.env.FOLLOWUP_MAX_TOUCHES || 4);

function parseDraft(opportunity) {
  try {
    return JSON.parse(opportunity.draft_outreach || "{}");
  } catch {
    return {};
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureProcessed(opportunity) {
  if (opportunity.leakage_type && opportunity.draft_outreach) return opportunity;
  return runAgent(opportunity);
}

// Persist an edited/generated draft, then actually send it. sendOpportunityEmail
// uses real Gmail SMTP when EMAIL_ENABLED=true, otherwise logs the message. Either
// way the opportunity is recorded as contacted and the touch is counted.
async function sendEmailTouch(opportunity, draft, label) {
  const id = opportunity.id;
  updateOpportunity(id, {
    draft_outreach: JSON.stringify({ ...parseDraft(opportunity), ...draft, channel: "email" })
  });
  const sent = await sendOpportunityEmail(id);
  const touch = (opportunity.touch_count || 0) + 1;
  const updated = updateOpportunity(id, { touch_count: touch, last_touch_at: nowIso() });
  addEvent(id, "autopilot", `${label} — ${sent.emailEnabled ? "sent live" : "sent (simulated)"} to ${sent.message.to}. Touch ${touch}/${MAX_TOUCHES}.`);
  return { updated, sent, touch };
}

// The agent runs a short recovery call on its own, role-playing a realistic
// customer, responding in character, then summarizing the outcome.
async function simulateCall(opportunity) {
  const draft = parseDraft(opportunity);
  const opening =
    draft.opening_line ||
    `Hi ${opportunity.customer_name.split(" ")[0]}, reaching out about ${opportunity.product} to help you wrap it up.`;
  const history = [{ role: "agent", text: opening }];

  const customerText = String(
    await complete({
      system:
        "You role-play the customer on a recovery call. Reply with ONE short, realistic sentence showing mild hesitation (price, timing, or a quick question). No quotation marks, no narration.",
      user: JSON.stringify({ opportunity, opening }, null, 2)
    })
  ).trim();
  history.push({ role: "customer", text: customerText });

  const agentReply = String(
    await complete({
      system: VOICE_SYSTEM,
      user: JSON.stringify(
        { opportunity, recovery_play: opportunity.recovery_play, history, customerText },
        null,
        2
      )
    })
  ).trim();
  history.push({ role: "agent", text: agentReply });

  const result = await complete({
    json: true,
    system:
      "Summarize this short revenue recovery call. Output { summary, outcome, follow_up_needed }. outcome must be contacted, recovered, or lost.",
    user: JSON.stringify({ opportunity, history }, null, 2)
  });
  const outcome = ["contacted", "recovered", "lost"].includes(result.outcome)
    ? result.outcome
    : "contacted";
  return { summary: result.summary || "Recovery call completed.", outcome, follow_up_needed: Boolean(result.follow_up_needed) };
}

// The agent judges what realistically happened after an outreach touch and
// decides the outcome itself — this is what lets recovered dollars move without a
// human marking anything. Conservative on purpose: most early touches stay warm.
async function judgeOutcome(opportunity) {
  const result = await complete({
    json: true,
    system:
      "You are the recovery agent deciding what realistically happened after this outreach touch. Output { outcome, reason }. outcome is 'recovered' (customer came back, completed, or agreed to proceed), 'engaged' (replied or still warm — keep nurturing), or 'lost' (declined or went cold). Decide like a real pipeline behaves — do NOT label everything 'engaged'. Rough base rates by touch number: touch 1 ~15% recovered / ~80% engaged / ~5% lost; touch 2 ~30% recovered / ~60% engaged / ~10% lost; touch 3+ ~45% recovered / ~35% engaged / ~20% lost. Push recovery higher for high-urgency or high-value signals (abandoned cart, payment failed, expiring trial), lower for cold/dormant ones. Commit to a definite outcome for THIS opportunity using its specifics; some must recover and some must be lost.",
    user: JSON.stringify(
      {
        company: opportunity.company,
        segment: opportunity.segment,
        signal: opportunity.signal,
        product: opportunity.product,
        value: opportunity.value,
        touch: opportunity.touch_count || 0,
        max_touches: MAX_TOUCHES
      },
      null,
      2
    )
  });
  const outcome = ["recovered", "engaged", "lost"].includes(result.outcome) ? result.outcome : "engaged";
  return { outcome, reason: result.reason || "Assessed after outreach." };
}

// After a send, let the agent settle the outcome. 'engaged' keeps the opportunity
// in the follow-up cadence; 'recovered'/'lost' close it out.
async function settleOutcome(opportunity, fallbackAction, base) {
  const judged = await judgeOutcome(opportunity);
  if (judged.outcome === "recovered") {
    const updated = updateOpportunity(opportunity.id, { status: "recovered", follow_up_needed: false });
    addEvent(opportunity.id, "recovered", `Agent confirmed recovery: ${judged.reason}`);
    return { ...base, action: "recovered", outcome: "recovered", opportunity: updated };
  }
  if (judged.outcome === "lost") {
    const updated = updateOpportunity(opportunity.id, { status: "lost", follow_up_needed: false });
    addEvent(opportunity.id, "lost", `Agent closed as lost: ${judged.reason}`);
    return { ...base, action: "lost", outcome: "lost", opportunity: updated };
  }
  return { ...base, action: fallbackAction, outcome: "engaged", opportunity: getOpportunity(opportunity.id) };
}

// Decide and execute the next-best action for one opportunity, fully autonomously.
// This is a state machine over the opportunity's status + touch count:
//   new            -> first touch (send email / run call) or hold if risky
//   contacted      -> auto follow-up, or auto-close as lost once touches run out
//   needs_approval -> leave for the owner (handled by approveAndSendAll)
//   recovered/lost -> done
async function actOnOpportunity(id, { allowApprovalSend = false } = {}) {
  let opportunity = getOpportunity(id);
  if (!opportunity) {
    const error = new Error("Opportunity not found");
    error.status = 404;
    throw error;
  }
  const base = { id, company: opportunity.company };

  if (["recovered", "lost"].includes(opportunity.status)) {
    return { ...base, action: "skip", reason: "already resolved", opportunity };
  }

  if (opportunity.status === "calling") {
    return { ...base, action: "skip", reason: "call in progress", opportunity };
  }

  // Held-for-approval items only move when the owner explicitly approves.
  if (opportunity.status === "needs_approval" && !allowApprovalSend) {
    return { ...base, action: "await_approval", reason: "waiting on owner approval", opportunity };
  }

  // Already-contacted: run the follow-up cadence instead of a first touch.
  if (opportunity.status === "contacted") {
    if ((opportunity.touch_count || 0) >= MAX_TOUCHES) {
      const updated = updateOpportunity(id, { status: "lost", follow_up_needed: false });
      addEvent(id, "lost", `Closed automatically — no response after ${opportunity.touch_count} touches.`);
      return { ...base, action: "gave_up", touches: opportunity.touch_count, opportunity: updated };
    }
    const nextTouch = (opportunity.touch_count || 0) + 1;
    const follow = await draftFollowUp(opportunity, nextTouch);
    const { updated, touch } = await sendEmailTouch(opportunity, follow, `Auto follow-up #${nextTouch - 1}`);
    const settled = await settleOutcome(updated, "follow_up", base);
    return { ...settled, touch };
  }

  // status === "new" (or needs_approval with allowApprovalSend) -> first touch.
  opportunity = await ensureProcessed(opportunity);
  const draft = parseDraft(opportunity);
  const channel = draft.channel || "email";

  if (opportunity.requires_human_approval && !allowApprovalSend) {
    const updated = updateOpportunity(id, { status: "needs_approval" });
    addEvent(id, "autopilot", `Held for human approval — ${channel} play "${opportunity.recovery_play}" touches pricing/legal terms.`);
    return { ...base, action: "await_approval", reason: "requires human approval", channel, opportunity: updated };
  }

  if (channel === "voice" && !allowApprovalSend) {
    // Launch an isolated, self-running call pod and return immediately. The call
    // plays out in the background and updates the opportunity when it ends.
    startPod(opportunity);
    return { ...base, action: "voice_call_started", channel, opportunity: getOpportunity(id) };
  }

  // Email first touch (also the path taken when an owner approves a held item).
  const { updated, sent } = await sendEmailTouch(
    opportunity,
    { subject: draft.subject, body: draft.body },
    allowApprovalSend ? "Approved & sent" : "Auto-sent recovery email"
  );
  const settled = await settleOutcome(updated, allowApprovalSend ? "approved_sent" : "auto_email", base);
  return { ...settled, channel: "email", emailEnabled: sent.emailEnabled };
}

// Sweep every unresolved, non-held opportunity and act on each.
async function runAutopilot() {
  const targets = allOpportunities().filter(
    (o) => !["recovered", "lost", "needs_approval", "calling"].includes(o.status)
  );
  const actions = [];
  for (const opportunity of targets) {
    actions.push(await actOnOpportunity(opportunity.id));
  }
  return actions;
}

// Owner approves the whole exception queue in one go: send every held item.
async function approveAndSendAll() {
  const held = allOpportunities().filter((o) => o.status === "needs_approval");
  const actions = [];
  for (const opportunity of held) {
    actions.push(await actOnOpportunity(opportunity.id, { allowApprovalSend: true }));
  }
  return actions;
}

module.exports = { actOnOpportunity, runAutopilot, approveAndSendAll, MAX_TOUCHES };
