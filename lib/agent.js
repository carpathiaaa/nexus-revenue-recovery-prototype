const { complete } = require("./llm");
const { addEvent, updateOpportunity } = require("./db");

function opportunityBrief(opportunity) {
  return JSON.stringify(
    {
      company: opportunity.company,
      segment: opportunity.segment,
      customer_name: opportunity.customer_name,
      signal: opportunity.signal,
      product: opportunity.product,
      value: opportunity.value
    },
    null,
    2
  );
}

async function detectLeakage(opportunity) {
  const result = await complete({
    json: true,
    system:
      "You detect revenue leakage. leakage_type must be a short snake_case label (e.g. abandoned_cart, stalled_quote, churn_risk, dormant_account). urgency must be low, medium, or high. reasoning is one concrete sentence. Output { leakage_type, urgency, reasoning }.",
    user: `Opportunity:\n${opportunityBrief(opportunity)}`
  });
  addEvent(opportunity.id, "detected", JSON.stringify(result));
  return result;
}

async function choosePlay(opportunity, detection) {
  const result = await complete({
    json: true,
    system:
      "Choose one revenue recovery play. recovery_play must be a short snake_case label (e.g. winback_call, send_quote, retention_offer, checkout_link_email). channel must be voice or email. requires_human_approval is true only when the play involves discounts, pricing, legal, warranty, or contract terms. Output { recovery_play, channel, requires_human_approval }.",
    user: `Opportunity:\n${opportunityBrief(opportunity)}\nDetection:\n${JSON.stringify(detection, null, 2)}`
  });
  addEvent(opportunity.id, "play_chosen", JSON.stringify(result));
  return result;
}

async function draftOutreach(opportunity, detection, play) {
  const result = await complete({
    json: true,
    system:
      "Draft warm, brief revenue recovery outreach that sounds like a real person, not a template. Use the customer's first name and the specific product. Keep email bodies under 90 words, plain language, one clear ask. Sign off as the company team (e.g. 'The Acme team') — NEVER leave placeholders like [Your Name], [Company], or brackets of any kind. Never invent policy, prices, or promises; offer to send or confirm details instead. For email output { subject, body }. For voice output { opening_line } (one or two natural spoken sentences).",
    user: `Opportunity:\n${opportunityBrief(opportunity)}\nDetection:\n${JSON.stringify(
      detection,
      null,
      2
    )}\nPlay:\n${JSON.stringify(play, null, 2)}`
  });
  addEvent(opportunity.id, "drafted", JSON.stringify(result));
  return result;
}

// Draft the next email in a follow-up sequence. touchNumber is 1-based across the
// whole sequence (1 = first contact, 2 = first follow-up, ...). Tone escalates
// gently with each touch but stays warm and never invents policy.
async function draftFollowUp(opportunity, touchNumber) {
  const result = await complete({
    json: true,
    system: `Write follow-up email #${touchNumber} in a revenue recovery sequence (the customer has not replied to earlier outreach). Reference that you reached out before, add ONE new helpful reason to act now, keep it under 70 words, plain language, one clear ask. Touch ${touchNumber} should sound a little more urgent than the last but stay friendly and never pushy. Use the first name, sign as the company team, no placeholders or brackets. Output { subject, body }.`,
    user: `Opportunity:\n${opportunityBrief(opportunity)}\nThis is touch number ${touchNumber}.`
  });
  addEvent(opportunity.id, "drafted", `Follow-up #${touchNumber}: ${JSON.stringify(result)}`);
  return result;
}

async function runAgent(opportunity) {
  const detection = await detectLeakage(opportunity);
  const play = await choosePlay(opportunity, detection);
  const draft = await draftOutreach(opportunity, detection, play);

  return updateOpportunity(opportunity.id, {
    leakage_type: detection.leakage_type || "needs_review",
    recovery_play: play.recovery_play || "manual_follow_up",
    draft_outreach: JSON.stringify({
      ...draft,
      channel: play.channel || "email",
      urgency: detection.urgency || "medium",
      reasoning: detection.reasoning || ""
    }),
    requires_human_approval: Boolean(play.requires_human_approval)
  });
}

module.exports = {
  detectLeakage,
  choosePlay,
  draftOutreach,
  draftFollowUp,
  runAgent
};
